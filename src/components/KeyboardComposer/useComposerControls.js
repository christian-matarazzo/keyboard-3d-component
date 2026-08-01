import * as THREE from 'three'
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'
import { DEG, wrapYaw } from './poseGraph'
import { measureGroupFraming } from './focusFraming'
import { useComposerSection } from './state/useComposerSection'

// La rotella è uno STRUMENTO DI AUTHORING, non un'interazione di prodotto: in
// produzione lo zoom è solo quello autorato sui gruppi (vedi focusGroup). Il
// flag è ricalcolato qui come negli altri file (mai threadato come prop) —
// vedi la sezione "Debug flag" in CLAUDE.md.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Mezza larghezza del modello + margine: usata per il fit responsive.
const FIT_HALF_WIDTH = 2.0
// Altezza del pivot del modello: la camera è livellata su questa quota
// (le viste frontali/laterali del cliente hanno elevazione zero).
const PIVOT_Y = 0.1
// Sotto questa distanza (px) il gesto non ha ancora un asse dominante.
const AXIS_DEADZONE = 6
const EPS = 1e-6

// ZOOM UTENTE — lo zoom della rotella NON è un raggio assoluto ma un FATTORE
// moltiplicativo applicato sopra al raggio di inquadratura calcolato dal fit.
// È l'unico modo per garantire quello che serve: qualunque ricalcolo del fit
// (resize della finestra, cambio focale/margine, fit dinamico entrando in
// modalità Luci, caricamento di un JSON che cambia fitMargin/zoomOutMobile)
// riscrive solo la BASE, e lo zoom scelto dall'utente viene riapplicato
// sopra — mai azzerato. Prima lo zoom viveva direttamente in cameraRadius e
// il primo fit che passava lo cancellava.
const ZOOM_MIN = 0.2
const ZOOM_MAX = 4
// Pavimento del raggio COMPOSTO. Abbassato da 2.5 per lo zoom sui gruppi: con
// focale 200mm (fov ≈ 5.6° in landscape) baseRadius vale ~36 unità-scena e
// inquadrare un gruppo piccolo (rotori, tasselli) chiede raggi di pochi unità
// — il vecchio 2.5 sarebbe stato un tetto invisibile sull'avvicinamento. Resta
// comunque sopra il near plane di default (0.1).
const RADIUS_MIN = 0.8
const RADIUS_MAX = 200
// Raggio minimo che il FIT (non lo zoom manuale) può produrre. ATTENZIONE:
// riguarda SOLO i due percorsi di fit sul modello intero — non va mai applicato
// al focus sui gruppi, che per definizione deve poter scendere sotto
// l'inquadratura d'insieme.
const FIT_RADIUS_MIN = 5.2

// ZOOM DI PRODOTTO SUI GRUPPI ("focus"): terzo fattore moltiplicativo sopra il
// fit, con ref propria, esattamente come userZoom (vedi applyRadius). Espresso
// come FATTORE e non come raggio assoluto perché così è invariante ai
// ricalcoli del fit: il rapporto fra la distanza che inquadra un oggetto di
// mezza-estensione R e quella che ne inquadra uno di FIT_HALF_WIDTH vale
// R/FIT_HALF_WIDTH qualunque siano fov, aspect, fitMargin e zoomOutMobile —
// tutti termini che si semplificano fra numeratore e denominatore. Un resize o
// un cambio di margine riscrive quindi solo baseRadius e il focus resta valido
// senza alcuna riconciliazione.
const FOCUS_ZOOM_MIN = 0.02
const FOCUS_ZOOM_MAX = 4

// Soglie di "focus assestato" interrogate dal sequencer delle animazioni
// (isFocusSettled sotto). Il pivot è in unità-scena, quindi una soglia assoluta
// va bene; il fattore di zoom no — i suoi target vanno da 0.02 a 4, un epsilon
// fisso sarebbe lo 0.05% a un estremo e il 10% all'altro. Da qui la soglia
// RELATIVA.
const FOCUS_SETTLE_DIST_SQ = 1e-6
const FOCUS_SETTLE_REL = 5e-3

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
 *  - zoom a rotella come FATTORE sopra il fit responsive (vedi userZoom): il
 *    fit detta l'inquadratura, lo zoom dell'utente la moltiplica e non viene
 *    mai azzerato. SOLO in ?debug — è uno strumento di authoring, in
 *    produzione il listener non viene registrato. Focale tele (200mm) per la
 *    prospettiva compressa "commercial".
 *  - zoom di PRODOTTO sui gruppi di mesh (focusGroup/clearFocus): sposta il
 *    pivot dell'orbita sul centro del gruppo e stringe il raggio con un terzo
 *    fattore moltiplicativo (focusZoom). La navigazione resta viva: si
 *    continua a girare attorno al dettaglio con drag/frecce/pulsantiera.
 *  - il modello non viene mai ruotato: è la camera a orbitare (vedi useFrame),
 *    quindi l'hook NON riceve alcun ref al <group> del modello.
 *  - mobile portrait: ingresso nella posa verticale dichiarata dal prodotto;
 *    l'intero grafo è traslato in yaw di `poseGraph.portraitYawOffset` per il
 *    fit su schermo alto, per il resto identico.
 *    La traslazione è dedotta dalla POSA d'ingresso e congelata (frame ref):
 *    un resize non la sposta mai sotto i piedi della posa corrente.
 */
export function useComposerControls(
  {
    focalLength = 200, // mm equivalenti (35mm): tele spinto, effetto commercial
    // Grafo delle pose del prodotto attivo (obbligatorio): pose, adiacenza,
    // etichette, ingressi e offset portrait. Era importato staticamente da
    // poseGraph.js, quindi il componente poteva navigare un solo modello —
    // vedi products/productSchema.js.
    poseGraph,
    initialRotation = poseGraph?.entryLandscape ?? { x: 0, y: 0 },
    // Ref opzionale su cui esporre `{ goTo(poseKey) }`: serve alla
    // pulsantiera delle viste, che vive nel DOM FUORI dal Canvas e non può
    // quindi raggiungere questi ref altrimenti.
    apiRef,
    // Stato autorato (state/composerStore.js): da qui arriva la sezione
    // `rotation`, cioè i parametri di feel letti ogni frame. È il gemello di
    // `apiRef` per i dati — quello porta i comandi, questo i valori.
    store,
    disabled = false,
    // NUOVO: stato editor, per il lock-guard di goTo (posa bloccata in Mesh)
    // e per il fit dinamico in Luci (vedi sotto). `scene` serve SOLO
    // al Box3 live del fit dinamico — già disponibile in KeyboardModel.jsx
    // (useGLTF), nessun fetch nuovo.
    //
    // `homePoseKey` è la POSA HOME dell'app (autorata in ?debug, salvata nel
    // JSON): posa d'ingresso in landscape, posa a cui si rientra uscendo da
    // config_mode, e posa su cui la modalità Mesh blocca la navigazione. Una
    // manopola sola — vedi Scene.jsx.
    editMode = 'none',
    homePoseKey = null,
    scene,
    // Zoom di prodotto sui gruppi: `meshGroups` serve a classificare le mesh
    // da misurare (stessa fonte di verità del resto, vedi
    // materials/meshGroups.js), `focusOverrides` sono le inquadrature autorate
    // in ?debug e ricaricate dal JSON di produzione
    // (`{ [groupId]: { radiusFactor, offsetX, offsetY, offsetZ } }`).
    meshGroups,
    focusOverrides = null,
  } = {},
) {
  if (!poseGraph) throw new Error('[useComposerControls] serve `poseGraph` (vedi products/)')
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Usiamo una ref per 'disabled' così da avere il valore aggiornato nei listener
  // senza dover ricreare gli eventi a ogni render.
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  // Stessa idea per editMode/homePoseKey: lette dentro goTo (closure creata
  // una sola volta, deps [apiRef]) e dentro il useFrame del fit dinamico,
  // senza dover ricreare closure/riattivare effetti a ogni cambio di editor
  // state.
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode
  const homePoseKeyRef = useRef(homePoseKey)
  homePoseKeyRef.current = homePoseKey
  const meshGroupsRef = useRef(meshGroups)
  meshGroupsRef.current = meshGroups
  const focusOverridesRef = useRef(focusOverrides)
  focusOverridesRef.current = focusOverrides
  // Stesso specchio per il grafo: `goTo`/`currentPoseKey` vivono in una closure
  // creata una volta sola (deps [apiRef]) e i listener del drag/delle frecce
  // sono registrati una volta sola. Un prodotto che cambiasse a caldo
  // lascerebbe quelle closure sul grafo vecchio senza questa ref.
  const poseGraphRef = useRef(poseGraph)
  poseGraphRef.current = poseGraph

  // NUOVO: Svincoliamo l'interpolazione dal group 3D
  const curAngles = useRef({ pitch: initialRotation.x, yaw: initialRotation.y })
  // Distanza camera EFFETTIVA = baseRadius (fit) * userZoom (rotella, solo
  // ?debug) * focusZoom (gruppo inquadrato).
  // Nessun percorso scrive mai cameraRadius direttamente: il fit scrive
  // baseRadius, la rotella scrive userZoom, il focus scrive focusZoom, e
  // applyRadius() ricompone. Così ogni fattore sopravvive ai ricalcoli degli
  // altri. Un eventuale QUARTO scrittore deve avere una ref propria ed essere
  // foldato qui dentro — mai un'assegnazione diretta a cameraRadius.
  const cameraRadius = useRef(5.2)
  const baseRadius = useRef(5.2)
  const userZoom = useRef(1)
  // Terzo fattore: lo zoom sul gruppo inquadrato. `value` è il valore ANIMATO
  // (smorzato ogni frame verso focusZoomTarget) — è quello che entra nella
  // composizione, così la transizione passa dal solito punto unico invece che
  // da qualcuno che scrive cameraRadius.
  const focusZoom = useRef({ value: 1 })
  const focusZoomTarget = useRef(1)
  const applyRadius = () => {
    cameraRadius.current = clamp(
      baseRadius.current * userZoom.current * focusZoom.current.value,
      RADIUS_MIN,
      RADIUS_MAX,
    )
  }

  // Pivot dell'orbita: la camera guarda SEMPRE questo punto. Di default è
  // l'altezza del modello sull'asse (comportamento storico, prima era il
  // letterale `camera.position.y += PIVOT_Y`); inquadrando un gruppo si sposta
  // sul suo centro, perché avvicinarsi soltanto non basta — un gruppo non
  // centrato sull'origine (rotori di lato, rialzo sotto) uscirebbe dal frame
  // man mano che ci si avvicina. `cur` è il valore animato, `target` quello
  // richiesto.
  const pivotCur = useRef(new THREE.Vector3(0, PIVOT_Y, 0))
  const pivotTarget = useRef(new THREE.Vector3(0, PIVOT_Y, 0))
  // Gruppo attualmente inquadrato (o null): letto da currentFocus() per l'HUD
  // e usato per ri-applicare il focus quando cambiano le inquadrature autorate.
  const focusGroupRef = useRef(null)
  // Override puntuali dell'ULTIMA applyFocus (oggi: quelle autorate in uno step
  // di animazione). Vanno ricordate perché la ri-applicazione al cambio delle
  // inquadrature del FocusTuner deve ripassarle — vedi applyFocus.
  const focusExtraRef = useRef(null)

  // Parametri "feel" della navigazione (sezione `rotation` dello store; la
  // manopola è authoring/RotationTuner.jsx).
  //
  // Due letture, perché ci sono due esigenze diverse:
  //  - `feel` è REATTIVO e serve agli effetti di fit/resize più sotto, che
  //    devono rigirare quando `fitMargin`/`zoomOutMobile` cambiano. Non è un
  //    costo per frame: `useComposerSection` rende solo quando la sezione
  //    cambia davvero, cioè quando un autore muove uno slider.
  //  - `feelRef` è lo specchio letto DENTRO useFrame, dove attraversare React
  //    non ha senso. Stesso idioma di `disabledRef`/`editModeRef` qui accanto.
  const feel = useComposerSection(store, 'rotation')
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

  // --- Zoom di prodotto sui gruppi ("focus") ----------------------------
  // Inquadra un gruppo logico di mesh: sposta il pivot dell'orbita sul suo
  // centro e riduce il raggio quel tanto che serve a contenerne l'estensione.
  // Entrambe le grandezze sono TARGET, smorzati nel useFrame — qui non si
  // scrive mai direttamente la posizione della camera.
  //
  // La misura è EDGE-TRIGGERED (una volta all'ingresso nel focus, al cambio
  // gruppo e al cambio delle inquadrature autorate), mai per-frame: è un
  // traverse completo della scena, come la scatola adattiva del LightRig.
  //
  // `extra` sono override PUNTUALI del chiamante (oggi: uno step `focusGroup`
  // di un'animazione che vuole la propria inquadratura, diversa da quella
  // autorata nel FocusTuner). Si sovrappongono alle override per-gruppo e
  // vengono ricordate in `focusExtraRef`, perché la ri-applicazione qui sotto
  // deve poterle ripassare: senza, muovere uno slider Leva di focus (o un
  // evento `app-load-focus` in arrivo) le scarterebbe in silenzio.
  const applyFocus = (groupId, extra = null) => {
    if (!groupId) return false
    // Stesso guard di goTo: in Mesh la posa è bloccata e il modello può
    // essere deformato dall'editor — non è il momento di re-inquadrare.
    if (editModeRef.current === 'meshes') return false

    const framing = measureGroupFraming(scene, meshGroupsRef.current, groupId)
    if (!framing) return false

    focusExtraRef.current = extra
    const override = { ...(focusOverridesRef.current?.[groupId] ?? {}), ...(extra ?? {}) }
    pivotTarget.current.set(
      framing.center.x + (override.offsetX ?? 0),
      framing.center.y + (override.offsetY ?? 0),
      framing.center.z + (override.offsetZ ?? 0),
    )
    // radius/FIT_HALF_WIDTH = "quanto è più piccolo di ciò che baseRadius
    // inquadra" (vedi FOCUS_ZOOM_MIN/MAX per il perché il rapporto è
    // invariante). Il raggio misurato è quello della SFERA, quindi generoso
    // per costruzione: `radiusFactor` autorato è il modo previsto per
    // stringere l'inquadratura fino a quella di prodotto.
    focusZoomTarget.current = clamp(
      (framing.radius / FIT_HALF_WIDTH) * (override.radiusFactor ?? 1),
      FOCUS_ZOOM_MIN,
      FOCUS_ZOOM_MAX,
    )
    focusGroupRef.current = groupId
    return true
  }

  const clearFocus = () => {
    focusGroupRef.current = null
    focusExtraRef.current = null
    pivotTarget.current.set(0, PIVOT_Y, 0)
    focusZoomTarget.current = 1
  }

  // Le due funzioni sopra si ricreano a ogni render (leggono `scene`, che è una
  // prop): l'effetto dell'API imperativa gira invece UNA VOLTA SOLA (deps
  // [apiRef]) e ne imprigionerebbe la prima versione. Stesso rimedio già usato
  // per disabledRef/editModeRef: una ref aggiornata a ogni render, letta dentro
  // la closure stabile.
  const focusImplRef = useRef(null)
  focusImplRef.current = { applyFocus, clearFocus }

  // Le inquadrature autorate arrivano in modo asincrono (slider Leva in
  // ?debug, o evento `app-load-focus` al caricamento del JSON in produzione):
  // se cambiano mentre un gruppo è già inquadrato, si ri-applica al volo — è
  // ciò che rende gli slider di FocusTuner (Scene.jsx) utilizzabili a video
  // invece che alla cieca.
  useEffect(() => {
    if (focusGroupRef.current) applyFocus(focusGroupRef.current, focusExtraRef.current)
  }, [focusOverrides, scene])

  // Entrando nell'editor mesh la posa si blocca e la geometria può essere
  // spostata: un focus rimasto attivo inquadrerebbe un centro non più valido.
  useEffect(() => {
    if (editMode === 'meshes') clearFocus()
  }, [editMode])

  // API imperativa per la pulsantiera delle viste (ViewPad), che vive nel DOM
  // fuori dal Canvas. `goTo` non è un salto secco come __setPose: imposta il
  // target e lascia animare la STESSA molla del resto (stessa velocità
  // angolare, stesso bounce), e committa la posa così le frecce riprendono da
  // lì senza casi speciali.
  useEffect(() => {
    if (!apiRef) return
    // Object.assign, non riassegnazione: apiRef.current è condiviso con
    // Scene.jsx (che vi pubblica editMode/homePoseKey da fuori del Canvas,
    // senza ordine di commit garantito rispetto a questo effetto) — ogni
    // scrittore deve solo aggiungere/aggiornare i propri campi, mai
    // rimpiazzare l'oggetto intero.
    Object.assign(apiRef.current, {
      goTo(key) {
        const c = poseGraphRef.current.poses[key]
        if (!c) return
        // Lock: in Mesh la navigazione ESTERNA (pulsantiera HUD, o qualunque
        // altro chiamante) resta congelata sulla posa home. L'unica goTo
        // ammessa mentre il lock è attivo è verso la STESSA homePoseKey (è
        // quella che Scene.jsx richiama entrando in Mesh o cambiando la posa
        // home) — qualunque altra richiesta viene ignorata
        // silenziosamente, mai un salto a metà.
        const lockedKey = homePoseKeyRef.current
        const locked = editModeRef.current === 'meshes' && lockedKey != null
        if (locked && key !== lockedKey) return

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
        return poseGraphRef.current.findPoseKey(
          pose.current.pitch,
          pose.current.yaw,
          frame.current.yawOffset,
        )
      },
      // Zoom di prodotto: inquadra un gruppo di mesh (vedi applyFocus).
      // Ritorna false se il gruppo non esiste/è vuoto o se l'editor mesh è
      // attivo, così il chiamante (HUD) può non accendere lo stato attivo.
      // `extra` (opzionale) sovrascrive per questa sola chiamata le
      // inquadrature autorate nel FocusTuner: lo usa il sequencer delle
      // animazioni per dare a uno step la propria distanza/offset.
      focusGroup(groupId, extra = null) {
        return focusImplRef.current.applyFocus(groupId, extra)
      },
      // Torna all'inquadratura d'insieme. Non tocca userZoom: uno zoom a
      // rotella dato in ?debug prima del focus si ritrova intatto all'uscita.
      clearFocus() {
        focusImplRef.current.clearFocus()
      },
      currentFocus() {
        return focusGroupRef.current
      },
      // --- Sonde di "movimento finito" -----------------------------------
      // In questo componente non esiste alcun callback di fine animazione: il
      // sequencer (animation/animationRuntime.js) interroga questi due
      // predicati per sapere quando uno step può considerarsi concluso.
      //
      // La molla SNAPPA esattamente sul target e azzera la velocità quando
      // converge (vedi l'integrazione nel useFrame): qui l'uguaglianza è
      // esatta, non serve alcuna soglia.
      isPoseSettled() {
        const p = pose.current
        const s = spring.current
        const c = curAngles.current
        return c.pitch === p.targetX && c.yaw === p.targetY && s.vx === 0 && s.vy === 0
      },
      // Il focus invece è smorzato in modo asintotico (maath), quindi serve una
      // soglia: assoluta sul pivot (unità-scena), RELATIVA sul fattore di zoom
      // — vedi FOCUS_SETTLE_*.
      isFocusSettled() {
        const zt = focusZoomTarget.current
        return (
          pivotCur.current.distanceToSquared(pivotTarget.current) < FOCUS_SETTLE_DIST_SQ &&
          Math.abs(focusZoom.current.value - zt) < FOCUS_SETTLE_REL * Math.max(zt, 0.05)
        )
      },
    })
    return () => {
      delete apiRef.current.goTo
      delete apiRef.current.currentPoseKey
      delete apiRef.current.focusGroup
      delete apiRef.current.clearFocus
      delete apiRef.current.currentFocus
      delete apiRef.current.isPoseSettled
      delete apiRef.current.isFocusSettled
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
    // Focus da console: serve a trovare i numeri delle inquadrature (e a
    // verificarle su tutte le pose) senza passare dall'HUD.
    //   window.__focusGroup('rotors'); window.__clearFocus()
    window.__focusGroup = (groupId) => focusImplRef.current.applyFocus(groupId)
    window.__clearFocus = () => focusImplRef.current.clearFocus()
    return () => {
      delete window.__setPose
      delete window.__abortComposerDrag
      delete window.__focusGroup
      delete window.__clearFocus
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
      poseGraph.findPoseKey(initialRotation.x, initialRotation.y, 0) != null
        ? 0
        : poseGraph.portraitYawOffset
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
    // Scrive la BASE, non il raggio: lo zoom manuale (userZoom) viene
    // riapplicato sopra da applyRadius() e quindi non si perde nemmeno su
    // resize o al caricamento di un JSON che cambia fitMargin.
    baseRadius.current = clamp(fit, FIT_RADIUS_MIN, RADIUS_MAX)
    applyRadius()
  }, [size, camera, focalLength, feel.fitMargin, feel.zoomOutMobile])

  // Fit dinamico (Luci + posa corrente === posa bloccata): il modello può
  // essere stato deformato in Mesh (gruppi/mesh traslati/ruotati,
  // trasformate cotte nella scena reale da MeshController.jsx) — invece della
  // costante FIT_HALF_WIDTH (tarata sul modello vergine), l'inquadratura usa
  // il Box3 LIVE di `scene`. NIENTE ulteriore moltiplicazione per uno
  // "scale" esterno: a runtime `scene` è già figlio di `<group
  // scale={scale}>` in KeyboardModel.jsx, quindi Box3().setFromObject(scene)
  // restituisce il box in WORLD SPACE — cioè già nelle stesse unità-scena
  // finali di FIT_HALF_WIDTH/TARGET_WIDTH — a differenza dell'auto-fit
  // statico di KeyboardModel.jsx, che calcola il proprio box UNA VOLA SOLA
  // su `scene` ancora senza parent (appena caricato, prima di essere
  // inserito nell'albero), quando è quindi genuinamente "raw"/non scalato:
  // riapplicare `scale` qui raddoppierebbe la scala e collasserebbe
  // l'inquadratura quasi a zero (bug osservato e verificato in Chrome prima
  // di questo fix).
  //
  // SOLO ALLARGAMENTO (nuovo): questo percorso esiste per non tagliare un
  // modello DEFORMATO in Mesh, non per re-inquadrare il modello
  // vergine. Se quel che c'è in scena sta già dentro l'inquadratura corrente
  // non tocca nulla — altrimenti ogni ingresso in modalità Luci riscriveva il
  // raggio e cancellava lo zoom dell'utente (era il reset di zoom "al cambio
  // modalità"). E anche quando allarga, allarga la BASE: userZoom resta.
  const dynamicFitActiveRef = useRef(false)
  const recomputeDynamicFit = () => {
    if (!scene) return
    const box = new THREE.Box3().setFromObject(scene)
    if (box.isEmpty()) return
    const worldSize = box.getSize(new THREE.Vector3())
    const halfWidth = Math.max(worldSize.x, worldSize.z) / 2
    const aspect = size.width / Math.max(size.height, 1)
    const portrait = aspect < 1
    const tanHalfV = Math.tan((camera.fov * Math.PI) / 360)
    let fit = portrait ? halfWidth / tanHalfV : halfWidth / (tanHalfV * aspect)
    fit *= feelRef.current.fitMargin
    if (portrait) fit *= feelRef.current.zoomOutMobile
    const needed = clamp(fit, FIT_RADIUS_MIN, RADIUS_MAX)
    if (needed <= baseRadius.current) return
    baseRadius.current = needed
    applyRadius()
  }

  // Stessi input del fit statico sopra: se un resize (o uno slider
  // fitMargin/zoomOutMobile) arriva MENTRE il fit dinamico è già attivo,
  // questo effetto (dichiarato SUBITO DOPO quello statico, stesso commit)
  // ricalcola col Box3 live e riprende il sopravvento — altrimenti l'effetto
  // statico appena eseguito sopra vincerebbe silenziosamente col valore
  // costante, vanificando il fit dinamico.
  useEffect(() => {
    if (!scene) return
    if (editModeRef.current === 'lights' && dynamicFitActiveRef.current) {
      recomputeDynamicFit()
    }
  }, [size, camera, focalLength, scene, feel.fitMargin, feel.zoomOutMobile])

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
      const target = poseGraphRef.current.stepTo(p.pitch, p.yaw, dir, frame.current.yawOffset)
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
      if (disabledRef.current) return
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

    // NUOVO: API globale per abortire il gesto della camera quando si tocca il Gizmo
    window.__abortComposerDrag = () => {
      if (d.pointerId != null) {
        // Resetta lo stato di movimento e i target alla posa originale
        d.moved = false
        p.targetX = d.pitch0
        p.targetY = d.yaw0
        
        // Rilascia la cattura del puntatore
        if (el.hasPointerCapture(d.pointerId)) {
          try { el.releasePointerCapture(d.pointerId) } catch (err) {}
        }
        
        // Uccide il gesto
        d.pointerId = null
        el.style.cursor = 'grab'
      }
    }

    const onDown = (e) => {
      if (disabledRef.current) return
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
      if (disabledRef.current) return
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
        d.step = poseGraphRef.current.stepTo(d.pitch0, d.yaw0, dir, frame.current.yawOffset)
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

    // LOGICA DI ZOOM (SOLO ?debug) — la rotella è uno strumento di authoring:
    // serve a trovare i fattori di inquadratura che poi si scrivono nel JSON,
    // non è un'interazione di prodotto. In produzione il listener NON viene
    // proprio registrato (vedi addEventListener più sotto): un semplice
    // early-return non basterebbe, perché con `{ passive: false }` +
    // preventDefault si continuerebbe a mangiare lo scroll della pagina che
    // ospita il componente.
    //
    // Dentro ?debug resta indipendente da `disabled`: a differenza di
    // drag/frecce (bloccati in modalità Mesh, vedi Scene.jsx), lo zoom resta
    // attivo in ogni modalità dell'editor. Muove il FATTORE userZoom, non il
    // raggio: è ciò che lo rende immune a ogni ricalcolo del fit (resize,
    // cambio modalità, cambio posa, focus su un gruppo…).
    const onWheel = (e) => {
      e.preventDefault()
      userZoom.current = clamp(userZoom.current * (1 + e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX)
      applyRadius()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerenter', onPointerEnter)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('keydown', onKeyDown)
    if (DEBUG) el.addEventListener('wheel', onWheel, { passive: false }) // ASCOLTO ZOOM (solo authoring)

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
      if (DEBUG) el.removeEventListener('wheel', onWheel) // RIMOZIONE ZOOM
      
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

    // Focus sui gruppi: pivot e fattore di zoom inseguono i propri target con
    // smorzamento maath. Sul delta GREZZO, non su `scaledDelta`: la carrellata
    // ha la sua manopola e non deve cambiare velocità quando si
    // ritocca `timeScale` della rotazione. A riposo (nessun focus attivo) i
    // due valori sono già sui target e queste chiamate sono no-op numerici.
    //
    // ENTRATA e USCITA hanno tempi distinti: avvicinarsi a un gruppo e tornare
    // all'insieme sono due gesti diversi, e l'uscita è quella che si vede alla
    // fine di ogni animazione (dove accompagna la dissolvenza dell'opacità —
    // vedi lo smontaggio morbido in animation/animationRuntime.js). Il verso lo
    // decide `focusGroupRef`: nullo = si sta tornando all'insieme.
    // `?? f.focusDamp`: un JSON salvato prima di questa manopola non la porta,
    // e Leva lascia il default — ma il fallback rende esplicito che l'assenza
    // significa "come l'entrata", non un damping indefinito.
    const focusTime = focusGroupRef.current ? f.focusDamp : (f.focusOutDamp ?? f.focusDamp)
    easing.damp3(pivotCur.current, pivotTarget.current, focusTime, delta)
    easing.damp(focusZoom.current, 'value', focusZoomTarget.current, focusTime, delta)
    // Unico punto che ricompone il raggio: base (fit) × userZoom (rotella,
    // solo debug) × focusZoom (gruppo inquadrato). Nessuno scrive cameraRadius.
    applyRadius()

    // Orbita della telecamera: rotazione inversa perfetta tramite quaternioni
    camera.quaternion.setFromEuler(new THREE.Euler(-cur.pitch, -cur.yaw, 0, 'YXZ'))

    // Posizioniamo la telecamera al raggio corrente, applichiamo la rotazione
    // e la portiamo in orbita attorno al pivot corrente (di default
    // (0, PIVOT_Y, 0) — identico allo storico `position.y += PIVOT_Y`).
    camera.position.set(0, 0, cameraRadius.current)
    camera.position.applyQuaternion(camera.quaternion)
    camera.position.add(pivotCur.current)
  })

  // Edge-detector del fit dinamico (requisito Luci + posa bloccata): la posa
  // vive in ref imperativi, non in state React, quindi il trigger "sono
  // entrato/uscito dalla condizione" va controllato per-frame — ma la
  // ricostruzione vera e propria del Box3 (costosa, O(scena)) gira solo sul
  // fronte di salita, non a ogni frame. useFrame SEPARATO dalla molla sopra:
  // check economico (pochi confronti, nessuna allocazione/traversal) che non
  // deve competere con l'integrazione della molla nello stesso blocco.
  useFrame(() => {
    if (!scene) return
    const mode = editModeRef.current
    const lockedKey = homePoseKeyRef.current
    const curKey =
      mode === 'lights' && lockedKey != null
        ? poseGraphRef.current.findPoseKey(
            pose.current.pitch,
            pose.current.yaw,
            frame.current.yawOffset,
          )
        : null
    const qualifies = mode === 'lights' && lockedKey != null && curKey === lockedKey
    if (qualifies && !dynamicFitActiveRef.current) {
      recomputeDynamicFit()
    }
    dynamicFitActiveRef.current = qualifies
  })
}
