/**
 * Grafo delle pose — mappatura 1:1 con i riferimenti del cliente in `rig set/`.
 *
 * Convenzione ViewCube di Maya (il cliente lavora in Maya): facce a 0°/90°,
 * spigoli a 45°, angoli guardando lungo la diagonale del cubo, cioè
 * elevazione atan(1/√2) ≈ 35.264° con azimut ±45°.
 *
 * Nel nostro schema è il MODELLO a ruotare (camera fissa e livellata):
 * rotation.x = pitch, rotation.y = yaw (Euler 'XYZ'); yaw positivo porta il
 * lato sinistro della tastiera verso la camera.
 *
 * A differenza della vecchia griglia uniforme (multipli di 45° su un toro
 * completo), qui esistono SOLO le pose richieste dal cliente (i JPEG del rig
 * set + le due aggiunte a voce del round 7): gli archi sono clampati e oltre
 * l'ultima posa il gesto incontra solo la resistenza elastica (vedi
 * useComposerControls). Ogni step è una rotazione semplice di 45° sul
 * proprio asse — nessun flip/spin composto.
 */

export const DEG = Math.PI / 180

// Elevazione dei corner ViewCube: vista lungo la diagonale del cubo.
export const CORNER_PITCH = Math.atan(Math.SQRT1_2) // ≈ 35.264°

// Tabella di riferimento nominata come i file JPEG (per confronto visivo e
// tooling di verifica). Non è usata a runtime dal gesto — il gesto naviga
// gli archi qui sotto — ma ogni valore è il contratto con il cliente.
export const POSES = {
  'initial position': { pitch: CORNER_PITCH, yaw: 45 * DEG },
  '3-4 front right': { pitch: CORNER_PITCH, yaw: -45 * DEG },
  // Round 9 (cartella "TASTIERA 3-4"): i due corner ALTI mancanti sul retro,
  // gemelli di 'initial position'/'3-4 front right' ma a yaw ±135°.
  '3-4 back left': { pitch: CORNER_PITCH, yaw: 135 * DEG },
  '3-4 back right': { pitch: CORNER_PITCH, yaw: -135 * DEG },
  // Round 9: i quattro corner BASSI (elevazione -CORNER_PITCH, verso il
  // bottom), uno per ciascuna delle quattro colonne fronte/retro × sx/dx.
  '3-4 front left bottom': { pitch: -CORNER_PITCH, yaw: 45 * DEG },
  '3-4 front right bottom': { pitch: -CORNER_PITCH, yaw: -45 * DEG },
  '3-4 back left bottom': { pitch: -CORNER_PITCH, yaw: 135 * DEG },
  '3-4 back right bottom': { pitch: -CORNER_PITCH, yaw: -135 * DEG },
  Top: { pitch: 90 * DEG, yaw: 0 },
  '3-4 top': { pitch: 45 * DEG, yaw: 0 },
  front: { pitch: 0, yaw: 0 },
  '3-4 front': { pitch: -45 * DEG, yaw: 0 },
  bottom: { pitch: -90 * DEG, yaw: 0 },
  // Round 7: rotazione SEMPLICE di 45° oltre Top ("ogni rotazione deve avere
  // i suoi 45 gradi") — niente flip alla ViewCube verso la vista da dietro
  // dritta: lo snap che "ruotava la tastiera su se stessa" è stato respinto.
  '3-4 back': { pitch: 135 * DEG, yaw: 0 },
  // Round 7, pose mancanti dal rig set (segnalate dal cliente a voce):
  // scocca del retro rivolta alla camera, in coda all'anello orizzontale...
  back: { pitch: 0, yaw: 180 * DEG },
  // ...e vista laterale dall'alto: mini-arco verticale sulle viste left/right.
  'alto laterale left': { pitch: 45 * DEG, yaw: 90 * DEG },
  'alto laterale right': { pitch: 45 * DEG, yaw: -90 * DEG },
  '3-4 left': { pitch: 0, yaw: 45 * DEG },
  left: { pitch: 0, yaw: 90 * DEG },
  '3-4-left back': { pitch: 0, yaw: 135 * DEG },
  '3-4 right': { pitch: 0, yaw: -45 * DEG },
  right: { pitch: 0, yaw: -90 * DEG },
  '3-4 right-back': { pitch: 0, yaw: -135 * DEG },
}

// Arco verticale principale: bottom → 3-4 front → front → 3-4 top → Top →
// 3-4 back. Ogni step è una rotazione SEMPLICE di 45° attorno all'asse
// orizzontale (round 7: il flip alla ViewCube oltre lo zenit è respinto).
// Nessun wrap oltre 135°.
const PITCH_ARC_MAIN = [-90, -45, 0, 45, 90, 135].map((d) => d * DEG)
// Alle viste laterali pure (yaw ±90°) uno step da 45° sale alla "vista
// laterale dall'alto" (round 7, mancava dal rig set).
const PITCH_ARC_SIDE = [0, 45 * DEG]
// Altrove il pitch non ha pose: il drag verticale trova solo l'elastico.
const PITCH_LOCKED = [0]

// Arco orizzontale (sbloccato solo a pitch 0): fino a ±180° — la "scocca del
// back frontale" (round 7) chiude l'anello su entrambi i lati; oltre, elastico.
export const YAW_STOPS = [-180, -135, -90, -45, 0, 45, 90, 135, 180].map(
  (d) => d * DEG,
)

// Pose d'ingresso: landscape = corner "initial position"; portrait = vista
// top ruotata a schermo (pitch 90 + yaw 90, comportamento già in produzione).
export const ENTRY_LANDSCAPE = { x: CORNER_PITCH, y: 45 * DEG }
export const ENTRY_PORTRAIT = { x: 90 * DEG, y: 90 * DEG }

const EPS_ANGLE = 1e-3
const nearAngle = (a, b) => Math.abs(a - b) < EPS_ANGLE

// Dopo un giro (o più) oltre ±180° (vedi `nextYawStop`) lo yaw grezzo non è
// più uno dei valori "canonici" (0°, ±45°, ±90°...) su cui si riconoscono le
// pose verticali, anche se visivamente il modello è tornato nella stessa
// posa: 405° "è" 45° dopo un giro intero. Chi deve riconoscere QUALE arco
// verticale si applica (pitchStopsAt, CORNER_ARC) lavora quindi sempre sullo
// yaw ridotto a (-180°, 180°] — mai sul valore grezzo, che invece resta
// intatto per la navigazione dell'anello orizzontale (nextYawStop).
const TAU = 360 * DEG
const wrapYaw = (yaw) => {
  let w = yaw % TAU
  if (w > 180 * DEG + EPS_ANGLE) w -= TAU
  else if (w <= -180 * DEG - EPS_ANGLE) w += TAU
  return w
}

/**
 * Stop di pitch disponibili allo yaw corrente. In portrait l'arco principale
 * vive anche sull'asse d'ingresso (yaw 90°), così il flusso verticale parte
 * dalla posa top verticale esattamente come oggi.
 */
export function pitchStopsAt(yaw, portrait = false) {
  const y = wrapYaw(yaw)
  if (nearAngle(y, 0)) return PITCH_ARC_MAIN
  if (portrait && nearAngle(y, 90 * DEG)) return PITCH_ARC_MAIN
  if (nearAngle(Math.abs(y), 90 * DEG)) return PITCH_ARC_SIDE
  // yaw ±45°/±135°: il verticale vive interamente sui CORNER_ARCS (vedi
  // sotto), interrogati PRIMA di questa funzione da chi guida il gesto —
  // qui non c'è altro stop di pitch puro.
  return PITCH_LOCKED
}

/**
 * Prossimo stop dell'arco oltre `value` nella direzione `dir` (±1), oppure
 * null all'estremo: lì il gesto incontra solo la resistenza elastica.
 * Funziona anche partendo fuori-stop (confronto strettamente oltre value).
 */
export function adjacentStop(stops, value, dir) {
  if (dir > 0) {
    for (const s of stops) if (s > value + EPS_ANGLE) return s
    return null
  }
  for (let i = stops.length - 1; i >= 0; i--)
    if (stops[i] < value - EPS_ANGLE) return stops[i]
  return null
}

/**
 * Archi verticali delle pose corner: quattro colonne — fronte (yaw ±45°) e
 * retro (yaw ±135°), ciascuna con un corner ALTO (+CORNER_PITCH, verso Top)
 * e uno BASSO (-CORNER_PITCH, verso il bottom). Ogni arco è una sequenza
 * continua di 4 tappe A→B→C→D, l'unico punto del grafo dove un singolo step
 * cambia SIA pitch SIA yaw insieme (B↔C, il giro sull'altro lato) —
 * rappresenta visivamente un giro continuo sul case, non una posa diagonale
 * fuori contratto. Giù avanza (dir +1), su retrocede (dir -1), sempre. Gli
 * estremi A/D di ogni arco sono gli anelli orizzontali (pitch 0): FRONT_TOP
 * e FRONT_BOTTOM condividono gli stessi due estremi (3-4 left/3-4 right) ma
 * sui lati liberi opposti (3-4 left aveva già il suo "giù" occupato da
 * FRONT_TOP verso l'alto, quindi FRONT_BOTTOM lo raggiunge dal "su" libero,
 * e viceversa per 3-4 right) — mai un conflitto, ciascuna posa ha sempre e
 * solo un vicino per direzione. Stesso schema per il retro.
 */
const FRONT_TOP_ARC = [
  { pitch: 0, yaw: 45 * DEG }, // 3-4 left
  { pitch: CORNER_PITCH, yaw: 45 * DEG }, // 3-4 front left ("initial position")
  { pitch: CORNER_PITCH, yaw: -45 * DEG }, // 3-4 front right
  { pitch: 0, yaw: -45 * DEG }, // 3-4 right
]
const BACK_TOP_ARC = [
  { pitch: 0, yaw: 135 * DEG }, // 3-4-left back
  { pitch: CORNER_PITCH, yaw: 135 * DEG }, // 3-4 back left
  { pitch: CORNER_PITCH, yaw: -135 * DEG }, // 3-4 back right
  { pitch: 0, yaw: -135 * DEG }, // 3-4 right-back
]
// Estremi in ordine inverso rispetto a FRONT_TOP_ARC (parte da 3-4 right,
// non da 3-4 left): è il lato libero di ciascun estremo a decidere l'ordine,
// non una convenzione arbitraria — vedi commento sopra.
const FRONT_BOTTOM_ARC = [
  { pitch: 0, yaw: -45 * DEG }, // 3-4 right
  { pitch: -CORNER_PITCH, yaw: -45 * DEG }, // 3-4 front right bottom
  { pitch: -CORNER_PITCH, yaw: 45 * DEG }, // 3-4 front left bottom
  { pitch: 0, yaw: 45 * DEG }, // 3-4 left
]
const BACK_BOTTOM_ARC = [
  { pitch: 0, yaw: -135 * DEG }, // 3-4 right-back
  { pitch: -CORNER_PITCH, yaw: -135 * DEG }, // 3-4 back right bottom
  { pitch: -CORNER_PITCH, yaw: 135 * DEG }, // 3-4 back left bottom
  { pitch: 0, yaw: 135 * DEG }, // 3-4-left back
]
const CORNER_ARCS = [FRONT_TOP_ARC, BACK_TOP_ARC, FRONT_BOTTOM_ARC, BACK_BOTTOM_ARC]

/**
 * Prossima tappa nella direzione `dir` a partire da (pitch, yaw), cercando
 * fra tutti gli archi corner (ciascuna posa vive in al più un arco per
 * ciascuna direzione, mai in conflitto — vedi commento sopra), oppure null
 * se non si è su una tappa di alcun arco o si è già all'estremo (lì il
 * gesto trova solo l'elastico, come gli altri archi). Lo yaw restituito è
 * relativo al valore grezzo passato (yaw + delta canonico), non lo stop
 * canonico assoluto: dopo N giri completi lo yaw grezzo può essere molto
 * lontano dal valore canonico, e "agganciarsi" ad esso produrrebbe un salto
 * visivo di N giri interi invece del solo step richiesto.
 */
export function cornerArcStep(pitch, yaw, dir) {
  const y = wrapYaw(yaw)
  for (const arc of CORNER_ARCS) {
    const i = arc.findIndex(
      (p) => nearAngle(p.pitch, pitch) && nearAngle(p.yaw, y),
    )
    if (i === -1) continue
    const j = i + (dir > 0 ? 1 : -1)
    if (j < 0 || j >= arc.length) continue
    // Delta normalizzato al percorso più breve: sugli archi del retro la
    // differenza fra i valori canonici dei corner gemelli (±135°) è ±270°
    // — il giro lungo passando dal fronte. Il flip deve invece attraversare
    // il retro con gli stessi 90° dell'arco frontale: wrapYaw riduce -270°
    // a +90° (e viceversa), lasciando intatti i delta già brevi.
    const delta = wrapYaw(arc[j].yaw - arc[i].yaw)
    return { pitch: arc[j].pitch, yaw: yaw + delta }
  }
  return null
}

// Passo di 45° sull'arco yaw, ma senza mai fermarsi al "back" (±180°): oltre
// l'ultimo stop nominale il valore continua a crescere/calare di 45° a
// oltranza, non normalizzato — permette di completare un giro intero (e
// oltre, in loop) proseguendo nella stessa direzione dal back a destra o a
// sinistra, invece di trovare solo l'elastico come per gli altri estremi.
export function nextYawStop(value, dir) {
  // Oltre ±180° (già in "giro libero", vedi sopra) `adjacentStop` non va
  // bene: la sua ricerca all'indietro trova il primo stop nominale minore
  // del valore corrente (es. 180°) e vi "risucchia" il giro anche quando la
  // direzione richiesta è quella opposta — un singolo step tornerebbe
  // indietro di più di 45° invece di proseguire di un solo passo. Fuori da
  // ±180° si resta quindi SEMPRE sul passo libero, in entrambe le direzioni.
  if (Math.abs(value) > 180 * DEG + EPS_ANGLE) return value + dir * 45 * DEG
  const stop = adjacentStop(YAW_STOPS, value, dir)
  if (stop != null) return stop
  return value + dir * 45 * DEG
}
