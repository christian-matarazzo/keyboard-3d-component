import * as THREE from 'three'
import { resolveSelector } from './selectors'
import { groupCenterInScene } from './pivot'
import { OFFSET_CHANNEL } from './pivotRegistry'
import { ease, clamp01 } from './easings'
import { variantOptionMeshes, forceVariantVisible } from '../materials/meshVariants'

/**
 * Registry delle azioni — UNICA fonte di verità che tiene insieme due cose che
 * altrimenti divergerebbero: lo SCHEMA dei parametri (da cui AnimationEditor
 * genera i campi) e l'IMPLEMENTAZIONE a runtime.
 *
 * Forma di una voce:
 * {
 *   label, group,                 // group = raggruppamento del menu "+ Step"
 *   persistent,                   // l'effetto sopravvive alla wave e va disfatto in stop()
 *   durationDriven,               // `duration` è la durata DELL'AZIONE, non solo un'attesa
 *   defaults: { wait, duration, easing, maxWait },
 *   params: [ { key, type, label, default, … } ],
 *   start(inst, ctx), update(inst, ctx, dt), isSettled(inst, ctx),
 *   restart(inst, ctx),           // riavvio su un giro di loop (azioni persistenti)
 *   stop(inst, ctx),              // teardown, chiamato SOLO da stopAnimation()
 *   inverse(step, ctx),           // AUTORAZIONE, non runtime: come si disfa
 *   inverseNote,                  // perché non si disfa, se inverse() dà null
 * }
 *
 * `inverse` sta QUI e non nel generatore di animazioni inverse per la stessa
 * ragione per cui ci stanno schema e implementazione: se la conoscenza di cosa
 * un'azione fa e di come la si annulla vive in due file, i due divergono al
 * primo parametro aggiunto. Riceve lo step AUTORATO (dato statico, non
 * un'istanza viva) e restituisce `{ action?, params? }` — `action` assente vuol
 * dire "stessa azione, altri parametri" — oppure `null` per "non invertibile,
 * salta". Vedi animationTransforms.js.
 *
 * `inst` è l'istanza viva dello step: { step, action, params, elapsed, data }.
 * `ctx` è { getApi, getScene, groups, opacity, pivots, runtime, debug }.
 *
 * Tipi di parametro che l'editor sa disegnare:
 *   'number' | 'boolean' | 'string' | 'select' | 'vec3' | 'selector' | 'group'
 *   | 'pose' | 'easing'
 */

export const DEFAULT_MAX_WAIT = 8

const AXIS_VEC = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
}

/** Frazione 0..1 dell'avanzamento di uno step a durata, già passata per l'easing. */
const progress = (inst) => {
  const d = inst.step.duration ?? 0
  if (d <= 0) return 1
  return ease(inst.step.easing, clamp01(inst.elapsed / d))
}

/**
 * Acquisizione dei pivot per OGNI azione che trasforma geometria, rotatoria o
 * no. Una forma sola: risolvi il selettore, prendi un handle per mesh (è
 * l'unica granularità che esiste, vedi pivotRegistry.js) e apri su ognuno il
 * canale di QUESTO step.
 *
 * ⚠️ `perMesh` non cambia più quali pivot si prendono — cambia solo il CENTRO
 * scritto nei canali: il centro proprio di ogni mesh (ognuna gira/si muove dove
 * sta) oppure il centro comune del gruppo (le mesh si muovono come un corpo
 * rigido, quindi orbitano e traslano). Prima erano due gerarchie diverse, ed è
 * da lì che nasceva l'impossibilità di far convivere due step su insiemi che si
 * sovrappongono solo in parte.
 */
const acquireHandles = (
  inst,
  ctx,
  { perMesh = inst.params.perMesh, channelKey = inst.step.id } = {},
) => {
  const scene = ctx.getScene()
  const meshes = resolveSelector(scene, ctx.groups, inst.params.selector)
  const handles = ctx.pivots.acquireAll(meshes)
  if (handles.length === 0) return []
  const center = perMesh ? null : groupCenterInScene(meshes, scene)
  inst.data.channelKey = channelKey
  inst.data.handles = handles.map((h, i) => ({
    h,
    ch: h.channel(channelKey, center),
    // Segno alternato: mesh pari in un verso, dispari nell'altro.
    sign: inst.params.alternate && i % 2 ? -1 : 1,
  }))
  return inst.data.handles
}

/** Asse di rotazione: gli assi del pivot SONO quelli del modello (vedi registry). */
const axisOf = (inst) => AXIS_VEC[inst.params.axis] ?? AXIS_VEC.y

/** Traslazione rigida `v · scale` su N handle, per lo scorrimento delle varianti. */
const slideHandles = (handles, stepId, v, scale) => {
  for (const h of handles ?? []) {
    h.channel(stepId).translation.copy(v).multiplyScalar(scale)
    h.compose()
  }
}

const releaseHandles = (inst) => {
  const key = inst.data.channelKey ?? inst.step.id
  for (const { h } of inst.data.handles ?? []) {
    h.clear(key)
    h.compose() // rimette la posa senza questo contributo prima di mollare
    h.release()
  }
  inst.data.handles = null
}

export const ACTIONS = {
  // ── Camera ────────────────────────────────────────────────────────────────

  goToPose: {
    label: 'Vai alla posa',
    group: 'camera',
    defaults: { wait: 'settle' },
    params: [{ key: 'poseKey', type: 'pose', default: 'TL', label: 'Posa' }],
    start(inst, ctx) {
      ctx.getApi()?.goTo?.(inst.params.poseKey)
    },
    // La molla di useComposerControls SNAPPA esattamente sul target e azzera la
    // velocità quando converge, quindi il predicato è un'uguaglianza esatta:
    // niente soglia da tarare.
    isSettled(inst, ctx) {
      return ctx.getApi()?.isPoseSettled?.() ?? true
    },
    // L'inverso di "vai a P" è "torna dove eri", e dov'eri lo dice il
    // `goToPose` che precede questo nella sequenza — per il primo, la posa da
    // cui l'animazione è partita, che il generatore passa qui (la home: è il
    // punto di partenza di entrambe le modalità di prodotto). Non conoscendola
    // si resta sulla propria, che è meglio di una posa a caso.
    inverse: (step, ctx) => ({
      params: { poseKey: ctx?.previousPose ?? step.params?.poseKey },
    }),
  },

  focusGroup: {
    label: 'Inquadra gruppo',
    group: 'camera',
    defaults: { wait: 'settle' },
    params: [
      { key: 'groupId', type: 'group', default: '', label: 'Gruppo' },
      { key: 'radiusFactor', type: 'number', default: null, min: 0.1, max: 3, step: 0.01, label: 'distanza (×)', optional: true },
      { key: 'offsetX', type: 'number', default: null, min: -2, max: 2, step: 0.01, label: 'offset X', optional: true },
      { key: 'offsetY', type: 'number', default: null, min: -2, max: 2, step: 0.01, label: 'offset Y', optional: true },
      { key: 'offsetZ', type: 'number', default: null, min: -2, max: 2, step: 0.01, label: 'offset Z', optional: true },
    ],
    start(inst, ctx) {
      const { groupId, ...rest } = inst.params
      // Solo le override effettivamente autorate nello step: `null` significa
      // "usa il valore del FocusTuner", non "azzera".
      const extra = {}
      for (const [k, v] of Object.entries(rest)) if (v != null) extra[k] = v
      ctx.getApi()?.focusGroup?.(groupId, Object.keys(extra).length ? extra : null)
    },
    isSettled(inst, ctx) {
      return ctx.getApi()?.isFocusSettled?.() ?? true
    },
    // ⚠️ Con `restoreOpacity` spento di proposito: in un'inverso generato ci
    // sono già gli inversi espliciti dei singoli `setOpacity`, e il ripristino
    // globale scriverebbe sugli stessi materiali nello stesso frame — due
    // scrittori senza un vincitore definito.
    inverse: () => ({ action: 'clearFocus', params: { restoreOpacity: false } }),
  },

  // Non è solo l'inverso di focusGroup: è il "torna com'era" completo, quindi
  // riporta anche l'OPACITÀ dove stava prima che l'animazione la toccasse —
  // interpolata sulla stessa `duration`, non azzerata di scatto. Senza questo,
  // uscire da un isolamento richiedeva un `setOpacity` inverso autorato a mano
  // (e su quale selettore? l'opacità può essere stata presa da più step
  // diversi). Il ripristino passa dal registry, che è l'unico a sapere quali
  // materiali sono sotto override e con che valore di partenza.
  clearFocus: {
    label: 'Torna all’insieme',
    group: 'camera',
    // `persistent` non perché lasci qualcosa acceso, ma perché il runtime
    // smette di ticchettare le istanze NON persistenti appena sono `done`: con
    // un `wait` diverso da 'settle' la dissolvenza dell'opacità resterebbe
    // congelata a metà. Così continua a essere aggiornata fino a fine corsa
    // qualunque cosa faccia la wave.
    persistent: true,
    durationDriven: true,
    defaults: { wait: 'settle', duration: 0.5, easing: 'easeInOutCubic' },
    params: [
      {
        key: 'restoreOpacity',
        type: 'boolean',
        default: true,
        label: 'Ripristina opacità',
      },
    ],
    start(inst, ctx) {
      ctx.getApi()?.clearFocus?.()
      if (inst.params.restoreOpacity !== false) {
        inst.data.restore = ctx.opacity.beginRestoreAll()
      }
    },
    update(inst) {
      const r = inst.data.restore
      if (!r || r.done) return
      const k = progress(inst)
      r.lerp(k)
      // Il rilascio (che rimette transparent/depthWrite e smonta i cloni)
      // avviene solo a fine corsa: farlo prima significherebbe uno scatto.
      if (k >= 1) r.finish()
    },
    isSettled(inst, ctx) {
      const cameraDone = ctx.getApi()?.isFocusSettled?.() ?? true
      const opacityDone = !inst.data.restore || inst.data.restore.done
      return cameraDone && opacityDone
    },
    stop(inst, ctx, opts) {
      // Con `keepOpacity` il rilascio globale ha già fotografato questi
      // materiali e li sta interpolando: chiudere qui il ripristino parziale
      // significherebbe rilasciarli sotto i suoi piedi (e farli scattare).
      if (opts?.keepOpacity) return
      inst.data.restore?.finish()
    },
    inverse: () => null,
    inverseNote: 'non si sa quale gruppo re-inquadrare',
  },

  // ── Materiali ─────────────────────────────────────────────────────────────

  setOpacity: {
    label: 'Opacità / isola',
    group: 'materiali',
    persistent: true,
    durationDriven: true,
    defaults: { wait: 'duration', duration: 0.4, easing: 'easeInOutCubic' },
    params: [
      { key: 'selector', type: 'selector', default: { kind: 'all' }, label: 'Mesh' },
      { key: 'opacity', type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, label: 'Opacità' },
      // depthWrite: true di default. Rendere trasparenti ~250 mesh le sposta
      // già nel pass ordinato in profondità; spegnere anche depthWrite produce
      // artefatti di ordinamento sui keycap che si compenetrano.
      { key: 'depthWrite', type: 'boolean', default: true, label: 'Scrivi profondità', advanced: true },
    ],
    start(inst, ctx) {
      const meshes = resolveSelector(ctx.getScene(), ctx.groups, inst.params.selector)
      if (meshes.length === 0) return
      inst.data.handle = ctx.opacity.acquire(meshes, { depthWrite: inst.params.depthWrite !== false })
      inst.data.from = inst.data.handle.readCurrent()
    },
    update(inst) {
      // ⚠️ Una volta a regime NON si riscrive più. Questa istanza è
      // `persistent`, quindi il runtime continua a ticchettarla anche dopo che
      // è `done`: continuare a riscrivere il valore finale ogni frame non solo
      // è lavoro sprecato, ma si contenderebbe gli stessi materiali con il
      // ripristino graduale di `clearFocus`, che perderebbe (l'ultimo
      // scrittore del frame vince).
      if (inst.data.settled) return
      const k = progress(inst)
      inst.data.handle?.lerpTo(inst.data.from, inst.params.opacity, k)
      if (k >= 1) inst.data.settled = true
    },
    restart(inst) {
      // Su un giro di loop si riparte dal valore attuale, non da quello di tre
      // giri fa.
      inst.data.from = inst.data.handle?.readCurrent()
      inst.data.settled = false
    },
    stop(inst, ctx, opts) {
      // Smontaggio morbido: la proprietà dei materiali passa alla fase di
      // rilascio del runtime, che li riporta all'opaco interpolando. Rilasciare
      // qui rimetterebbe opacità/transparent/depthWrite in un frame — lo scatto
      // che quella fase esiste per togliere.
      if (opts?.keepOpacity) return
      inst.data.handle?.release()
      inst.data.handle = null
    },
    // ⚠️ Torna a 1, NON al valore fotografato all'acquire: quello lo conosce
    // solo il registry a runtime, mentre uno step autorato è un dato statico.
    // Su un materiale del GLB autorato semitrasparente l'inverso va corretto a
    // mano (o si usa "Torna all'insieme", che ripristina la fotografia).
    inverse: () => ({ params: { opacity: 1 } }),
  },

  // ── Trasformazioni ────────────────────────────────────────────────────────

  spinGroup: {
    label: 'Rotazione continua',
    group: 'trasformazioni',
    persistent: true,
    defaults: { wait: 'none' },
    params: [
      { key: 'selector', type: 'selector', default: { kind: 'group', groupId: 'rotors' }, label: 'Mesh' },
      { key: 'axis', type: 'select', options: ['x', 'y', 'z'], default: 'y', label: 'Asse' },
      { key: 'speedDeg', type: 'number', default: 90, min: -720, max: 720, step: 1, label: '°/s' },
      { key: 'alternate', type: 'boolean', default: true, label: 'Segno alternato' },
      { key: 'rampIn', type: 'number', default: 0.3, min: 0, max: 5, step: 0.05, label: 'Rampa (s)', advanced: true },
    ],
    start(inst, ctx) {
      // Sempre sul PROPRIO centro: "gira su se stessa" è tutto il senso di
      // questa azione. Attorno al baricentro comune ci si va con rotateBy a
      // `perMesh` spento, che è tutt'altra animazione.
      acquireHandles(inst, ctx, { perMesh: true })
      inst.data.angle = 0
    },
    update(inst, ctx, dt) {
      const ramp = inst.params.rampIn > 0 ? clamp01(inst.elapsed / inst.params.rampIn) : 1
      inst.data.angle += THREE.MathUtils.degToRad(inst.params.speedDeg) * ramp * dt
      const axis = axisOf(inst)
      for (const { h, ch, sign } of inst.data.handles ?? []) {
        ch.quat.setFromAxisAngle(axis, inst.data.angle * sign)
        h.compose()
      }
    },
    // Nessun restart: su un giro di loop la rotazione continua da dov'era
    // invece di scattare a zero.
    restart() {},
    stop(inst) {
      releaseHandles(inst)
    },
    inverse: () => null,
    inverseNote:
      'una rotazione continua non ha un inverso: la chiude il rilascio di fine sequenza',
  },

  // Rotazione FINITA, contrapposta a spinGroup: gira di un angolo dato e si
  // ferma lì. È l'altra metà del bisogno ("mostrami l'altro lato di questo
  // pezzo") e non si ottiene con spinGroup, che per costruzione non finisce.
  // Rispetto a transformOffset ha una UI a un solo asse invece di un vec3, ed è
  // il motivo per cui esiste come preset separato invece che come suo caso.
  rotateBy: {
    label: 'Ruota di (finita)',
    group: 'trasformazioni',
    persistent: true,
    durationDriven: true,
    defaults: { wait: 'duration', duration: 1, easing: 'easeInOutCubic' },
    params: [
      { key: 'selector', type: 'selector', default: { kind: 'group', groupId: '' }, label: 'Mesh' },
      { key: 'axis', type: 'select', options: ['x', 'y', 'z'], default: 'y', label: 'Asse' },
      { key: 'angleDeg', type: 'number', default: 180, min: -1440, max: 1440, step: 1, label: 'Angolo°' },
      // ⚠️ Distinzione che si sbaglia facilmente, e che con più mesh dà due
      // risultati completamente diversi: spento, le mesh ruotano RIGIDAMENTE
      // attorno al loro centro comune, quindi si scambiano di posto e
      // traslano — con due manopole affiancate ognuna scorre di quasi il
      // proprio diametro, esce dalla sede e entra in ciò che ha intorno.
      // Acceso, ognuna gira sul proprio centro restando dov'è. Per un preset
      // di ROTAZIONE il secondo è quasi sempre l'intento, quindi è il default.
      { key: 'perMesh', type: 'boolean', default: true, label: 'Ognuna sul proprio centro' },
      { key: 'alternate', type: 'boolean', default: false, label: 'Segno alternato' },
    ],
    start(inst, ctx) {
      acquireHandles(inst, ctx)
    },
    update(inst) {
      // A regime si smette: l'istanza è persistente (tiene i pivot), quindi il
      // runtime continuerebbe a ticchettarla e a ricomporre N pivot ogni frame
      // per riscrivere lo stesso quaternion.
      if (inst.data.settled) return
      const k = progress(inst)
      const angle = THREE.MathUtils.degToRad(inst.params.angleDeg) * k
      const axis = axisOf(inst)
      for (const { h, ch, sign } of inst.data.handles ?? []) {
        ch.quat.setFromAxisAngle(axis, angle * sign)
        h.compose()
      }
      if (k >= 1) inst.data.settled = true
    },
    restart(inst) {
      inst.data.settled = false
    },
    stop(inst) {
      releaseHandles(inst)
    },
    // Angolo opposto. Funziona anche a canali distinti: lo step diretto tiene
    // il suo (fermo, a regime non riscrive più) e questo ne apre uno nuovo —
    // due rotazioni opposte attorno allo STESSO centro si compongono
    // nell'identità (vedi compose() in pivotRegistry.js).
    inverse: (step) => ({ params: { angleDeg: -(step.params?.angleDeg ?? 0) } }),
  },

  // Oscillazione smorzata attorno a un asse: il "wobble" da vetrina, quello che
  // segnala che un pezzo è selezionato o appena montato. `decay` è la costante
  // di tempo dello smorzamento in secondi — a 0 l'oscillazione non si spegne
  // mai, ed è l'unico modo di ottenere un dondolio perpetuo.
  wobble: {
    label: 'Wobble (oscillazione)',
    group: 'trasformazioni',
    persistent: true,
    defaults: { wait: 'none', duration: 1.5 },
    params: [
      { key: 'selector', type: 'selector', default: { kind: 'group', groupId: '' }, label: 'Mesh' },
      { key: 'axis', type: 'select', options: ['x', 'y', 'z'], default: 'z', label: 'Asse' },
      { key: 'amplitudeDeg', type: 'number', default: 8, min: 0, max: 180, step: 0.5, label: 'Ampiezza°' },
      { key: 'frequency', type: 'number', default: 1.6, min: 0.05, max: 12, step: 0.05, label: 'Frequenza (Hz)' },
      { key: 'decay', type: 'number', default: 1.2, min: 0, max: 20, step: 0.1, label: 'Smorzamento (s, 0 = mai)' },
      // Vedi la nota su rotateBy: spento = blocco rigido che orbita attorno al
      // centro comune, acceso = ognuna oscilla dove sta.
      { key: 'perMesh', type: 'boolean', default: true, label: 'Ognuna sul proprio centro' },
      // Con pivot per mesh, sfasare ogni mesh evita che N pezzi oscillino
      // all'unisono come un blocco unico.
      { key: 'phasePerMesh', type: 'number', default: 0, min: 0, max: 360, step: 5, label: 'Sfasamento per mesh°' },
    ],
    start(inst, ctx) {
      acquireHandles(inst, ctx)
    },
    update(inst) {
      const amp = THREE.MathUtils.degToRad(inst.params.amplitudeDeg)
      const decay = inst.params.decay > 0 ? Math.exp(-inst.elapsed / inst.params.decay) : 1
      const w = 2 * Math.PI * inst.params.frequency * inst.elapsed
      const phase = THREE.MathUtils.degToRad(inst.params.phasePerMesh ?? 0)
      const axis = axisOf(inst)
      const handles = inst.data.handles ?? []
      for (let i = 0; i < handles.length; i++) {
        const { h, ch } = handles[i]
        ch.quat.setFromAxisAngle(axis, amp * decay * Math.sin(w + i * phase))
        h.compose()
      }
    },
    // Nessun restart necessario: il runtime azzera già `elapsed` quando
    // riavvia un'istanza persistente su un giro di loop, ed è esattamente ciò
    // che serve qui — l'inviluppo di smorzamento riparte da capo invece di
    // trovarsi già spento.
    stop(inst) {
      releaseHandles(inst)
    },
    inverse: () => null,
    inverseNote: 'l’oscillazione si spegne da sé',
  },

  transformOffset: {
    label: 'Sposta / ruota',
    group: 'trasformazioni',
    persistent: true,
    durationDriven: true,
    defaults: { wait: 'duration', duration: 0.8, easing: 'easeInOutCubic' },
    params: [
      { key: 'selector', type: 'selector', default: { kind: 'group', groupId: '' }, label: 'Mesh' },
      // Qui il default OPPOSTO a rotateBy/wobble è voluto: una traslazione di
      // gruppo rigida è l'intento normale ("sposta i rotori"), mentre il
      // per-mesh è l'esploso, che si chiede apposta.
      { key: 'perMesh', type: 'boolean', default: false, label: 'Ognuna sul proprio centro (esplodi)' },
      { key: 'position', type: 'vec3', default: [0, 0, 0], min: -100, max: 100, step: 0.05, label: 'Posizione' },
      { key: 'rotation', type: 'vec3', default: [0, 0, 0], min: -180, max: 180, step: 1, unit: '°', label: 'Rotazione' },
    ],
    start(inst, ctx) {
      // Canale CONDIVISO fra tutti gli offset (vedi OFFSET_CHANNEL): è ciò che
      // rende `position: [0,0,0]` un vero "torna alla posa di riposo".
      if (acquireHandles(inst, ctx, { channelKey: OFFSET_CHANNEL }).length === 0) return
      // Si interpola DA dove il canale è ORA: uno step che risolve mesh già
      // spostate da uno step precedente lo ritrova a metà strada e ci riparte.
      // Col possesso per mesh questo vale anche quando i due bersagli si
      // sovrappongono solo in parte — il caso che prima era irrealizzabile.
      inst.data.from = inst.data.handles.map(({ ch }) => ({
        pos: ch.translation.clone(),
        quat: ch.quat.clone(),
      }))
      const [rx, ry, rz] = inst.params.rotation ?? [0, 0, 0]
      inst.data.targetPos = new THREE.Vector3(...(inst.params.position ?? [0, 0, 0]))
      inst.data.targetQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(rx),
          THREE.MathUtils.degToRad(ry),
          THREE.MathUtils.degToRad(rz),
        ),
      )
    },
    update(inst) {
      // Stessa ragione di rotateBy: a regime si smette di ricomporre.
      if (inst.data.settled) return
      const k = progress(inst)
      const handles = inst.data.handles ?? []
      for (let i = 0; i < handles.length; i++) {
        const { h, ch } = handles[i]
        const from = inst.data.from[i]
        ch.translation.lerpVectors(from.pos, inst.data.targetPos, k)
        ch.quat.slerpQuaternions(from.quat, inst.data.targetQuat, k)
        h.compose()
      }
      if (k >= 1) inst.data.settled = true
    },
    restart(inst) {
      inst.data.from = (inst.data.handles ?? []).map(({ ch }) => ({
        pos: ch.translation.clone(),
        quat: ch.quat.clone(),
      }))
      inst.data.settled = false
    },
    stop(inst) {
      releaseHandles(inst)
    },
    // ⚠️ Il canale degli offset è CONDIVISO (OFFSET_CHANNEL) e si interpola da
    // dove lo si trova: riportarlo a zero è letteralmente "torna alla posa di
    // riposo". È il motivo per cui l'inverso di un esploso è questo e non un
    // offset di segno opposto, che invece raddoppierebbe lo spostamento.
    inverse: () => ({ params: { position: [0, 0, 0], rotation: [0, 0, 0] } }),
  },

  // ── Varianti ──────────────────────────────────────────────────────────────

  /**
   * Commuta una variante di modello (layout ISO/ANSI e, in futuro, altro)
   * incrociando le due opzioni in dissolvenza.
   *
   * ⚠️ Asimmetria voluta rispetto a tutte le altre azioni: la scelta della
   * variante è **stato dell'utente**, non un effetto dell'animazione. Quindi
   * `stop()` NON la annulla — a differenza di opacità e trasformazioni, che
   * tornano sempre indietro. Fermare l'animazione di swap deve lasciare il
   * layout che l'utente ha chiesto, non riportarlo a quello di prima.
   *
   * La scelta viene committata subito allo start (così il toggle dell'HUD
   * risponde all'istante) mentre la mesh uscente resta visibile grazie
   * all'hold del VariantController; la si spegne a dissolvenza finita.
   *
   * Oltre alla dissolvenza può TRASLARE le due opzioni: `offsetIn` è il punto
   * da cui entra quella nuova, `offsetOut` quello verso cui esce la vecchia,
   * entrambi a zero di default (quindi il comportamento storico resta il
   * crossfade puro). Direzioni opposte danno lo scorrimento tipo carosello,
   * la stessa direzione dà un incrocio, una sola valorizzata muove solo quella.
   * I pivot si acquisiscono SOLO se almeno un offset è non nullo: reparentare
   * mesh per traslare di zero sarebbe lavoro e rischio gratuiti.
   *
   * ⚠️ Gli offset sono in unità LOCALI del GLB, come gli slider Pos di
   * MeshController e di `transformOffset` — non in unità-scena. Su questo
   * asset il fattore è ~0.0096, quindi un centesimo di unità mondo vale circa
   * un'unità qui: si tarano a occhio, non a calcolo.
   *
   */
  setVariant: {
    label: 'Cambia variante',
    group: 'varianti',
    persistent: true,
    durationDriven: true,
    defaults: { wait: 'duration', duration: 0.5, easing: 'easeInOutCubic' },
    params: [
      { key: 'variantId', type: 'variant', default: '', label: 'Variante' },
      // Lasciato vuoto = "quella chiesta da chi ha lanciato l'animazione"
      // (il toggle dell'HUD). È così che una sola animazione di swap serve
      // entrambi i versi invece di uno solo.
      { key: 'optionId', type: 'variantOption', default: '', label: 'Opzione' },
      { key: 'offsetIn', type: 'vec3', default: [0, 0, 0], min: -200, max: 200, step: 0.5, label: 'Entra da' },
      { key: 'offsetOut', type: 'vec3', default: [0, 0, 0], min: -200, max: 200, step: 0.5, label: 'Esce verso' },
    ],
    start(inst, ctx) {
      const api = ctx.getApi()
      const { variantId } = inst.params
      const optionId = inst.params.optionId || ctx.runtime.variantTargetFor(variantId)
      const from = api?.currentVariants?.()?.[variantId]
      if (!variantId || !optionId || from === optionId) {
        inst.data.skip = true
        return
      }
      const scene = ctx.getScene()
      const incoming = variantOptionMeshes(scene, ctx.variants, variantId, optionId)
      const outgoing = variantOptionMeshes(scene, ctx.variants, variantId, from)
      if (incoming.length === 0) { inst.data.skip = true; return }

      // Ordine importante: hold PRIMA del commit, o l'effetto del controller
      // spegnerebbe la mesh uscente nello stesso frame.
      api?.holdVariant?.(variantId)
      forceVariantVisible(incoming, true)
      api?.setVariant?.(variantId, optionId)

      inst.data.variantId = variantId
      inst.data.outgoing = outgoing
      inst.data.inHandle = ctx.opacity.acquire(incoming)
      inst.data.outHandle = outgoing.length ? ctx.opacity.acquire(outgoing) : null
      inst.data.outFrom = inst.data.outHandle?.readCurrent()
      inst.data.inHandle.set(0)

      // Traslazione opzionale. I pivot si prendono solo se serve davvero:
      // reparentare mesh per traslare di zero sarebbe lavoro e rischio gratuiti.
      // Traslazione pura, quindi il centro dei canali è indifferente.
      const vIn = new THREE.Vector3(...(inst.params.offsetIn ?? [0, 0, 0]))
      const vOut = new THREE.Vector3(...(inst.params.offsetOut ?? [0, 0, 0]))
      if (vIn.lengthSq() > 0) {
        inst.data.inPivots = ctx.pivots.acquireAll(incoming)
        inst.data.vIn = vIn
        slideHandles(inst.data.inPivots, inst.step.id, vIn, 1)
      }
      if (vOut.lengthSq() > 0 && outgoing.length) {
        inst.data.outPivots = ctx.pivots.acquireAll(outgoing)
        inst.data.vOut = vOut
      }
    },
    update(inst, ctx) {
      if (inst.data.skip || inst.data.settled) return
      const k = progress(inst)
      inst.data.inHandle?.set(k)
      inst.data.outHandle?.lerpTo(inst.data.outFrom, 0, k)
      // L'entrante va da `offsetIn` a zero, l'uscente da zero a `offsetOut`.
      slideHandles(inst.data.inPivots, inst.step.id, inst.data.vIn, 1 - k)
      slideHandles(inst.data.outPivots, inst.step.id, inst.data.vOut, k)
      if (k >= 1) {
        inst.data.settled = true
        inst.action.finish(inst, ctx)
      }
    },
    /** Chiude la transizione: spegne l'uscente e molla materiali e pivot. */
    finish(inst, ctx) {
      if (inst.data.done) return
      inst.data.done = true
      inst.data.inHandle?.release()
      inst.data.outHandle?.release()
      // Il canale va tolto PRIMA del rilascio: l'unwind ripristina la
      // trasformata locale fotografata al wrap, ma il canale è roba nostra e
      // un handle condiviso con un'altra azione se lo ritroverebbe sporco.
      for (const h of [...(inst.data.inPivots ?? []), ...(inst.data.outPivots ?? [])]) {
        h.clear(inst.step.id)
        h.compose()
        h.release()
      }
      inst.data.inPivots = null
      inst.data.outPivots = null
      if (inst.data.outgoing) forceVariantVisible(inst.data.outgoing, false)
      ctx?.getApi?.()?.releaseVariantHold?.(inst.data.variantId)
    },
    /**
     * ⚠️ Unica azione che deve RIFARE `start()` a ogni riavvio, e la ragione è
     * strutturale: è l'unica persistente che rilascia i propri handle già a
     * fine dissolvenza (`finish`) pur restando un'istanza viva. Tutte le altre
     * tengono materiali e pivot finché non arriva `stop()`, quindi a loro basta
     * ricalcolare i valori di partenza.
     *
     * Senza questo, rigiocando la stessa animazione di swap — che è ciò che fa
     * il toggle a ogni clic, e con `startFrom: 'keep'` non passa da `stop()` —
     * il runtime riuserebbe l'istanza precedente: handle già rilasciati, verso
     * della volta prima, nessun hold. Risultato osservato in browser: il
     * secondo scambio non avviene e le mesh uscenti restano a opacità 0 pur
     * essendo spente, cioè invisibili anche una volta riaccese.
     */
    restart(inst, ctx) {
      inst.action.finish(inst, ctx) // chiude la transizione precedente, se aperta
      inst.data = {}
      inst.action.start(inst, ctx)
    },
    stop(inst, ctx) {
      if (inst.data.skip) return
      inst.action.finish(inst, ctx)
    },
    // Stessa asimmetria di `stop()`: la scelta della variante è stato
    // dell'utente, non un effetto dell'animazione, quindi un'inverso non la
    // rimette indietro.
    inverse: () => null,
    inverseNote: 'la scelta della variante è dell’utente, non la si annulla',
  },

  // ── Flusso ────────────────────────────────────────────────────────────────

  waitTime: {
    label: 'Attesa',
    group: 'flusso',
    defaults: { wait: 'duration', duration: 1 },
    params: [],
    inverse: () => ({}), // una pausa è uguale a sé stessa all'indietro
  },

  waitTrigger: {
    label: 'Attendi evento',
    group: 'flusso',
    defaults: { wait: 'settle', maxWait: 0 }, // 0 = nessun watchdog: aspetta l'utente
    params: [
      { key: 'name', type: 'string', default: 'next', label: 'Nome evento' },
      { key: 'label', type: 'string', default: 'Continua', label: 'Testo del chip HUD' },
    ],
    isSettled(inst, ctx) {
      return ctx.runtime.consumeTrigger(inst.params.name)
    },
    inverse: () => null,
    inverseNote: 'un rientro non deve restare in attesa di un evento',
  },
}

export const ACTION_KEYS = Object.keys(ACTIONS)

export const ACTION_GROUPS = ['camera', 'materiali', 'trasformazioni', 'varianti', 'flusso']
