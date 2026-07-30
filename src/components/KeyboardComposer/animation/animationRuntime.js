import { ACTIONS, DEFAULT_MAX_WAIT } from './actions'
import { buildWaves } from './animationSchema'
import { ease, clamp01 } from './easings'

/**
 * Sequencer a step delle animazioni autorate. JS puro, nessun React: muta a
 * ogni frame ed è pilotato da un solo `useFrame` in AnimationDirector.jsx.
 *
 * MODELLO — wave. La lista di step viene partizionata una volta al play
 * (`buildWaves`): `parallel: false` apre una wave nuova, `parallel: true` entra
 * in quella precedente. Tutti gli step di una wave partono insieme e si avanza
 * solo quando TUTTI riportano `done`. È tutta la sequenza: un cursore intero.
 *
 * COMPLETAMENTO — in questo codebase non esiste alcun callback di fine
 * movimento, quindi ogni "done" è un predicato interrogato:
 *   wait 'none'      → subito
 *   wait 'duration'  → elapsed >= duration
 *   wait 'settle'    → action.isSettled() (molla della posa, dolly del focus,
 *                      trigger utente), altrimenti la durata
 *   sempre           → il watchdog `maxWait` (0 lo disattiva)
 * Il watchdog non è rifinitura: `goTo` no-oppa in silenzio su chiave ignota o
 * sotto il pose-lock, e la convergenza del focus dipende da `feel.focusDamp`,
 * uno slider Leva. Senza watchdog un valore mistarato incastra l'animazione
 * per sempre e senza errore.
 *
 * FINE ≠ SMONTAGGIO. Quando le wave finiscono lo stato passa a 'finished' e le
 * istanze persistenti continuano a ticchettare (i rotori girano, l'isolate
 * resta): è esattamente ciò che "configurazione rotori" significa come stato di
 * prodotto. Solo `stop()` disfa. Unica deroga, esplicita e per animazione:
 * `stopOnFinish`, per le sequenze cha hanno il compito di RIPORTARE la scena a
 * riposo (la transizione verso idle) e non devono lasciarsi dietro istanze vive.
 *
 * ⚠️ E `stop()` NON è una superficie di prodotto. Nell'HUD non esiste più un
 * comando "ferma": i chip sono un selettore, non un interruttore. Ciò che
 * un'animazione lascia in scena si azzera solo lanciandone un'altra dichiarata
 * `startFrom: 'reset'` (che passa da `stop()` per suo conto) o cambiando
 * modalità di prodotto. Restano a chiamarlo: la transizione idle⇄config, la
 * guardia all'ingresso nell'editor mesh, lo smontaggio del director,
 * `stopOnFinish`, e i comandi di AUTORAZIONE (il ■ dell'editor e
 * `window.__stopAnimation`), che non sono prodotto.
 *
 * SMONTAGGIO MORBIDO. `stop()` non è più istantaneo sull'opacità. Rilasciare gli
 * handle in un frame riporta ogni materiale al suo valore di partenza di scatto,
 * e passare da un'animazione all'altra faceva lampeggiare l'isolate. Adesso lo
 * stop apre una FASE DI RILASCIO: il registry interpola dall'opacità corrente a
 * quella fotografata all'acquire, per `release.duration` secondi con la curva
 * `release.easing`, e solo a fine corsa rilascia davvero (`finish()`, che è
 * l'unico punto in cui tornano `transparent`/`depthWrite` e cadono i cloni).
 * Pivot e varianti restano invece sincroni: sono ownership della gerarchia, non
 * un valore da interpolare. Lo zoom era già smorzato — ha la sua manopola di
 * uscita in useComposerControls.js (`focusOutDamp`).
 *
 * ⚠️ Durante la fase di rilascio un `play()` che azzera lo stato precedente
 * viene MESSO IN CODA, non avviato: altrimenti il fade di uscita e l'opacità
 * della nuova animazione scriverebbero sugli stessi materiali nello stesso
 * frame, e vincerebbe l'ultimo per caso. Questa coda È la transizione fra due
 * animazioni.
 */

// Una tab tornata in primo piano consegna un delta enorme: senza tetto, uno
// step a durata verrebbe saltato in un colpo solo.
const MAX_DT = 1 / 20

// Usati se il chiamante non fornisce una configurazione di rilascio.
const DEFAULT_RELEASE = { duration: 0.5, easing: 'easeInOutCubic' }

export function createAnimationRuntime(ctx) {
  let state = 'idle' // 'idle' | 'playing' | 'finished'
  let anim = null
  let waves = []
  let waveIndex = -1
  let instances = [] // TUTTE le istanze vive, in ordine di start
  let waveInstances = [] // sottoinsieme che fa da gate alla wave corrente
  let loopsLeft = 0
  let variantTargets = {}
  const pendingTriggers = new Set()
  // Fase di rilascio in corso: { restore, t, duration, easing, id } — `id` è
  // l'animazione che l'ha aperta, serve solo alla telemetria.
  let release = null
  // Play messo in coda perché è arrivato durante un rilascio.
  let pending = null

  const isStepDone = (inst) => {
    const s = inst.step
    const maxWait = s.maxWait ?? DEFAULT_MAX_WAIT
    if (maxWait > 0 && inst.elapsed >= maxWait) {
      if (ctx.debug) console.warn('[anim] watchdog scaduto su', s.id, s.action)
      return true
    }
    switch (s.wait) {
      case 'none':
        return true
      case 'duration':
        return inst.elapsed >= (s.duration ?? 0)
      case 'settle':
      default:
        return inst.action.isSettled
          ? inst.action.isSettled(inst, ctx)
          : inst.elapsed >= (s.duration ?? 0)
    }
  }

  const createInstance = (step) => {
    const action = ACTIONS[step.action]
    if (!action) return null
    return {
      step,
      action,
      // Animazione di provenienza: serve al concatenamento (vedi `play`), dove
      // in `instances` convivono istanze EREDITATE da un'animazione precedente
      // e quelle di quella corrente. Senza, due step con lo stesso id in
      // animazioni diverse (JSON copiato a mano) si scambierebbero l'istanza.
      animId: anim?.id ?? null,
      params: step.params ?? {},
      elapsed: 0,
      delayLeft: step.delay ?? 0,
      started: false,
      done: false,
      data: {},
    }
  }

  const startStep = (step) => {
    // UNA sola istanza viva per step.id: al secondo giro di loop un'azione
    // persistente non deve ri-acquisire pivot/materiali, o il refcount non
    // tornerebbe mai a zero. Si riavvia quella che c'è già.
    const existing = instances.find((i) => i.step.id === step.id && i.animId === anim?.id)
    if (existing) {
      existing.elapsed = 0
      existing.done = false
      existing.delayLeft = step.delay ?? 0
      existing.params = step.params ?? {}
      existing.action.restart?.(existing, ctx)
      return existing
    }
    const inst = createInstance(step)
    if (!inst) return null
    instances.push(inst)
    return inst
  }

  const advanceWave = () => {
    waveIndex++
    if (waveIndex >= waves.length) {
      const loop = anim?.loop ?? { mode: 'none' }
      const canLoop = loop.mode === 'forever' || (loop.mode === 'count' && loopsLeft > 0)
      if (!canLoop) {
        state = 'finished'
        waveInstances = []
        // Deroga esplicita a "fine ≠ smontaggio": un'animazione dichiarata
        // `stopOnFinish` esiste per riportare la scena a riposo (la
        // transizione verso idle), quindi si smonta da sola invece di lasciare
        // vive istanze — comprese quelle EREDITATE con `startFrom: 'keep'`,
        // che altrimenti continuerebbero a girare (uno `spinGroup` in idle).
        // Sicuro qui: il ciclo su `instances` in `tick` è già finito quando
        // questa riga svuota l'array.
        if (anim?.stopOnFinish) stop()
        return
      }
      if (loop.mode === 'count') loopsLeft--
      // `from` è un indice di WAVE (vedi animationSchema.js).
      waveIndex = Math.min(loop.from ?? 0, waves.length - 1)
    }
    waveInstances = waves[waveIndex].map(startStep).filter(Boolean)
  }

  const tickInstance = (inst, dt) => {
    if (inst.done && !inst.action.persistent) return
    if (!inst.started) {
      inst.delayLeft -= dt
      if (inst.delayLeft > 0) return
      inst.action.start?.(inst, ctx)
      inst.started = true
      // ⚠️ RETURN PORTANTE. `goTo` scrive il target della molla in modo
      // sincrono, ma la molla lo integra solo al frame SUCCESSIVO: valutando
      // isDone qui, `isPoseSettled()` leggerebbe ancora "corrente === vecchio
      // target, velocità zero" e ogni step di posa passerebbe istantaneamente.
      // Stessa classe di problema per il focus. Uno step avviato al tick n
      // viene valutato per la prima volta al tick n+1.
      return
    }
    inst.elapsed += dt
    inst.action.update?.(inst, ctx, dt)
    if (!inst.done) inst.done = isStepDone(inst)
  }

  /** Avanza la dissolvenza di uscita; a fine corsa rilascia e sblocca la coda. */
  const tickRelease = (dt) => {
    release.t += dt
    const k = release.duration > 0 ? clamp01(release.t / release.duration) : 1
    release.restore.lerp(ease(release.easing, k))
    if (k < 1) return
    release.restore.finish()
    release = null
    if (pending) {
      const { id, opts } = pending
      pending = null
      play(id, opts)
    }
  }

  const tick = (rawDelta) => {
    const dt = Math.min(rawDelta, MAX_DT)
    // Il rilascio vive OLTRE lo stato del sequencer: `stop()` ha già portato
    // `state` a 'idle', ma la dissolvenza di uscita deve continuare.
    if (release) tickRelease(dt)
    if (state === 'idle') return
    // (1) prima si aggiorna TUTTO ciò che è già partito…
    for (const inst of instances) tickInstance(inst, dt)
    // (2) …e solo dopo si valuta l'avanzamento. Con questo ordine, l'ordine dei
    // callback useFrame fra director e useComposerControls è irrilevante.
    if (state === 'playing' && waveInstances.every((i) => i.done)) advanceWave()
  }

  /**
   * Smonta tutto.
   *
   * `soft` (default) apre la fase di rilascio dell'opacità descritta in testa al
   * file invece di riportarla di scatto. Va disattivato quando lo smontaggio
   * deve essere completo ENTRO questa chiamata: ingresso nell'editor mesh (che
   * riparenta le stesse mesh e scrive sugli stessi materiali) e smontaggio del
   * director.
   */
  const stop = ({ soft = true } = {}) => {
    // Un rilascio già in corso viene chiuso subito: due dissolvenze
    // sovrapposte sugli stessi materiali sono due scrittori per frame.
    if (release) {
      release.restore.finish()
      release = null
    }
    pending = null
    // La fotografia va presa PRIMA dei teardown, mentre i materiali sono ancora
    // posseduti: è da lì che parte l'interpolazione.
    const restoreOpacity = soft && instances.length > 0 ? ctx.opacity.beginRestoreAll() : null
    const keepOpacity = !!restoreOpacity && !restoreOpacity.empty
    // Ordine INVERSO di start: un pivot acquisito per ultimo va disfatto per
    // primo, altrimenti si smonta sotto i piedi di chi lo condivide.
    for (let i = instances.length - 1; i >= 0; i--) {
      try {
        // `keepOpacity` dice alle azioni che possiedono materiali di NON
        // rilasciarli: la proprietà passa alla fase di rilascio, che li
        // interpola e li restituisce alla fine. Senza, `disown` rimetterebbe
        // qui e ora opacità, `transparent` e `depthWrite` — cioè esattamente lo
        // scatto che si vuole evitare (e con `transparent: false` il fade non
        // si vedrebbe nemmeno).
        instances[i].action.stop?.(instances[i], ctx, { keepOpacity })
      } catch (err) {
        console.warn('[anim] errore nel teardown di', instances[i].step.id, err)
      }
    }
    const restore = anim?.restoreOnStop !== false
    const stoppedId = anim?.id ?? null
    instances = []
    waveInstances = []
    waves = []
    waveIndex = -1
    anim = null
    state = 'idle'
    pendingTriggers.clear()
    if (restore) ctx.getApi()?.clearFocus?.()
    // Se nel frattempo tutti i materiali fotografati sono stati rilasciati da
    // chi li possedeva (lo scambio di varianti chiude sempre la propria
    // dissolvenza, vedi setVariant), non c'è nulla da dissolvere e non ha senso
    // trattenere un eventuale play in coda.
    if (keepOpacity && restoreOpacity.remaining > 0) {
      // Coercizione esplicita: questi valori arrivano dal JSON, dove una chiave
      // può essere assente o nulla — e un `duration` NaN incastrerebbe la
      // dissolvenza per sempre (`t/NaN` non raggiunge mai 1).
      const cfg = ctx.getRelease?.() ?? {}
      release = {
        restore: restoreOpacity,
        t: 0,
        duration: Number.isFinite(cfg.duration)
          ? Math.max(0, cfg.duration)
          : DEFAULT_RELEASE.duration,
        easing: typeof cfg.easing === 'string' ? cfg.easing : DEFAULT_RELEASE.easing,
        id: stoppedId,
      }
      // Durata zero = comportamento storico, in un colpo solo.
      if (release.duration === 0) tickRelease(0)
    } else {
      restoreOpacity?.finish()
    }
  }

  /**
   * Avvia un'animazione.
   *
   * `startFrom` (per animazione, sovrascrivibile con `opts.keep`) decide cosa
   * fare di ciò che sta già girando:
   *  - `'reset'` (default) — si smonta tutto prima: opacità ripristinata, pivot
   *    disfatti, focus rilasciato se `restoreOnStop` dell'animazione USCENTE lo
   *    consente. È il comportamento di sempre.
   *  - `'keep'` — CONCATENAMENTO: le istanze precedenti restano vive e
   *    continuano a essere ticchettate, e questa animazione parte sopra lo
   *    stato che trova. È ciò che permette di autorare "porta la vista sui
   *    rotori e falli diventare radiografici" e poi, con un secondo play,
   *    "adesso falli girare" senza che zoom e opacità tornino da capo.
   *    Le istanze ereditate restano comunque a carico di `stop()`.
   */
  const play = (id, { fromWave = 0, keep, variantTarget } = {}) => {
    const next = ctx.getAnimations()?.items?.find((a) => a.id === id)
    if (!next) {
      if (ctx.debug) console.warn('[anim] animazione inesistente:', id)
      return false
    }
    const chain = keep ?? next.startFrom === 'keep'
    if (chain) {
      // Il cursore riparte da capo ma NIENTE viene smontato: si azzera solo
      // ciò che descrive la sequenza in corso, non i suoi effetti.
      pendingTriggers.clear()
      // Un rilascio in corso è incompatibile col concatenamento: sta
      // riportando all'opaco proprio i materiali su cui questa animazione
      // vuole continuare a lavorare. Lo si chiude subito.
      if (release) {
        release.restore.finish()
        release = null
      }
      pending = null
    } else {
      // Un rilascio già in corso È lo smontaggio: `stop()` lo troncherebbe di
      // scatto (è ciò che deve fare quando lo chiama qualcun altro). Qui basta
      // rimpiazzare la coda — è il caso di due clic ravvicinati su due
      // animazioni diverse.
      if (!release) stop()
      // Se l'uscita è ancora in dissolvenza, questa animazione parte DOPO:
      // due scrittori sugli stessi materiali nello stesso frame non hanno un
      // vincitore definito. L'attesa È la transizione fra le due.
      if (release) {
        pending = { id, opts: { fromWave, keep: false, variantTarget } }
        return true
      }
    }
    // Intento di swap passato dal toggle dell'HUD: un'animazione di scambio
    // autorata lascia vuoto l'`optionId` del proprio step `setVariant` e
    // funziona così in ENTRAMBI i versi (ISO→ANSI e ANSI→ISO) invece che nel
    // solo verso cablato a mano.
    variantTargets = variantTarget ?? {}
    anim = next
    waves = buildWaves(next)
    if (waves.length === 0) return false
    loopsLeft = next.loop?.mode === 'count' ? Math.max(0, (next.loop.times ?? 1) - 1) : 0
    waveIndex = Math.min(Math.max(0, fromWave), waves.length - 1) - 1
    state = 'playing'
    advanceWave()
    return true
  }

  const trigger = (name) => {
    pendingTriggers.add(name)
  }

  /** Consuma un trigger: è il predicato di `waitTrigger`. */
  const consumeTrigger = (name) => {
    if (!pendingTriggers.has(name)) return false
    pendingTriggers.delete(name)
    return true
  }

  /** Lo step `waitTrigger` che sta bloccando adesso, se c'è — l'HUD ci disegna un chip. */
  const waitingTrigger = () => {
    if (state !== 'playing') return null
    const inst = waveInstances.find(
      (i) => i.started && !i.done && i.step.action === 'waitTrigger',
    )
    return inst ? { name: inst.params.name, label: inst.params.label } : null
  }

  // Durante un rilascio con un play in coda l'animazione "corrente" è già
  // quella richiesta: il chip dell'HUD deve accendersi al clic, non alla fine
  // della dissolvenza di uscita.
  const pendingAnim = () =>
    pending ? ctx.getAnimations()?.items?.find((a) => a.id === pending.id) ?? null : null

  const getState = () => {
    const p = pendingAnim()
    return {
      id: anim?.id ?? p?.id ?? null,
      label: anim?.label ?? p?.label ?? null,
      // 'releasing' = nessuna sequenza sta girando, ma la scena sta ancora
      // tornando indietro (opacità in dissolvenza, zoom in uscita).
      state: anim ? state : release ? 'releasing' : state,
      waveIndex,
      waveCount: waves.length,
      waitingTrigger: waitingTrigger(),
      instances: instances.map((i) => ({
        step: i.step.id,
        action: i.step.action,
        started: i.started,
        done: i.done,
        elapsed: Number(i.elapsed.toFixed(3)),
      })),
    }
  }

  // Include il play in coda: chi lo usa per decidere "c'è qualcosa da fermare?"
  // (l'HUD, prima di cambiare posa) deve fermare anche una transizione appena
  // richiesta, non solo una sequenza già partita.
  const currentId = () => anim?.id ?? pending?.id ?? null

  /** Opzione richiesta dal chiamante per una variante, se l'ha indicata. */
  const variantTargetFor = (variantId) => variantTargets?.[variantId] ?? null

  return { tick, play, stop, trigger, consumeTrigger, getState, currentId, variantTargetFor }
}
