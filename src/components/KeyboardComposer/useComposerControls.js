import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import { easing } from 'maath'
import {
  DEG,
  stepTo,
  findPoseKey,
  wrapYaw,
  POSE_COORD,
  ENTRY_LANDSCAPE,
  PORTRAIT_YAW_OFFSET,
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
// ravvicinate (premendo a raffica), più bounce all'arrivo. NB: tenere premuto
// NON conta più come raffica — l'auto-repeat è filtrato (vedi heldKeys), una
// pressione continuata vale un solo step. KEY_BOUNCE_MAX_SPEED è un tetto di
// sicurezza contro overshoot eccessivi con ripetizioni fortissime.
const KEY_BOUNCE_MIN_DT = 0.02
const KEY_BOUNCE_MAX_DT = 0.6
const KEY_BOUNCE_MAX_SPEED = 8 // rad/s

// Debounce anti-raffica sulle frecce. `heldKeys`/`e.repeat` già filtrano
// l'auto-repeat del TENERE premuto (una pressione continuata = uno step); questo
// copre l'altro caso, il MARTELLARE il tasto: pressioni distinte troppo
// ravvicinate sommavano step e slancio (vedi seedKeyBounce) fino a far frustare
// il modello oltre le pose ("spinning"). Sotto questa soglia una nuova pressione
// viene ignorata, così la molla fa sempre in tempo ad assestarsi tra uno step e
// l'altro: al più uno step ogni KEY_DEBOUNCE_MS.
const KEY_DEBOUNCE_MS = 300

// Passo di riferimento: la transizione "sui mezzi" (45°) detta il feel di
// tutto il grafo. Uno step da 90° (i 3/4 corner→corner) con la STESSA molla si
// sente diverso in due modi indipendenti, e servono due correzioni distinte:
//  1) VELOCITÀ — una molla lineare si assesta nello stesso TEMPO qualunque sia
//     l'ampiezza, quindi un 90° percorre il doppio dell'angolo nello stesso
//     tempo = velocità angolare doppia (una "sferzata"). Si dilata il tempo
//     percepito di 1/amp: un 90° dura il doppio, stessi gradi al secondo.
//  2) BOUNCE — l'overshoot è una FRAZIONE dell'ampiezza che dipende solo da ζ,
//     e la dilatazione temporale non la tocca: un 90° rimbalza il doppio dei
//     GRADI di un 45°. Si alza ζ quel tanto che riporta l'overshoot assoluto a
//     quello del passo di riferimento (vedi la molla in useFrame).
const REF_STEP = 45 * DEG

// Frecce → direzione nel grafo. Letterali: Su = verso il top, Sinistra = yaw
// crescente (vedi il commento del hook).
const ARROW_DIR = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

// Ampiezza di uno step in "unità di 45°", da cui derivano entrambe le
// correzioni qui sopra. Si guarda l'asse che si muove di PIÙ e il fattore vale
// per entrambi: gli step a due assi (CFT↔TL/TR: 45° di yaw + ~10° di pitch)
// devono restare sincronizzati, non veder finire il pitch molto prima dello
// yaw. Mai < 1: gli step più corti dei 45° restano esattamente come sono oggi.
const stepAmp = (dPitch, dYaw) => {
  const m = Math.max(Math.abs(dPitch), Math.abs(dYaw))
  return m > REF_STEP ? m / REF_STEP : 1
}

// Oltre lo stop adiacente (o l'estremo d'arco) il target non si ferma secco:
// l'eccesso prosegue compresso — la "resistenza elastica" che si sente
// tirando più forte del necessario, e che al rilascio alimenta il bounce.
const softClamp = (raw, lo, hi, factor, cap) => {
  if (raw > hi) return hi + Math.min((raw - hi) * factor, cap)
  if (raw < lo) return lo - Math.min((lo - raw) * factor, cap)
  return raw
}

/**
 * Controlli del configuratore — rotazione a pose fisse su un GRAFO DI
 * ADIACENZA (vedi poseGraph.js: NEIGHBORS/stepTo). Round 10:
 *  - frecce direzionali LETTERALI (attive con hover o focus sul canvas):
 *    Sinistra = yaw crescente, Destra = yaw calante, Su = pitch crescente
 *    (verso il top), Giù = pitch calante. Ogni pressione va al vicino nella
 *    direzione premuta (`stepTo`), o resta ferma se quel vicino non esiste.
 *    Una pressione = UNO step: l'auto-repeat del sistema è filtrato, quindi
 *    tenere premuto non fa girare il modello da solo (vedi heldKeys).
 *  - sui 3/4 (corner) left/right ruotano di 90° saltando la vista laterale
 *    pura; verso il centro-fronte lo step è 45°. Colonna centrale yaw 0
 *    (TBACK·TOP·CFT·FRONT·CFB·BOTTOM·BBACK): unica via a zenit/nadir, e ai due
 *    estremi prosegue di un ultimo step da 45° oltre il Top ("3-4 back",
 *    pitch 135°) e oltre il bottom (il sottoscocca, pitch -135°) — simmetrica.
 *    Nessun flip: il modello non ruota mai su se stesso.
 *  - drag omnidirezionale con soft cap: l'asse dominante del gesto sceglie il
 *    vicino (drag ↓/→ = pitch/yaw crescente → up/left; drag ↑/← = down/right),
 *    il modello interpola verso quella posa con coda elastica compressa. Se il
 *    vicino non esiste, solo elastico attorno alla posa di partenza. Il verso
 *    del drag è quello storico "afferra e ruota" (speculare alle frecce).
 *  - al rilascio committa se il progresso verso il vicino supera la soglia
 *    (commitFraction), altrimenti torna alla posa di partenza.
 *  - BOUNCE: il settle è una molla smorzata (sotto-smorzata) seminata con la
 *    velocità reale del modello al rilascio (o con la cadenza dei tasti). Un
 *    solo preset di molla, tarato sul passo di riferimento da 45°: gli step
 *    più ampi (i 90° dei 3/4) vi si riconducono con due correzioni derivate
 *    dall'ampiezza (vedi stepAmp e la molla in useFrame) — tempo dilatato di
 *    1/amp (stessa velocità angolare) e ζ alzato di ln(amp) (stesso overshoot
 *    in gradi). Un 90° quindi dura il doppio di un 45° e rimbalza uguale.
 *  - nessuno zoom: né rotella, né pinch. La distanza camera deriva solo dal
 *    fit responsive; focale tele (200mm) per la prospettiva compressa
 *    "commercial".
 *  - mobile portrait: ingresso nella posa top verticale (pitch 90° + yaw 90°,
 *    manopole in alto); l'intero grafo è traslato di +90° in yaw
 *    (PORTRAIT_YAW_OFFSET) per il fit su schermo alto, per il resto identico.
 *    La traslazione è dedotta dalla POSA d'ingresso e congelata (frame ref):
 *    un resize non la sposta mai sotto i piedi della posa corrente.
 */
export function useComposerControls(
  groupRef,
  {
    focalLength = 200, // mm equivalenti (35mm): tele spinto, effetto commercial
    initialRotation = { x: ENTRY_LANDSCAPE.x, y: ENTRY_LANDSCAPE.y },
    // Ref opzionale su cui esporre `{ goTo(poseKey) }`: serve alla
    // pulsantiera delle viste, che vive nel DOM FUORI dal Canvas e non può
    // quindi raggiungere questi ref altrimenti.
    apiRef,
  } = {},
) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // NUOVO: Svincoliamo l'interpolazione dal group 3D
  const curAngles = useRef({ pitch: initialRotation.x, yaw: initialRotation.y })
  const cameraRadius = useRef(5.2)

  // Parametri "feel" regolabili dal pannello (?debug): i default sono i
  // valori di produzione.
  const feel = useControls('Rotazione', {
    enableOrbit: { value: false, label: 'Abilita Orbit Controls' }, // NUOVO
    dragSpeed: { value: 0.01, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
    followTime: { value: 0.2, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
    // Drag più lento (era 0.008) e più attrito in assestamento: gesto più
    // pesante. Damping 0.8→0.55 e stiffness 40→50: il bounce (quasi
    // impercettibile a 0.8, ζ≈0.8 → ~1.5% di overshoot) torna visibile
    // (ζ≈0.55 → ~13% di overshoot) restando comunque più lento/pesante di
    // prima (il tempo di assestamento a riposo, senza extra-velocità, è
    // ~1.3s contro ~1s del preset precedente).
    dragSpeed: { value: 0.01, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
    followTime: { value: 0.2, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
    commitFraction: { value: 0.2, min: 0.1, max: 0.9, step: 0.05, label: 'soglia step' },
    springStiffness: { value: 150, min: 20, max: 300, step: 5, label: 'molla rigidità' },
    springDamping: { value: 0.85, min: 0.2, max: 1.2, step: 0.05, label: 'molla smorzamento' },
    rubberFactor: { value: 0, min: 0, max: 0.6, step: 0.05, label: 'elastico oltre-step' },
    rubberCapDeg: { value: 0, min: 0, max: 20, step: 1, label: 'elastico max (°)' },
    // Moltiplicatore globale del tempo delle animazioni: scala il delta di
    // OGNI integrazione in useFrame (follow del drag + molla di bounce), quindi
    // rallenta/accelera tutto in modo uniforme senza toccare rigidità, gradi al
    // secondo relativi o overshoot. 1 = velocità nominale; default 0.3 = 70%
    // più lento (richiesta cliente: movimenti più rallentati e "solidi").
    // Tarabile live da ?debug.
    timeScale: { value: 0.3, min: 0.3, max: 1.5, step: 0.05, label: 'velocità animazione' },
    fitMargin: { value: 1.6, min: 1, max: 2.5, step: 0.05, label: 'margine inquadratura' },
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
  // Una sola molla per TUTTI gli step (round 10). `amp` = ampiezza dello step
  // corrente in unità di 45° (vedi stepAmp): da lì la molla in useFrame ricava
  // sia la dilatazione del tempo (stessa velocità angolare) sia lo smorzamento
  // compensato (stesso overshoot in gradi). 1 = passo di riferimento.
  const spring = useRef({ vx: 0, vy: 0, amp: 1 })
  // Frame del grafo = traslazione in yaw delle pose canoniche. Dedotto UNA
  // VOLTA dalla posa d'ingresso (vedi sotto), MAI dal viewport corrente: in
  // portrait si entra a yaw 90° e tutto il grafo vive traslato di +90°, ma il
  // frame appartiene alla POSA, non alle dimensioni della finestra. Legarlo al
  // flag portrait significherebbe che un resize a finestra più alta che larga
  // sposta il frame sotto i piedi della posa corrente: `findPoseKey` cercherebbe
  // a yaw −90°, dove (round 10) non esiste più nessuna posa → stepTo torna null
  // e la navigazione muore in silenzio su ogni freccia.
  const frame = useRef({ yawOffset: 0 })
  // Timestamp (ms) dell'ultimo commit da tastiera per asse: misura quanto
  // sono ravvicinati gli step per stimare una "velocità" di interazione e
  // seminare il bounce di conseguenza (vedi commitStep/seedKeyBounce) — il
  // drag ha già una velocità reale misurata durante il gesto, qui la si
  // ricava dalla cadenza delle pressioni.
  const keyCommitAt = useRef({ pitch: 0, yaw: 0 })

  // API imperativa per la pulsantiera delle viste (ViewPad), che vive nel DOM
  // fuori dal Canvas. `goTo` non è un salto secco come __setPose: imposta il
  // target e lascia animare la STESSA molla del resto (stessa velocità
  // angolare, stesso bounce), e committa la posa così le frecce riprendono da
  // lì senza casi speciali.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      goTo(key) {
        const c = POSE_COORD[key]
        if (!c) return
        const p = pose.current
        // Percorso più breve dallo yaw GREZZO corrente (che può aver
        // accumulato giri) al target nel frame corrente: mai un giro intero
        // in più solo per raggiungere la stessa posa.
        const yaw =
          p.yaw + wrapYaw(c.yaw + frame.current.yawOffset - p.yaw)
        spring.current.amp = stepAmp(c.pitch - p.pitch, yaw - p.yaw)
        p.pitch = c.pitch
        p.yaw = yaw
        p.targetX = c.pitch
        p.targetY = yaw
      },
      // Posa COMMITTATA corrente (chiave del grafo) o null se il modello è
      // fra due pose (mai, a regime: pitch/yaw sono sempre su una posa dopo il
      // commit) o non riconosciuta. È il "trigger event" delle luci per-vista:
      // il LightRig la legge ogni frame per sapere verso quale set sfumare. Si
      // ricalcola al volo dai ref, così vale anche per frecce e drag, non solo
      // per goTo.
      currentPoseKey() {
        return findPoseKey(
          pose.current.pitch,
          pose.current.yaw,
          frame.current.yawOffset,
        )
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef])

  // Debug-only: salto secco a una posa (audit multi-posa via ?debug).
  // window.__setPose(pitchDeg, yawDeg) — non tocca il flusso di produzione.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return
    window.__setPose = (pitchDeg, yawDeg) => {
      const p = pose.current
      p.pitch = p.targetX = (pitchDeg * Math.PI) / 180
      p.yaw = p.targetY = (yawDeg * Math.PI) / 180
      spring.current.vx = spring.current.vy = 0
      curAngles.current.pitch = p.targetX
      curAngles.current.yaw = p.targetY
      return { pitch: pitchDeg, yaw: yawDeg }
    }
    return () => {
      delete window.__setPose
    }
  }, [])

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
    // Frame dedotto dalla posa d'ingresso stessa: si sceglie l'unica
    // traslazione in cui l'ingresso È una posa del grafo. Landscape entra su
    // TL (canonico → offset 0); portrait entra a (90°, 90°), che è TOP solo
    // guardandolo traslato di +90°. Nessuna dipendenza dal viewport.
    frame.current.yawOffset =
      findPoseKey(initialRotation.x, initialRotation.y, 0) != null
        ? 0
        : PORTRAIT_YAW_OFFSET
  }

  // Fit responsive a distanza fissa (nessuno zoom utente), camera LIVELLATA
  // sulla quota del pivot: le viste front/left/right del cliente sono a
  // elevazione zero, ogni inclinazione viene dal pitch del modello. In
  // portrait il modello è in verticale, quindi si fitta sull'altezza.
  useEffect(() => {
    camera.setFocalLength(focalLength) // imposta il fov dalla focale (film 35mm)
    const aspect = size.width / Math.max(size.height, 1)
    // Solo per l'inquadratura: il frame del grafo NON dipende da questo (vedi
    // frame.current.yawOffset), così un resize non rompe la navigazione.
    const portrait = aspect < 1
    const tanHalfV = Math.tan((camera.fov * Math.PI) / 360)
    let fit = portrait
      ? FIT_HALF_WIDTH / tanHalfV
      : FIT_HALF_WIDTH / (tanHalfV * aspect)
    fit *= feel.fitMargin
    if (portrait) fit *= feel.zoomOutMobile
    cameraRadius.current = clamp(fit, 5.2, 200)
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

    // Un singolo step verso il vicino nella direzione data ('up'|'down'|
    // 'left'|'right'), come farebbe il commit a fine drag: la molla in
    // useFrame anima l'assestamento (bounce incluso) esattamente come dopo un
    // rilascio, seminata dalla velocità implicita della cadenza di pressione
    // (vedi seedKeyBounce). Se il vicino non esiste, non committa nulla.
    const commitStep = (dir) => {
      const target = stepTo(p.pitch, p.yaw, dir, frame.current.yawOffset)
      if (!target) return
      const dPitch = target.pitch - p.pitch
      const dYaw = target.yaw - p.yaw
      spring.current.amp = stepAmp(dPitch, dYaw)
      if (Math.abs(dPitch) > EPS) seedKeyBounce('pitch', dPitch)
      if (Math.abs(dYaw) > EPS) seedKeyBounce('yaw', dYaw)
      p.pitch = target.pitch
      p.yaw = target.yaw
      p.targetX = target.pitch
      p.targetY = target.yaw
    }

    let hovered = false
    const onPointerEnter = () => {
      hovered = true
    }
    const onPointerLeave = () => {
      hovered = false
    }
    // Tasti freccia attualmente premuti. Serve a rendere la pressione
    // CONTINUATA equivalente a una singola: tenendo giù una freccia il sistema
    // operativo sparerebbe un auto-repeat a raffica e il modello girerebbe da
    // solo (spinning) senza altre pressioni. Una pressione = uno step; per il
    // successivo bisogna rilasciare e ripremere.
    const heldKeys = new Set()
    // Timestamp (ms) dell'ultimo step da tastiera realmente eseguito: base del
    // debounce anti-raffica (vedi KEY_DEBOUNCE_MS).
    let lastKeyStepAt = 0
    const onKeyDown = (e) => {
      if (!hovered && document.activeElement !== el) return
      const dir = ARROW_DIR[e.key]
      if (!dir) return
      e.preventDefault() // niente scroll della pagina, anche sui ripetuti
      // `e.repeat` copre l'auto-repeat vero; il set copre anche i casi in cui
      // il flag non arriva (eventi sintetici) e i keydown doppi.
      if (e.repeat || heldKeys.has(e.key)) return
      heldKeys.add(e.key)
      // Debounce: pressioni distinte troppo ravvicinate (martellamento) vengono
      // ignorate — niente accumulo di step/slancio, niente spinning. Il tasto
      // resta comunque in heldKeys così il suo keyup lo ripulisce normalmente.
      const now = performance.now()
      if (now - lastKeyStepAt < KEY_DEBOUNCE_MS) return
      lastKeyStepAt = now
      commitStep(dir)
    }
    // keyup/blur su window, non su el: se il focus si sposta mentre il tasto è
    // giù, il keyup non arriverebbe mai al canvas e la freccia resterebbe
    // "premuta" per sempre, bloccando ogni pressione successiva.
    const onKeyUp = (e) => {
      heldKeys.delete(e.key)
    }
    const onWindowBlur = () => {
      heldKeys.clear()
    }

    const onDown = (e) => {
      if (feelRef.current.enableOrbit) return; // NUOVO: Cede il controllo a OrbitControls
      if (d.pointerId != null) return // gesto già in corso: dita extra ignorate
      d.pointerId = e.pointerId
      d.moved = false
      d.startX = e.clientX
      d.startY = e.clientY
      d.pitch0 = p.pitch
      d.yaw0 = p.yaw
      d.phiSoft = p.pitch
      d.yawSoft = p.yaw
      d.step = undefined // deciso al primo superamento della deadzone
      d.stepAxis = undefined
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // pointer sintetici (test) non catturabili: i gesti funzionano comunque
      }
      el.style.cursor = 'grabbing'
    }

    const onMove = (e) => {
      if (feelRef.current.enableOrbit) return; // NUOVO
      if (e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      // Feel storico "afferra e ruota" (invariato): trascinare in giù/destra
      // fa crescere pitch/yaw. Risulta speculare alle frecce, come da
      // richiesta round 10 ("cambio solo le frecce").
      const pitchDelta = dy
      const yawDelta = dx

      if (!d.moved) {
        if (Math.hypot(dx, dy) < AXIS_DEADZONE) return
        d.moved = true
        // Asse dominante deciso una sola volta, poi il vicino nel grafo nella
        // direzione del gesto: drag ↓/→ = pitch/yaw crescente → up/left;
        // drag ↑/← = down/right. Un solo asse per gesto (mai pose diagonali).
        const vertical = Math.abs(dy) >= Math.abs(dx)
        d.stepAxis = vertical ? 'pitch' : 'yaw'
        const dir = vertical
          ? pitchDelta > 0
            ? 'up'
            : 'down'
          : yawDelta > 0
            ? 'left'
            : 'right'
        d.step = stepTo(d.pitch0, d.yaw0, dir, frame.current.yawOffset)
      }

      const f = feelRef.current
      const speed = f.dragSpeed
      const rubberCap = f.rubberCapDeg * DEG
      // Progresso guidato dall'asse dominante del gesto.
      const signDelta = d.stepAxis === 'pitch' ? pitchDelta : yawDelta
      const raw = Math.abs(signDelta) * speed

      if (d.step) {
        // Interpola pitch+yaw da (pitch0,yaw0) verso il vicino, proporzionale
        // al progresso lungo l'asse dominante; coda elastica oltre la posa.
        // Quasi tutti gli step muovono un solo asse; l'unica eccezione è
        // CFT↔TL/TR (yaw + ~10° di pitch), che qui si muove insieme come
        // singola transizione verso la posa (non una posa diagonale libera).
        const dPitch = d.step.pitch - d.pitch0
        const dYaw = d.step.yaw - d.yaw0
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
      } else {
        // Nessun vicino in quella direzione: solo coda elastica sull'asse
        // dominante, ancorata alla posa di partenza.
        const sign = Math.sign(signDelta) || 1
        const elastic = (start) =>
          softClamp(start + sign * raw, start, start, f.rubberFactor, rubberCap)
        if (d.stepAxis === 'pitch') {
          const phiSoft = elastic(d.pitch0)
          d.phiSoft = phiSoft
          d.yawSoft = d.yaw0
          p.targetX = phiSoft
          p.targetY = d.yaw0
        } else {
          const yawSoft = elastic(d.yaw0)
          d.phiSoft = d.pitch0
          d.yawSoft = yawSoft
          p.targetX = d.pitch0
          p.targetY = yawSoft
        }
      }
    }

    const onUp = (e) => {
      if (e.pointerId !== d.pointerId) return
      d.pointerId = null
      el.style.cursor = 'grab'
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!d.moved) return
      d.moved = false
      const threshold = feelRef.current.commitFraction // 0.5 = nearest
      if (!d.step) {
        spring.current.amp = 1
        p.pitch = d.pitch0
        p.yaw = d.yaw0
        p.targetX = p.pitch
        p.targetY = p.yaw
        return
      }
      const target = d.step
      const dPitch = target.pitch - d.pitch0
      const dYaw = target.yaw - d.yaw0
      const soft = d.stepAxis === 'pitch' ? d.phiSoft : d.yawSoft
      const start = d.stepAxis === 'pitch' ? d.pitch0 : d.yaw0
      const span = d.stepAxis === 'pitch' ? dPitch : dYaw
      const progress = Math.abs(span) < EPS ? 0 : Math.abs((soft - start) / span)
      const commit = progress >= threshold

      spring.current.amp = commit ? stepAmp(dPitch, dYaw) : 1
      p.pitch = commit ? target.pitch : d.pitch0
      p.yaw = commit ? target.yaw : d.yaw0
      p.targetX = p.pitch
      p.targetY = p.yaw
    }

    // LOGICA DI ZOOM
    const onWheel = (e) => {
      e.preventDefault()
      cameraRadius.current = clamp(
        cameraRadius.current * (1 + e.deltaY * 0.0012),
        2.5,
        40
      )
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('wheel', onWheel, { passive: false }) // ASCOLTO ZOOM

    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerenter', onPointerEnter)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('wheel', onWheel) // RIMOZIONE ZOOM
      
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [gl, initialRotation.x, initialRotation.y]) // Dipendenze pulite

  useFrame((_, delta) => {
    const p = pose.current
    const s = spring.current
    const cur = curAngles.current
    const f = feelRef.current

    if (!p.initialized) {
      cur.pitch = p.targetX
      cur.yaw = p.targetY
      s.vx = 0
      s.vy = 0
      p.initialized = true
    }

    const scaledDelta = delta * f.timeScale
    const dt = Math.min(scaledDelta, 1 / 30)
    if (dt <= 0) return

    if (drag.current.pointerId != null) {
      const px = cur.pitch
      const py = cur.yaw
      easing.damp(cur, 'pitch', p.targetX, f.followTime, scaledDelta)
      easing.damp(cur, 'yaw', p.targetY, f.followTime, scaledDelta)
      s.vx = (cur.pitch - px) / dt
      s.vy = (cur.yaw - py) / dt
    } else {
      const k = f.springStiffness
      let c = 2 * f.springDamping * Math.sqrt(k)
      if (s.amp > 1 && f.springDamping < 1) {
        const z = f.springDamping
        const u = (Math.PI * z) / Math.sqrt(1 - z * z) + Math.log(s.amp)
        c = 2 * (u / Math.sqrt(Math.PI * Math.PI + u * u)) * Math.sqrt(k)
      }
      const stepDt = dt / s.amp
      const integrate = (axis, vKey, target) => {
        const x = cur[axis]
        if (Math.abs(x - target) < 1e-4 && Math.abs(s[vKey]) < 1e-3) {
          cur[axis] = target
          s[vKey] = 0
          return
        }
        s[vKey] += (k * (target - x) - c * s[vKey]) * stepDt
        cur[axis] = x + s[vKey] * stepDt
      }
      integrate('pitch', 'vx', p.targetX)
      integrate('yaw', 'vy', p.targetY)
    }

    // Orbita della telecamera: rotazione inversa perfetta tramite quaternioni
    camera.quaternion.setFromEuler(new THREE.Euler(-cur.pitch, -cur.yaw, 0, 'YXZ'))
    
    // Posizioniamo la telecamera al raggio corrente e applichiamo la rotazione
    camera.position.set(0, 0, cameraRadius.current)
    camera.position.applyQuaternion(camera.quaternion)
    camera.position.y += PIVOT_Y
  })
}
