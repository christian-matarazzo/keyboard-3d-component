import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { easing } from 'maath'
import {
  DEG,
  YAW_STOPS,
  pitchStopsAt,
  adjacentStop,
  ENTRY_LANDSCAPE,
} from './poseGraph'

// Mezza larghezza del modello + margine: usata per il fit responsive.
const FIT_HALF_WIDTH = 2.0
// Altezza del pivot del modello: la camera è livellata su questa quota
// (le viste frontali/laterali del cliente hanno elevazione zero).
const PIVOT_Y = 0.1
// Sotto questa distanza (px) il gesto non ha ancora un asse dominante.
const AXIS_DEADZONE = 6
const EPS = 1e-6

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const atZeroAngle = (a) => Math.abs(a) < 1e-3

// Oltre lo stop adiacente (o l'estremo d'arco) il target non si ferma secco:
// l'eccesso prosegue compresso — la "resistenza elastica" che si sente
// tirando più forte del necessario, e che al rilascio alimenta il bounce.
const softClamp = (raw, lo, hi, factor, cap) => {
  if (raw > hi) return hi + Math.min((raw - hi) * factor, cap)
  if (raw < lo) return lo - Math.min((lo - raw) * factor, cap)
  return raw
}

/**
 * Controlli del configuratore — rotazione a pose fisse, 1:1 con i riferimenti
 * del cliente in `rig set/` (stop ViewCube di Maya, vedi poseGraph.js):
 *  - drag omnidirezionale con soft cap: durante il gesto il modello segue il
 *    dito su entrambi gli assi (pitch dove il grafo ha stop, yaw solo dalla
 *    posa orizzontale), ciascun asse limitato allo stop adiacente più una
 *    coda elastica compressa — mai rotazione libera
 *  - gli archi sono CLAMPATI: niente giro completo. Oltre l'ultima posa
 *    (bottom, 3-4 back a 135°, back a yaw ±180°) c'è solo l'elastico;
 *    ogni step è una rotazione semplice di 45° sul proprio asse
 *  - al rilascio ogni asse committa se ha superato la soglia (frazione della
 *    distanza start→stop adiacente); se entrambi superano, vince l'asse con
 *    più progresso: le pose combinate fuori dal set del cliente non esistono
 *  - BOUNCE: il settle è una molla smorzata (sotto-smorzata) seminata con la
 *    velocità reale del modello al rilascio. Un gesto più forte del
 *    necessario arriva sulla posa con overshoot visibile e ritorno elastico
 *    proporzionale all'energia; un gesto delicato atterra morbido. Lo stesso
 *    meccanismo fa rimbalzare il modello sugli estremi d'arco
 *  - dal corner d'ingresso ("initial position": pitch 35.264°, yaw 45°) il
 *    drag verticale scende a "3-4 left"; il gemello "3-4 front right" si
 *    raggiunge da "3-4 right" con lo stesso mini-step verticale
 *  - nessuno zoom: né rotella, né pinch. La distanza camera deriva solo dal
 *    fit responsive; focale tele (200mm) per la prospettiva compressa
 *    "commercial"
 *  - mobile portrait: ingresso nella posa top verticale (pitch 90° + yaw 90°,
 *    manopole in alto); l'arco verticale vive anche su quell'asse, per il
 *    resto il grafo è identico al desktop
 */
export function useComposerControls(
  groupRef,
  {
    focalLength = 200, // mm equivalenti (35mm): tele spinto, effetto commercial
    initialRotation = { x: ENTRY_LANDSCAPE.x, y: ENTRY_LANDSCAPE.y },
  } = {},
) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Parametri "feel" regolabili dal pannello (?debug): i default sono i
  // valori di produzione.
  const feel = useControls('Rotazione', {
    dragSpeed: { value: 0.008, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
    followTime: { value: 0.09, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
    commitFraction: { value: 0.5, min: 0.1, max: 0.9, step: 0.05, label: 'soglia step' },
    springStiffness: { value: 90, min: 20, max: 300, step: 5, label: 'molla rigidità' },
    springDamping: { value: 0.6, min: 0.2, max: 1.2, step: 0.05, label: 'molla smorzamento' },
    rubberFactor: { value: 0.25, min: 0, max: 0.6, step: 0.05, label: 'elastico oltre-step' },
    rubberCapDeg: { value: 10, min: 0, max: 20, step: 1, label: 'elastico max (°)' },
    fitMargin: { value: 1.4, min: 1, max: 2.5, step: 0.05, label: 'margine inquadratura' },
    zoomOutMobile: { value: 1.25, min: 1, max: 1.8, step: 0.05, label: 'zoom-out mobile' },
  })
  const feelRef = useRef(feel)
  feelRef.current = feel

  const pose = useRef({
    pitch: initialRotation.x, // ultima posa committata (φ)
    yaw: initialRotation.y,
    targetX: initialRotation.x, // target visuale inseguito da damp/molla
    targetY: initialRotation.y,
    initialized: false,
  })
  const drag = useRef({
    pointerId: null,
    moved: false, // true una volta superata la deadzone iniziale
    startX: 0,
    startY: 0,
    pitch0: 0, // posa committata all'inizio del gesto (ancora del soft-cap)
    yaw0: 0,
    phiSoft: 0, // parametri correnti del gesto (pre-mappatura)
    yawSoft: 0,
  })
  // Velocità angolare corrente del modello (rad/s), misurata in drag e
  // integrata dalla molla al rilascio: la continuità dito→bounce è gratis.
  const spring = useRef({ vx: 0, vy: 0 })
  const layout = useRef({ portrait: false })

  // Debug-only: salto secco a una posa (audit multi-posa via ?debug).
  // window.__setPose(pitchDeg, yawDeg) — non tocca il flusso di produzione.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return
    window.__setPose = (pitchDeg, yawDeg) => {
      const p = pose.current
      p.pitch = p.targetX = (pitchDeg * Math.PI) / 180
      p.yaw = p.targetY = (yawDeg * Math.PI) / 180
      spring.current.vx = spring.current.vy = 0
      const g = groupRef.current
      if (g) {
        g.rotation.x = p.targetX
        g.rotation.y = p.targetY
      }
      return { pitch: pitchDeg, yaw: yawDeg }
    }
    return () => {
      delete window.__setPose
    }
  }, [groupRef])

  // Il primo render del <Canvas> spesso avviene prima che il container abbia
  // comunicato le sue dimensioni reali (size di default landscape), quindi
  // `initialRotation` calcolato dal chiamante in base al portrait può arrivare
  // "sbagliato" alla ref creata da useRef (che ignora gli aggiornamenti
  // successivi). Finché la posa non è stata applicata al primo frame reale
  // (`pose.initialized`), la si risincronizza a ogni render sul valore più
  // recente di initialRotation.
  if (!pose.current.initialized) {
    pose.current.pitch = initialRotation.x
    pose.current.yaw = initialRotation.y
    pose.current.targetX = initialRotation.x
    pose.current.targetY = initialRotation.y
  }

  // Fit responsive a distanza fissa (nessuno zoom utente), camera LIVELLATA
  // sulla quota del pivot: le viste front/left/right del cliente sono a
  // elevazione zero, ogni inclinazione viene dal pitch del modello. In
  // portrait il modello è in verticale, quindi si fitta sull'altezza.
  useEffect(() => {
    camera.setFocalLength(focalLength) // imposta il fov dalla focale (film 35mm)
    const aspect = size.width / Math.max(size.height, 1)
    const portrait = aspect < 1
    layout.current.portrait = portrait
    const tanHalfV = Math.tan((camera.fov * Math.PI) / 360)
    let fit = portrait
      ? FIT_HALF_WIDTH / tanHalfV
      : FIT_HALF_WIDTH / (tanHalfV * aspect)
    fit *= feel.fitMargin
    if (portrait) fit *= feel.zoomOutMobile
    camera.position.set(0, PIVOT_Y, clamp(fit, 5.2, 200))
    camera.lookAt(0, PIVOT_Y, 0) // mira al pivot: composizione centrata
  }, [size, camera, focalLength, feel.fitMargin, feel.zoomOutMobile])

  useEffect(() => {
    const el = gl.domElement
    const p = pose.current
    const d = drag.current
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'

    // Vista orizzontale = pitch 0: unica posizione da cui è concesso
    // slittare lateralmente (regola invariata dal set precedente).
    const atFrontView = () => atZeroAngle(p.pitch)

    const onDown = (e) => {
      if (d.pointerId != null) return // gesto già in corso: dita extra ignorate
      d.pointerId = e.pointerId
      d.moved = false
      d.startX = e.clientX
      d.startY = e.clientY
      d.pitch0 = p.pitch
      d.yaw0 = p.yaw
      d.phiSoft = p.pitch
      d.yawSoft = p.yaw
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // pointer sintetici (test) non catturabili: i gesti funzionano comunque
      }
      el.style.cursor = 'grabbing'
    }

    const onMove = (e) => {
      if (e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      // Swipe verticale → pitch (flusso principale), orizzontale → yaw.
      const pitchDelta = dy
      const yawDelta = dx

      if (!d.moved) {
        if (Math.hypot(dx, dy) < AXIS_DEADZONE) return
        d.moved = true
      }

      const f = feelRef.current
      const speed = f.dragSpeed
      const rubberCap = f.rubberCapDeg * DEG

      // Limiti del gesto = stop adiacenti nel grafo; agli estremi d'arco
      // (stop assente) l'ancora è la posa di partenza e resta solo l'elastico.
      const pitchStops = pitchStopsAt(d.yaw0, layout.current.portrait)
      const loP = adjacentStop(pitchStops, d.pitch0, -1) ?? d.pitch0
      const hiP = adjacentStop(pitchStops, d.pitch0, 1) ?? d.pitch0
      const phiSoft = softClamp(
        d.pitch0 + pitchDelta * speed,
        loP,
        hiP,
        f.rubberFactor,
        rubberCap,
      )
      let yawSoft = d.yaw0
      if (atFrontView()) {
        const loY = adjacentStop(YAW_STOPS, d.yaw0, -1) ?? d.yaw0
        const hiY = adjacentStop(YAW_STOPS, d.yaw0, 1) ?? d.yaw0
        yawSoft = softClamp(
          d.yaw0 + yawDelta * speed,
          loY,
          hiY,
          f.rubberFactor,
          rubberCap,
        )
      }
      // Parametri = rotazione del modello: ogni step è una rotazione
      // semplice di 45° sul proprio asse (round 7: nessuno spin composto).
      d.phiSoft = phiSoft
      d.yawSoft = yawSoft
      p.targetX = phiSoft
      p.targetY = yawSoft
    }

    const onUp = (e) => {
      if (e.pointerId !== d.pointerId) return
      d.pointerId = null
      el.style.cursor = 'grab'
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!d.moved) return
      d.moved = false

      const threshold = feelRef.current.commitFraction // 0.5 = nearest

      // Progresso di un asse verso lo stop adiacente nella direzione del
      // gesto. Oltre 1 (coda elastica) committa comunque; senza stop
      // (estremo d'arco) il progresso è nullo e si torna alla partenza.
      const axisPlan = (start, target, stops) => {
        const delta = target - start
        if (Math.abs(delta) < EPS) return { stop: null, progress: 0 }
        const stop = adjacentStop(stops, start, Math.sign(delta))
        if (stop == null) return { stop: null, progress: 0 }
        return { stop, progress: Math.abs(delta / (stop - start)) }
      }

      const pitchPlan = axisPlan(
        d.pitch0,
        d.phiSoft,
        pitchStopsAt(d.yaw0, layout.current.portrait),
      )
      const yawPlan = axisPlan(d.yaw0, d.yawSoft, YAW_STOPS)

      let commitPitch = pitchPlan.stop != null && pitchPlan.progress >= threshold
      let commitYaw = yawPlan.stop != null && yawPlan.progress >= threshold
      // Mai entrambi: le pose diagonali non sono nel set del cliente.
      // Vince l'asse con più progresso.
      if (commitPitch && commitYaw) {
        if (pitchPlan.progress >= yawPlan.progress) commitYaw = false
        else commitPitch = false
      }

      p.pitch = commitPitch ? pitchPlan.stop : d.pitch0
      p.yaw = commitYaw ? yawPlan.stop : d.yaw0
      p.targetX = p.pitch
      p.targetY = p.yaw
      // Da qui in poi lavora la molla in useFrame: parte dalla posizione e
      // velocità correnti del modello → overshoot e bounce se il gesto era
      // più forte del necessario.
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [gl, groupRef, initialRotation.x, initialRotation.y])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const p = pose.current
    const s = spring.current
    if (!p.initialized) {
      // Ordine Euler di default 'XYZ': R = Rx·Ry, quindi lo yaw ruota il
      // modello attorno al proprio asse verticale e il pitch tumbla il tutto
      // attorno all'asse orizzontale dello schermo — a qualunque yaw il
      // flusso verticale resta naturale (mai rollio).
      // Posa iniziale applicata secca al primo frame, senza animazione:
      // deve combaciare con il poster sfocato mostrato durante il load.
      group.rotation.x = p.targetX
      group.rotation.y = p.targetY
      s.vx = 0
      s.vy = 0
      p.initialized = true
    }
    const f = feelRef.current
    // dt clampato: stabilità della molla anche dopo un frame lungo (tab
    // in background, hiccup) e con rigidità alta dal pannello.
    const dt = Math.min(delta, 1 / 30)
    if (dt <= 0) return

    if (drag.current.pointerId != null) {
      // In drag: follow damp "pastoso" (riferimento Apple). La velocità
      // risultante viene misurata per seminare la molla al rilascio.
      const px = group.rotation.x
      const py = group.rotation.y
      easing.damp(group.rotation, 'x', p.targetX, f.followTime, delta)
      easing.damp(group.rotation, 'y', p.targetY, f.followTime, delta)
      s.vx = (group.rotation.x - px) / dt
      s.vy = (group.rotation.y - py) / dt
      return
    }

    // Rilascio: molla smorzata per asse (semi-implicita, quindi stabile).
    // springDamping < 1 = sotto-smorzata: l'energia in eccesso del gesto
    // diventa overshoot oltre la posa e ritorno elastico — il bounce.
    const k = f.springStiffness
    const c = 2 * f.springDamping * Math.sqrt(k)
    const integrate = (axis, vKey, target) => {
      const x = group.rotation[axis]
      if (Math.abs(x - target) < 1e-4 && Math.abs(s[vKey]) < 1e-3) {
        group.rotation[axis] = target
        s[vKey] = 0
        return
      }
      s[vKey] += (k * (target - x) - c * s[vKey]) * dt
      group.rotation[axis] = x + s[vKey] * dt
    }
    integrate('x', 'vx', p.targetX)
    integrate('y', 'vy', p.targetY)
  })
}
