import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { easing } from 'maath'

const STEP = Math.PI / 4 // 45°: unità base di ogni movimento
const FULL_TURN = Math.PI * 2
// Mezza larghezza del modello + margine: usata per il fit responsive.
const FIT_HALF_WIDTH = 2.0
// Sotto questa distanza (px) il gesto non ha ancora un asse dominante.
const AXIS_DEADZONE = 6
const EPS = 1e-6

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const nearlyEqualAngle = (a, b) => {
  const d = (((a - b) % FULL_TURN) + FULL_TURN) % FULL_TURN
  return d < 1e-3 || FULL_TURN - d < 1e-3
}
// Posa a 45° adiacente nella direzione del gesto. Funziona anche partendo da
// pose fuori griglia (es. la posa hero d'ingresso a 80°): da 80° in giù → 90°,
// in su → 45°.
const stepFrom = (angle, dir) =>
  dir > 0
    ? (Math.floor(angle / STEP + EPS) + 1) * STEP
    : (Math.ceil(angle / STEP - EPS) - 1) * STEP

/**
 * Controlli del configuratore — rotazione guidata a pose fisse (stile Apple):
 *  - drag OMNIDIREZIONALE con soft cap: durante il gesto il modello segue il
 *    dito su entrambi gli assi (pitch sempre, yaw solo dalla posa orizzontale),
 *    ma ciascun asse è clampato a ±45° dalla posa di partenza del gesto — mai
 *    rotazione libera. Al rilascio: snap alla posa PIÙ VICINA (soglia 50%) e
 *    committa UN SOLO asse, quello con lo spostamento maggiore (l'altro torna
 *    alla partenza); sotto soglia su entrambi → nessun cambio
 *  - il flusso principale (pitch) è il flip front → alto → retro → sotto a
 *    step di 45°; lo slide laterale (yaw) è sbloccato solo nella posa
 *    orizzontale (pitch ≡ 0°), da lì prosegue a step di 45° fino al giro
 *    completo (normalizzato a 360°). Ordine Euler 'XYZ': il pitch resta
 *    sull'asse orizzontale dello schermo a qualunque yaw
 *  - la posa d'ingresso è un hero shot a 80° (fuori griglia, solo estetica):
 *    il primo drag aggancia la griglia dei 45° e il giro completo ritorna
 *    esattamente alla posa hero
 *  - nessuno zoom: né rotella, né pinch. La distanza camera deriva solo dal
 *    fit responsive; focale tele (200mm) per la prospettiva compressa
 *    "commercial"
 *  - mobile portrait: il modello è rollato di 90° (tastiera in verticale),
 *    ma la mappatura del gesto NON cambia — swipe verticale = pitch (flusso
 *    principale), orizzontale = yaw; il roll è solo visivo. Il load è la vista
 *    dall'alto (pitch 90°); tumblando verso l'orizzontale (pitch 0) si vede il
 *    profilo del case (vista sottile, legittima come beauty shot)
 */
export function useComposerControls(
  groupRef,
  {
    focalLength = 200, // mm equivalenti (35mm): tele spinto, effetto commercial
    // Posa d'ingresso hero (fuori griglia, vedi sopra).
    initialRotation = { x: (80 * Math.PI) / 180, y: 0 },
  } = {},
) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Parametri "feel" regolabili dal pannello (?debug): i default sono i
  // valori di produzione.
  const feel = useControls('Rotazione', {
    dragSpeed: { value: 0.006, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
    followTime: { value: 0.12, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
    settleTime: { value: 0.6, min: 0.2, max: 1.5, step: 0.05, label: 'settle rilascio' },
    commitFraction: { value: 0.5, min: 0.1, max: 0.9, step: 0.05, label: 'soglia step' },
    fitMargin: { value: 1.4, min: 1, max: 2.5, step: 0.05, label: 'margine inquadratura' },
    zoomOutMobile: { value: 1.05, min: 1, max: 1.8, step: 0.05, label: 'zoom-out mobile' },
  })
  const feelRef = useRef(feel)
  feelRef.current = feel

  const pose = useRef({
    pitch: initialRotation.x, // ultima posa committata
    yaw: initialRotation.y,
    targetX: initialRotation.x, // target visuale inseguito dal damping
    targetY: initialRotation.y,
    initialized: false,
  })
  const drag = useRef({
    pointerId: null,
    moved: false, // true una volta superata la deadzone iniziale
    startX: 0,
    startY: 0,
    pitch0: 0, // posa committata all'inizio del gesto (ancora di soft-cap)
    yaw0: 0,
  })
  const layout = useRef({ portrait: false })

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

  // Fit responsive a distanza fissa (nessuno zoom utente). In portrait il
  // modello è rollato in verticale, quindi l'ingombro lungo è sull'asse
  // verticale del frame: si fitta sull'altezza, con zoom-out extra.
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
    camera.position.setLength(clamp(fit, 5.2, 200))
    camera.lookAt(0, 0.1, 0) // mira al pivot del modello: composizione centrata
  }, [size, camera, focalLength, feel.fitMargin, feel.zoomOutMobile])

  useEffect(() => {
    const el = gl.domElement
    const p = pose.current
    const d = drag.current
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'

    // Vista frontale = scocca frontale rivolta alla camera (pitch ≡ 0 mod 360):
    // unica posizione da cui è concesso slittare lateralmente.
    const atFrontView = () => nearlyEqualAngle(p.pitch, 0)

    const onDown = (e) => {
      if (d.pointerId != null) return // gesto già in corso: dita extra ignorate
      d.pointerId = e.pointerId
      d.moved = false
      d.startX = e.clientX
      d.startY = e.clientY
      d.pitch0 = p.pitch
      d.yaw0 = p.yaw
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
      // Vale anche in portrait: il roll del modello è solo visivo, la
      // semantica del gesto resta la stessa (verificato a schermo).
      const pitchDelta = dy
      const yawDelta = dx

      if (!d.moved) {
        if (Math.hypot(dx, dy) < AXIS_DEADZONE) return
        d.moved = true
      }

      // Drag omnidirezionale: entrambi gli assi seguono il dito nello stesso
      // gesto, ciascuno soft-cappato a ±45° dalla posa di partenza (mai
      // rotazione libera). Il pitch è sempre attivo; lo yaw solo dalla posa
      // orizzontale (da lì il ring laterale prosegue a step di 45°).
      const speed = feelRef.current.dragSpeed
      p.targetX = clamp(
        d.pitch0 + pitchDelta * speed,
        stepFrom(d.pitch0, -1),
        stepFrom(d.pitch0, 1),
      )
      if (atFrontView()) {
        p.targetY = clamp(
          d.yaw0 + yawDelta * speed,
          stepFrom(d.yaw0, -1),
          stepFrom(d.yaw0, 1),
        )
      }
    }

    // Rinormalizza i giri interi su un asse: sottrarre un multiplo di 360°
    // sia dal target che dalla rotazione corrente è visivamente invisibile e
    // tiene i contatori vicini alla posa d'ingresso (nessun accumulo).
    const normalizeTurns = (axis, poseKey, targetKey, anchor) => {
      const turns = Math.trunc((p[poseKey] - anchor) / FULL_TURN)
      if (turns === 0) return
      const offset = turns * FULL_TURN
      p[poseKey] -= offset
      p[targetKey] -= offset
      const group = groupRef.current
      if (group) group.rotation[axis] -= offset
    }

    const onUp = (e) => {
      if (e.pointerId !== d.pointerId) return
      d.pointerId = null
      el.style.cursor = 'grab'
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!d.moved) return
      d.moved = false

      // Progresso normalizzato per asse (∈ [-1, 1] grazie al soft-cap).
      const pitchProgress = (p.targetX - d.pitch0) / STEP
      const yawProgress = (p.targetY - d.yaw0) / STEP
      const threshold = feelRef.current.commitFraction // frazione di STEP (0.5 = nearest)

      // Un solo asse committa: quello con lo spostamento maggiore. L'altro
      // torna alla posa di partenza. Il candidato scatta solo oltre la soglia
      // (nearest), altrimenti torna anch'esso (nessun cambio).
      const pitchDominant = Math.abs(pitchProgress) >= Math.abs(yawProgress)
      p.pitch = d.pitch0
      p.yaw = d.yaw0
      if (pitchDominant) {
        if (Math.abs(pitchProgress) >= threshold) {
          p.pitch = stepFrom(d.pitch0, Math.sign(pitchProgress))
        }
      } else if (Math.abs(yawProgress) >= threshold) {
        p.yaw = stepFrom(d.yaw0, Math.sign(yawProgress))
      }
      p.targetX = p.pitch
      p.targetY = p.yaw

      normalizeTurns('x', 'pitch', 'targetX', initialRotation.x)
      normalizeTurns('y', 'yaw', 'targetY', initialRotation.y)
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
  }, [gl, groupRef, initialRotation.x])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const p = pose.current
    if (!p.initialized) {
      // Ordine Euler di default 'XYZ': R = Rx·Ry, quindi lo yaw ruota il
      // modello attorno al proprio asse verticale e il pitch tumbla il tutto
      // attorno all'asse orizzontale dello schermo — a qualunque yaw il
      // flusso verticale resta naturale (mai rollio).
      // Posa iniziale applicata secca al primo frame, senza animazione:
      // deve combaciare con il poster sfocato mostrato durante il load.
      group.rotation.x = p.targetX
      group.rotation.y = p.targetY
      p.initialized = true
    }
    // Follow lento e "pastoso" anche durante il drag (riferimento Apple);
    // al rilascio il settle è ancora più morbido.
    const f = feelRef.current
    const t = drag.current.pointerId != null ? f.followTime : f.settleTime
    easing.damp(group.rotation, 'x', p.targetX, t, delta)
    easing.damp(group.rotation, 'y', p.targetY, t, delta)
  })
}
