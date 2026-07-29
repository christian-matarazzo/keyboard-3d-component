import * as THREE from 'three'
import { resolveSelector } from './selectors'
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
 * }
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
 * Asse di rotazione di UN handle, espresso nel frame in cui il quaternion del
 * canale viene effettivamente applicato (cioè il locale del pivot).
 *
 * ⚠️ Il punto delicato di tutte le azioni rotatorie. Un pivot di MESH SINGOLA
 * eredita l'orientamento proprio della mesh (vedi wrapMeshInPivot), che nei GLB
 * esportati da Maya è spesso inclinato rispetto al modello: "ruota attorno a Y"
 * nel frame locale può quindi voler dire un asse tutt'altro che verticale, e i
 * pezzi si vedono inclinarsi e compenetrare ciò che hanno attorno mentre
 * girano. Con `axisSpace: 'model'` l'asse viene invece preso nel frame della
 * scena GLTF e riportato dentro quello del pivot:
 *
 *   a_pivot = (Qparent · baseQuat)⁻¹ · Qscene · a
 *
 * — la coniugazione che rende `baseQuat · quat(a_pivot, θ)` equivalente a una
 * rotazione di θ attorno all'asse del modello. Calcolato una volta allo start:
 * l'orientamento a riposo del pivot non cambia in corsa.
 */
const axisInPivotFrame = (handle, axisName, space, ctx) => {
  const axis = (AXIS_VEC[axisName] ?? AXIS_VEC.y).clone()
  if (space === 'local') return axis
  const scene = ctx.getScene()
  if (!scene) return axis
  const rel = handle.restWorldQuat
    .clone()
    .invert()
    .multiply(scene.getWorldQuaternion(new THREE.Quaternion()))
  return axis.applyQuaternion(rel).normalize()
}

/**
 * Acquisizione dei pivot per le azioni ROTATORIE (spin, rotazione finita,
 * wobble), tutte con la stessa forma: risolvi il selettore, prendi un pivot per
 * mesh o uno solo per il gruppo, e registra nel canale rotatorio dell'handle un
 * quaternion PROPRIO dello step (chiave = step.id). È quella chiave che
 * permette a più azioni rotatorie di sommarsi sullo stesso bersaglio invece di
 * sovrascriversi — vedi pivotRegistry.js.
 */
const acquireRotHandles = (inst, ctx, { perMesh = inst.params.perMesh } = {}) => {
  const meshes = resolveSelector(ctx.getScene(), ctx.groups, inst.params.selector)
  const stepId = inst.step.id
  const space = inst.params.axisSpace ?? 'model'
  const attach = (h, i) => {
    if (!h) return null
    const q = new THREE.Quaternion()
    h.setRot(stepId, q)
    return {
      h,
      q,
      axis: axisInPivotFrame(h, inst.params.axis, space, ctx),
      sign: inst.params.alternate && i % 2 ? -1 : 1,
    }
  }
  inst.data.handles = perMesh
    ? meshes.map((m, i) => attach(ctx.pivots.acquireMesh(m), i)).filter(Boolean)
    : [attach(ctx.pivots.acquireGroup(meshes), 0)].filter(Boolean)
  inst.data.angle = 0
}

/** Schema del parametro condiviso dalle tre azioni rotatorie. */
const AXIS_SPACE_PARAM = {
  key: 'axisSpace',
  type: 'select',
  options: ['model', 'local'],
  default: 'model',
  label: 'Asse nel frame',
}

const releaseRotHandles = (inst) => {
  const stepId = inst.step.id
  for (const { h } of inst.data.handles ?? []) {
    h.clearRot(stepId)
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
    stop(inst) {
      inst.data.restore?.finish()
    },
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
    stop(inst) {
      inst.data.handle?.release()
      inst.data.handle = null
    },
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
      AXIS_SPACE_PARAM,
      { key: 'speedDeg', type: 'number', default: 90, min: -720, max: 720, step: 1, label: '°/s' },
      { key: 'alternate', type: 'boolean', default: true, label: 'Segno alternato' },
      { key: 'rampIn', type: 'number', default: 0.3, min: 0, max: 5, step: 0.05, label: 'Rampa (s)', advanced: true },
    ],
    start(inst, ctx) {
      // Sempre UN pivot PER MESH, non il pivot di gruppo: "ruota attorno al
      // proprio centro" è il ramo mesh-singola applicato N volte. Il pivot di
      // gruppo farebbe girare i rotori attorno al loro baricentro comune, che è
      // tutt'altra animazione (e per quella c'è rotateBy con perMesh spento).
      acquireRotHandles(inst, ctx, { perMesh: true })
    },
    update(inst, ctx, dt) {
      const ramp = inst.params.rampIn > 0 ? clamp01(inst.elapsed / inst.params.rampIn) : 1
      inst.data.angle += THREE.MathUtils.degToRad(inst.params.speedDeg) * ramp * dt
      for (const { h, sign, q, axis } of inst.data.handles ?? []) {
        q.setFromAxisAngle(axis, inst.data.angle * sign)
        h.compose()
      }
    },
    // Nessun restart: su un giro di loop la rotazione continua da dov'era
    // invece di scattare a zero.
    restart() {},
    stop(inst) {
      releaseRotHandles(inst)
    },
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
      AXIS_SPACE_PARAM,
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
      acquireRotHandles(inst, ctx)
    },
    update(inst) {
      // A regime si smette: l'istanza è persistente (tiene i pivot), quindi il
      // runtime continuerebbe a ticchettarla e a ricomporre N pivot ogni frame
      // per riscrivere lo stesso quaternion.
      if (inst.data.settled) return
      const k = progress(inst)
      const angle = THREE.MathUtils.degToRad(inst.params.angleDeg) * k
      for (const { h, sign, q, axis } of inst.data.handles ?? []) {
        q.setFromAxisAngle(axis, angle * sign)
        h.compose()
      }
      if (k >= 1) inst.data.settled = true
    },
    restart(inst) {
      inst.data.settled = false
    },
    stop(inst) {
      releaseRotHandles(inst)
    },
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
      AXIS_SPACE_PARAM,
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
      acquireRotHandles(inst, ctx)
    },
    update(inst) {
      const amp = THREE.MathUtils.degToRad(inst.params.amplitudeDeg)
      const decay = inst.params.decay > 0 ? Math.exp(-inst.elapsed / inst.params.decay) : 1
      const w = 2 * Math.PI * inst.params.frequency * inst.elapsed
      const phase = THREE.MathUtils.degToRad(inst.params.phasePerMesh ?? 0)
      const handles = inst.data.handles ?? []
      for (let i = 0; i < handles.length; i++) {
        const { h, q, axis } = handles[i]
        q.setFromAxisAngle(axis, amp * decay * Math.sin(w + i * phase))
        h.compose()
      }
    },
    // Nessun restart necessario: il runtime azzera già `elapsed` quando
    // riavvia un'istanza persistente su un giro di loop, ed è esattamente ciò
    // che serve qui — l'inviluppo di smorzamento riparte da capo invece di
    // trovarsi già spento.
    stop(inst) {
      releaseRotHandles(inst)
    },
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
      const meshes = resolveSelector(ctx.getScene(), ctx.groups, inst.params.selector)
      if (meshes.length === 0) return
      inst.data.handles = inst.params.perMesh
        ? meshes.map((m) => ctx.pivots.acquireMesh(m)).filter(Boolean)
        : [ctx.pivots.acquireGroup(meshes)].filter(Boolean)
      // Si interpola DA dove il canale è ora (potrebbe già portare l'offset di
      // uno step precedente sullo stesso bersaglio), non da zero.
      inst.data.from = inst.data.handles.map((h) => ({
        pos: h.channels.offsetPos.clone(),
        quat: h.channels.offsetQuat.clone(),
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
        const h = handles[i]
        const from = inst.data.from[i]
        h.channels.offsetPos.lerpVectors(from.pos, inst.data.targetPos, k)
        h.channels.offsetQuat.slerpQuaternions(from.quat, inst.data.targetQuat, k)
        h.compose()
      }
      if (k >= 1) inst.data.settled = true
    },
    restart(inst) {
      inst.data.from = (inst.data.handles ?? []).map((h) => ({
        pos: h.channels.offsetPos.clone(),
        quat: h.channels.offsetQuat.clone(),
      }))
      inst.data.settled = false
    },
    stop(inst) {
      for (const h of inst.data.handles ?? []) {
        h.channels.offsetPos.set(0, 0, 0)
        h.channels.offsetQuat.identity()
        h.compose()
        h.release()
      }
      inst.data.handles = null
    },
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

      // Traslazione opzionale. I pivot si prendono solo se serve davvero.
      const vIn = new THREE.Vector3(...(inst.params.offsetIn ?? [0, 0, 0]))
      const vOut = new THREE.Vector3(...(inst.params.offsetOut ?? [0, 0, 0]))
      if (vIn.lengthSq() > 0) {
        inst.data.inPivot = ctx.pivots.acquireGroup(incoming)
        inst.data.vIn = vIn
        if (inst.data.inPivot) {
          inst.data.inPivot.channels.offsetPos.copy(vIn)
          inst.data.inPivot.compose()
        }
      }
      if (vOut.lengthSq() > 0 && outgoing.length) {
        inst.data.outPivot = ctx.pivots.acquireGroup(outgoing)
        inst.data.vOut = vOut
      }
    },
    update(inst, ctx) {
      if (inst.data.skip || inst.data.settled) return
      const k = progress(inst)
      inst.data.inHandle?.set(k)
      inst.data.outHandle?.lerpTo(inst.data.outFrom, 0, k)
      // L'entrante va da `offsetIn` a zero, l'uscente da zero a `offsetOut`.
      if (inst.data.inPivot) {
        inst.data.inPivot.channels.offsetPos.copy(inst.data.vIn).multiplyScalar(1 - k)
        inst.data.inPivot.compose()
      }
      if (inst.data.outPivot) {
        inst.data.outPivot.channels.offsetPos.copy(inst.data.vOut).multiplyScalar(k)
        inst.data.outPivot.compose()
      }
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
      // I pivot vanno azzerati PRIMA del rilascio: l'unwind ripristina la
      // trasformata locale fotografata al wrap, ma il canale è roba nostra e
      // un handle condiviso con un'altra azione se lo ritroverebbe sporco.
      for (const p of [inst.data.inPivot, inst.data.outPivot]) {
        if (!p) continue
        p.channels.offsetPos.set(0, 0, 0)
        p.compose()
        p.release()
      }
      inst.data.inPivot = null
      inst.data.outPivot = null
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
  },

  // ── Flusso ────────────────────────────────────────────────────────────────

  waitTime: {
    label: 'Attesa',
    group: 'flusso',
    defaults: { wait: 'duration', duration: 1 },
    params: [],
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
  },
}

export const ACTION_KEYS = Object.keys(ACTIONS)

export const ACTION_GROUPS = ['camera', 'materiali', 'trasformazioni', 'varianti', 'flusso']
