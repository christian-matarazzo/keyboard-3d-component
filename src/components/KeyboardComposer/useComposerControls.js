import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { easing } from 'maath'
import {
  DEG,
  pitchStopsAt,
  adjacentStop,
  nextYawStop,
  cornerArcStep,
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

// Stima della "velocità di interazione" da tastiera, dalla cadenza dei
// commit sullo stesso asse (il drag ha già una velocità reale misurata dal
// gesto). Oltre KEY_BOUNCE_MAX_DT tra due step si considera una pressione
// isolata: nessuna velocità extra, il bounce resta quello "di base" della
// molla. Sotto quella soglia la velocità implicita (step/intervallo) semina
// la molla come farebbe un rilascio di drag veloce — più le pressioni sono
// ravvicinate (tenendo il tasto, o premendolo a raffica), più bounce
// all'arrivo. KEY_BOUNCE_MAX_SPEED è un tetto di sicurezza contro overshoot
// eccessivi con ripetizioni fortissime.
const KEY_BOUNCE_MIN_DT = 0.02
const KEY_BOUNCE_MAX_DT = 0.6
const KEY_BOUNCE_MAX_SPEED = 8 // rad/s

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
 *  - l'arco di pitch è CLAMPATO: oltre l'ultima posa (bottom / 3-4 back a
 *    135°) c'è solo l'elastico. L'arco di yaw invece, oltre il "back"
 *    (±180°, raggiunto da 3-4-left back o 3-4 right-back), NON si ferma:
 *    prosegue a step di 45° in loop, permettendo un giro completo e oltre
 *    nella stessa direzione (vedi `nextYawStop` in poseGraph.js)
 *  - ogni step è una rotazione semplice di 45° sul proprio asse
 *  - frecce direzionali (↑↓←→): stesso step a 45° del drag, attive solo con
 *    hover o focus sul canvas
 *  - al rilascio ogni asse committa se ha superato la soglia (frazione della
 *    distanza start→stop adiacente); se entrambi superano, vince l'asse con
 *    più progresso: le pose combinate fuori dal set del cliente non esistono
 *  - BOUNCE: il settle è una molla smorzata (sotto-smorzata) seminata con la
 *    velocità reale del modello al rilascio. Un gesto più forte del
 *    necessario arriva sulla posa con overshoot visibile e ritorno elastico
 *    proporzionale all'energia; un gesto delicato atterra morbido. Lo stesso
 *    meccanismo fa rimbalzare il modello sugli estremi d'arco
 *  - alle pose corner (yaw ±45° fronte, ±135° retro) il verticale (drag o
 *    freccia) naviga una delle quattro sequenze continue a 4 tappe —
 *    CORNER_ARCS in poseGraph.js: un anello orizzontale (pitch 0) → corner
 *    ALTO o BASSO (±CORNER_PITCH, 35.264°) → corner gemello sull'altro lato
 *    (stesso segno di elevazione, yaw opposto) → l'altro anello. Giù
 *    avanza, su retrocede, sempre; il giro fra i due corner gemelli cambia
 *    yaw invece di pitch (unico punto del grafo dove un singolo step
 *    cambia asse), ma resta un solo asse per volta — mai una posa
 *    diagonale. Ogni anello ha un corner alto e uno basso, su direzioni
 *    verticali opposte (mai in conflitto: vedi CORNER_ARCS)
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
    // Drag più lento (era 0.008) e più attrito in assestamento: gesto più
    // pesante. Damping 0.8→0.55 e stiffness 40→50: il bounce (quasi
    // impercettibile a 0.8, ζ≈0.8 → ~1.5% di overshoot) torna visibile
    // (ζ≈0.55 → ~13% di overshoot) restando comunque più lento/pesante di
    // prima (il tempo di assestamento a riposo, senza extra-velocità, è
    // ~1.3s contro ~1s del preset precedente).
    dragSpeed: { value: 0.005, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
    followTime: { value: 0.2, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
    commitFraction: { value: 0.5, min: 0.1, max: 0.9, step: 0.05, label: 'soglia step' },
    springStiffness: { value: 50, min: 20, max: 300, step: 5, label: 'molla rigidità' },
    springDamping: { value: 0.55, min: 0.2, max: 1.2, step: 0.05, label: 'molla smorzamento' },
    // Il giro fra i due corner gemelli (front-left↔front-right ecc.) copre
    // 90° con la STESSA molla degli altri step (45°): a parità di tempo di
    // assestamento risulta uno "sferzata" visivamente troppo rapida. Questo
    // fattore dilata SOLO il tempo percepito dalla molla durante il flip
    // (vedi useFrame → integrate), lasciando invariata la velocità di tutte
    // le altre transizioni. 0.29 (era 0.2, troppo lento): misurato per un
    // arrivo sul target ~20% più rapido del preset precedente — il valore
    // compensa anche lo smorzamento extra del flip (cFlip, vedi useFrame)
    // che di suo rallenterebbe leggermente l'avvicinamento.
    flipSpeed: { value: 0.29, min: 0.05, max: 1, step: 0.01, label: 'velocità flip' },
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
  // flipSlow: per asse, true mentre è in corso il giro fra due corner
  // gemelli — l'integratore in useFrame dilata il tempo percepito su
  // quell'asse (vedi feel.flipSpeed), si azzera da sé al termine.
  const spring = useRef({ vx: 0, vy: 0, flipSlow: { x: false, y: false } })
  const layout = useRef({ portrait: false })
  // Timestamp (ms) dell'ultimo commit da tastiera per asse: misura quanto
  // sono ravvicinati gli step per stimare una "velocità" di interazione e
  // seminare il bounce di conseguenza (vedi commitStep/seedKeyBounce) — il
  // drag ha già una velocità reale misurata durante il gesto, qui la si
  // ricava dalla cadenza delle pressioni.
  const keyCommitAt = useRef({ pitch: 0, yaw: 0 })

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
    // Il canvas non è nativamente focus-abile: serve per intercettare le
    // frecce direzionali senza ascoltare su tutta la window.
    el.tabIndex = 0
    el.style.outline = 'none'

    // Vista orizzontale = pitch 0: unica posizione da cui è concesso
    // slittare lateralmente (regola invariata dal set precedente).
    const atFrontView = () => atZeroAngle(p.pitch)

    // Velocità implicita di un asse dalla cadenza dei commit da tastiera:
    // semina la molla così il bounce risponde a QUANTO VELOCEMENTE si
    // ripetono gli step, non solo al singolo salto di 45°.
    const seedKeyBounce = (axisKey, delta) => {
      const now = performance.now()
      const last = keyCommitAt.current[axisKey]
      keyCommitAt.current[axisKey] = now
      const vKey = axisKey === 'pitch' ? 'vx' : 'vy'
      const dt = (now - last) / 1000
      if (last === 0 || dt > KEY_BOUNCE_MAX_DT) {
        spring.current[vKey] = 0 // prima pressione o pausa lunga: solo il bounce "di base"
        return
      }
      const v = delta / Math.max(dt, KEY_BOUNCE_MIN_DT)
      spring.current[vKey] = clamp(v, -KEY_BOUNCE_MAX_SPEED, KEY_BOUNCE_MAX_SPEED)
    }

    // Un singolo step di 45° nella direzione data, come farebbe il commit a
    // fine drag: la molla in useFrame anima l'assestamento (bounce incluso)
    // esattamente come dopo un rilascio, seminata dalla velocità implicita
    // della cadenza di pressione (vedi seedKeyBounce).
    const commitStep = (axis, dir) => {
      if (axis === 'pitch') {
        // Alle pose dell'arco corner (yaw ±45°, vedi CORNER_ARC in
        // poseGraph.js) il verticale naviga l'intera sequenza a 4 tappe
        // 3-4-left ↔ front-left ↔ front-right ↔ 3-4-right, cambiando anche
        // yaw dove serve (il giro sull'altro lato). Altrove resta il
        // mini-step di solo pitch.
        const arcNext = cornerArcStep(p.pitch, p.yaw, dir)
        if (arcNext) {
          // Flip = solo yaw cambia (giro fra i due corner gemelli): rallenta
          // quell'asse. I mini-step ring↔corner (solo pitch) restano veloci.
          // Tolleranza invece di === : pitch arriva sempre dalle stesse
          // costanti in uso normale, ma resta robusto anche da fonti esterne
          // (es. window.__setPose di debug) con arrotondamenti diversi.
          spring.current.flipSlow.y = Math.abs(arcNext.pitch - p.pitch) < 1e-6
          spring.current.flipSlow.x = false
          seedKeyBounce('pitch', arcNext.pitch - p.pitch)
          seedKeyBounce('yaw', arcNext.yaw - p.yaw)
          p.pitch = arcNext.pitch
          p.yaw = arcNext.yaw
          p.targetX = arcNext.pitch
          p.targetY = arcNext.yaw
          return
        }
        spring.current.flipSlow.x = false
        spring.current.flipSlow.y = false
        const stop = adjacentStop(
          pitchStopsAt(p.yaw, layout.current.portrait),
          p.pitch,
          dir,
        )
        if (stop == null) return
        seedKeyBounce('pitch', stop - p.pitch)
        p.pitch = stop
        p.targetX = stop
      } else {
        if (!atFrontView()) return
        spring.current.flipSlow.x = false
        spring.current.flipSlow.y = false
        const stop = nextYawStop(p.yaw, dir)
        seedKeyBounce('yaw', stop - p.yaw)
        p.yaw = stop
        p.targetY = stop
      }
    }

    let hovered = false
    const onPointerEnter = () => {
      hovered = true
    }
    const onPointerLeave = () => {
      hovered = false
    }
    const onKeyDown = (e) => {
      if (!hovered && document.activeElement !== el) return
      switch (e.key) {
        case 'ArrowUp':
          commitStep('pitch', -1)
          break
        case 'ArrowDown':
          commitStep('pitch', 1)
          break
        case 'ArrowLeft':
          commitStep('yaw', -1)
          break
        case 'ArrowRight':
          commitStep('yaw', 1)
          break
        default:
          return
      }
      e.preventDefault()
    }

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
      d.cornerArc = undefined // deciso al primo superamento della deadzone
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
        // Deciso una sola volta, al primo superamento della deadzone, e
        // tenuto per tutto il gesto (niente cambio di modalità a metà drag).
        // Dai corner (pitch ≠ 0) qualunque gesto vive sull'arco — lì
        // l'orizzontale è sempre stato muto. Dagli anelli (pitch 0), invece,
        // entra nell'arco SOLO un gesto a dominante verticale: con i 4 archi
        // del round 9 gli stop a yaw ±45°/±135° hanno entrambe le direzioni
        // verticali occupate, e senza questo filtro catturavano anche i
        // gesti orizzontali, uccidendo il drag dell'anello yaw da lì.
        const vertical = Math.abs(dy) >= Math.abs(dx)
        d.cornerArc =
          !atZeroAngle(d.pitch0) || vertical
            ? cornerArcStep(d.pitch0, d.yaw0, Math.sign(pitchDelta) || 1)
            : null
      }

      const f = feelRef.current
      const speed = f.dragSpeed
      const rubberCap = f.rubberCapDeg * DEG

      if (d.cornerArc) {
        // Un solo asse cambia per step di CORNER_ARC (mai una posa
        // diagonale): quello fermo resta ancorato, il progresso verticale
        // del gesto guida l'altro verso la tappa successiva.
        const target = d.cornerArc
        const dPitch = target.pitch - d.pitch0
        const dYaw = target.yaw - d.yaw0
        const raw = Math.abs(pitchDelta) * speed
        const along = (start, span) =>
          softClamp(
            start + Math.sign(span) * raw,
            Math.min(start, start + span),
            Math.max(start, start + span),
            f.rubberFactor,
            rubberCap,
          )
        const phiSoft = dPitch !== 0 ? along(d.pitch0, dPitch) : d.pitch0
        const yawSoft = dYaw !== 0 ? along(d.yaw0, dYaw) : d.yaw0
        d.phiSoft = phiSoft
        d.yawSoft = yawSoft
        p.targetX = phiSoft
        p.targetY = yawSoft
        return
      }

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
        // Oltre l'ultimo stop nominale (±180°, il "back") il tetto/pavimento
        // segue di 45° in 45° invece di restare fisso: il drag può continuare
        // a girare in loop senza mai sentire l'elastico da quel punto in poi.
        const loY = nextYawStop(d.yaw0, -1)
        const hiY = nextYawStop(d.yaw0, 1)
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

      if (d.cornerArc) {
        // Commit dedicato: la tappa successiva di CORNER_ARC (sul suo unico
        // asse mobile), o ritorno alla tappa di partenza se il gesto non ha
        // superato la soglia — stessa logica soglia/rilascio degli altri assi.
        const target = d.cornerArc
        const dPitch = target.pitch - d.pitch0
        const dYaw = target.yaw - d.yaw0
        const progress = dPitch !== 0
          ? Math.abs((d.phiSoft - d.pitch0) / dPitch)
          : Math.abs((d.yawSoft - d.yaw0) / dYaw)
        const commit = progress >= threshold
        // Flip = solo yaw cambia e il rilascio l'ha effettivamente
        // committato: rallenta quell'asse (vedi commitStep per il perché).
        spring.current.flipSlow.y = commit && Math.abs(dPitch) < 1e-6
        spring.current.flipSlow.x = false
        p.pitch = commit ? target.pitch : d.pitch0
        p.yaw = commit ? target.yaw : d.yaw0
        p.targetX = p.pitch
        p.targetY = p.yaw
        return
      }
      spring.current.flipSlow.x = false
      spring.current.flipSlow.y = false

      // Progresso di un asse verso lo stop adiacente nella direzione del
      // gesto. Oltre 1 (coda elastica) committa comunque; senza stop
      // (estremo d'arco) il progresso è nullo e si torna alla partenza.
      const axisPlan = (start, target, findStop) => {
        const delta = target - start
        if (Math.abs(delta) < EPS) return { stop: null, progress: 0 }
        const stop = findStop(start, Math.sign(delta))
        if (stop == null) return { stop: null, progress: 0 }
        return { stop, progress: Math.abs(delta / (stop - start)) }
      }

      const pitchPlan = axisPlan(d.pitch0, d.phiSoft, (start, dir) =>
        adjacentStop(pitchStopsAt(d.yaw0, layout.current.portrait), start, dir),
      )
      // yaw: nextYawStop non si ferma mai al back, permette il loop completo.
      const yawPlan = axisPlan(d.yaw0, d.yawSoft, nextYawStop)

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
    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerenter', onPointerEnter)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('keydown', onKeyDown)
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
    // Flip: corsa doppia (90° contro i 45° di uno step normale) → a parità
    // di ζ l'overshoot in GRADI raddoppia, e il bounce sembra enorme
    // rispetto al resto. Compensazione: ζ alzato quel tanto che dimezza la
    // frazione di overshoot (nel dominio log u = πζ/√(1-ζ²) basta u+ln2),
    // così il rimbalzo assoluto resta quello di uno step normale — il
    // bounce non scala con la distanza di partenza dell'animazione.
    let cFlip = c
    if (f.springDamping < 1) {
      const z = f.springDamping
      const u = (Math.PI * z) / Math.sqrt(1 - z * z) + Math.LN2
      cFlip = 2 * (u / Math.sqrt(Math.PI * Math.PI + u * u)) * Math.sqrt(k)
    }
    const integrate = (axis, vKey, target, slow) => {
      // Durante il flip fra due corner gemelli la STESSA molla lavora in
      // slow motion: dt ridotto solo per quest'asse (feel.flipSpeed) e
      // smorzamento compensato (cFlip). Si azzera da sé all'assestamento.
      const axisDt = slow ? dt * f.flipSpeed : dt
      const cAxis = slow ? cFlip : c
      const x = group.rotation[axis]
      if (Math.abs(x - target) < 1e-4 && Math.abs(s[vKey]) < 1e-3) {
        group.rotation[axis] = target
        s[vKey] = 0
        if (slow) s.flipSlow[axis === 'x' ? 'x' : 'y'] = false
        return
      }
      s[vKey] += (k * (target - x) - cAxis * s[vKey]) * axisDt
      group.rotation[axis] = x + s[vKey] * axisDt
    }
    integrate('x', 'vx', p.targetX, s.flipSlow.x)
    integrate('y', 'vy', p.targetY, s.flipSlow.y)
  })
}
