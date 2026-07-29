import { ACTIONS, DEFAULT_MAX_WAIT } from './actions'
import { buildWaves } from './animationSchema'

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
 * prodotto. Solo `stop()` disfa.
 */

// Una tab tornata in primo piano consegna un delta enorme: senza tetto, uno
// step a durata verrebbe saltato in un colpo solo.
const MAX_DT = 1 / 20

export function createAnimationRuntime(ctx) {
  let state = 'idle' // 'idle' | 'playing' | 'finished'
  let anim = null
  let waves = []
  let waveIndex = -1
  let instances = [] // TUTTE le istanze vive, in ordine di start
  let waveInstances = [] // sottoinsieme che fa da gate alla wave corrente
  let loopsLeft = 0
  const pendingTriggers = new Set()

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
    const existing = instances.find((i) => i.step.id === step.id)
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

  const tick = (rawDelta) => {
    if (state === 'idle') return
    const dt = Math.min(rawDelta, MAX_DT)
    // (1) prima si aggiorna TUTTO ciò che è già partito…
    for (const inst of instances) tickInstance(inst, dt)
    // (2) …e solo dopo si valuta l'avanzamento. Con questo ordine, l'ordine dei
    // callback useFrame fra director e useComposerControls è irrilevante.
    if (state === 'playing' && waveInstances.every((i) => i.done)) advanceWave()
  }

  const stop = () => {
    // Ordine INVERSO di start: un pivot acquisito per ultimo va disfatto per
    // primo, altrimenti si smonta sotto i piedi di chi lo condivide.
    for (let i = instances.length - 1; i >= 0; i--) {
      try {
        instances[i].action.stop?.(instances[i], ctx)
      } catch (err) {
        console.warn('[anim] errore nel teardown di', instances[i].step.id, err)
      }
    }
    const restore = anim?.restoreOnStop !== false
    instances = []
    waveInstances = []
    waves = []
    waveIndex = -1
    anim = null
    state = 'idle'
    pendingTriggers.clear()
    if (restore) ctx.getApi()?.clearFocus?.()
  }

  const play = (id, { fromWave = 0 } = {}) => {
    const next = ctx.getAnimations()?.items?.find((a) => a.id === id)
    if (!next) {
      if (ctx.debug) console.warn('[anim] animazione inesistente:', id)
      return false
    }
    // I play sono esclusivi: si smonta sempre quello in corso prima.
    stop()
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

  const getState = () => ({
    id: anim?.id ?? null,
    label: anim?.label ?? null,
    state,
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
  })

  const currentId = () => anim?.id ?? null

  return { tick, play, stop, trigger, consumeTrigger, getState, currentId }
}
