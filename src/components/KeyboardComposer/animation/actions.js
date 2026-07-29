import * as THREE from 'three'
import { resolveSelector } from './selectors'
import { ease, clamp01 } from './easings'

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

  clearFocus: {
    label: 'Torna all’insieme',
    group: 'camera',
    defaults: { wait: 'settle' },
    params: [],
    start(inst, ctx) {
      ctx.getApi()?.clearFocus?.()
    },
    isSettled(inst, ctx) {
      return ctx.getApi()?.isFocusSettled?.() ?? true
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
      inst.data.handle?.lerpTo(inst.data.from, inst.params.opacity, progress(inst))
    },
    restart(inst) {
      // Su un giro di loop si riparte dal valore attuale, non da quello di tre
      // giri fa.
      inst.data.from = inst.data.handle?.readCurrent()
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
      { key: 'speedDeg', type: 'number', default: 90, min: -720, max: 720, step: 1, label: '°/s' },
      { key: 'alternate', type: 'boolean', default: true, label: 'Segno alternato' },
      { key: 'rampIn', type: 'number', default: 0.3, min: 0, max: 5, step: 0.05, label: 'Rampa (s)', advanced: true },
    ],
    start(inst, ctx) {
      const meshes = resolveSelector(ctx.getScene(), ctx.groups, inst.params.selector)
      // UN pivot PER MESH, non il pivot di gruppo: "ruota attorno al proprio
      // centro" è il ramo mesh-singola applicato N volte. Il pivot di gruppo
      // farebbe girare i rotori attorno al loro baricentro comune, che è
      // tutt'altra animazione.
      inst.data.handles = meshes
        .map((mesh, i) => {
          const h = ctx.pivots.acquireMesh(mesh)
          return h ? { h, sign: inst.params.alternate && i % 2 ? -1 : 1 } : null
        })
        .filter(Boolean)
      inst.data.angle = 0
    },
    update(inst, ctx, dt) {
      const ramp = inst.params.rampIn > 0 ? clamp01(inst.elapsed / inst.params.rampIn) : 1
      inst.data.angle += THREE.MathUtils.degToRad(inst.params.speedDeg) * ramp * dt
      const axis = AXIS_VEC[inst.params.axis] ?? AXIS_VEC.y
      for (const { h, sign } of inst.data.handles ?? []) {
        h.channels.spin.setFromAxisAngle(axis, inst.data.angle * sign)
        h.compose()
      }
    },
    // Nessun restart: su un giro di loop la rotazione continua da dov'era
    // invece di scattare a zero.
    restart() {},
    stop(inst) {
      for (const { h } of inst.data.handles ?? []) {
        h.channels.spin.identity()
        h.compose()
        h.release()
      }
      inst.data.handles = null
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
      // perMesh = "esplodi": ogni mesh si muove attorno al proprio centro
      // invece che rigidamente col gruppo.
      { key: 'perMesh', type: 'boolean', default: false, label: 'Pivot per mesh (esplodi)' },
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
      const k = progress(inst)
      const handles = inst.data.handles ?? []
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i]
        const from = inst.data.from[i]
        h.channels.offsetPos.lerpVectors(from.pos, inst.data.targetPos, k)
        h.channels.offsetQuat.slerpQuaternions(from.quat, inst.data.targetQuat, k)
        h.compose()
      }
    },
    restart(inst) {
      inst.data.from = (inst.data.handles ?? []).map((h) => ({
        pos: h.channels.offsetPos.clone(),
        quat: h.channels.offsetQuat.clone(),
      }))
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

export const ACTION_GROUPS = ['camera', 'materiali', 'trasformazioni', 'flusso']
