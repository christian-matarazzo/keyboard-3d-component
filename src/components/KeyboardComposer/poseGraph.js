/**
 * Grafo delle pose — navigazione a vicini espliciti (round 10).
 *
 * Convenzione ViewCube di Maya (il cliente lavora in Maya): facce a 0°/90°,
 * spigoli a 45°, angoli (i "3/4") guardando lungo la diagonale del cubo, cioè
 * elevazione atan(1/√2) ≈ 35.264° con azimut ±45°/±135°.
 *
 * Nel nostro schema è il MODELLO a ruotare (camera fissa e livellata):
 * rotation.x = pitch, rotation.y = yaw (Euler 'XYZ'); yaw positivo porta il
 * lato sinistro della tastiera verso la camera.
 *
 * A differenza dei round precedenti (archi di stop separati per pitch/yaw +
 * un meccanismo di "flip" tra corner gemelli) qui la navigazione è un GRAFO
 * DI ADIACENZA esplicito: ogni posa ha al più un vicino per direzione
 * (`up`/`down`/`left`/`right`) e uno step è semplicemente "vai a quella posa".
 * Questo mappa 1:1 il modello mentale del cliente ("da posa X, freccia Y →
 * posa Z"), vieta per costruzione qualunque flip (uno step è un vicino
 * nominato o niente) e rende le frecce letterali.
 *
 * Regole del round 10 (confermate dal cliente):
 *  - LEFT = yaw crescente, RIGHT = yaw calante, UP = pitch crescente (verso il
 *    top), DOWN = pitch calante (verso il basso).
 *  - Sui 3/4 (corner) left/right ruotano di 90° saltando la vista laterale
 *    pura (yaw ±90°), che esce dalla navigazione. Il back piatto (yaw 180°)
 *    invece resta, simmetrico al front sull'anello centrale.
 *  - Colonna centrale yaw 0 (TBACK·TOP·CFT·FRONT·CFB·BOTTOM): unica via allo
 *    zenit/nadir. In cima la colonna prosegue di un ultimo step da 45° OLTRE
 *    il Top, fino a "3-4 back" (pitch 135°). Non è un flip: è una rotazione
 *    semplice di pitch, il modello non ruota mai su se stesso.
 *  - Banda bassa: solo i corner frontali (niente corner del retro in basso).
 */

export const DEG = Math.PI / 180

// Elevazione dei corner ViewCube: vista lungo la diagonale del cubo.
export const CORNER_PITCH = Math.atan(Math.SQRT1_2) // ≈ 35.264°

// Le 17 pose raggiungibili, con coordinate canoniche (yaw ridotto in
// (-180°, 180°]). Le chiavi brevi sono il contratto interno del grafo; fra
// parentesi il nome del file JPEG del rig set (contratto visivo col cliente).
export const POSE_COORD = {
  // 3-4 back: 45° OLTRE il Top, rotazione SEMPLICE di pitch (nessuno spin del
  // modello su se stesso — quello fu respinto al round 7). Il JPEG del rig set
  // omonimo mostra la tastiera capovolta perché lì la vista da dietro è
  // "raddrizzata" con mezzo giro: NON è il nostro contratto, il cliente ha
  // confermato per screenshot questa posa (spacebar in basso, lamelle in alto).
  TBACK: { pitch: 135 * DEG, yaw: 0 }, // 3-4 back
  TOP: { pitch: 90 * DEG, yaw: 0 }, // Top
  CFT: { pitch: 45 * DEG, yaw: 0 }, // 3-4 top
  FRONT: { pitch: 0, yaw: 0 }, // front
  CFB: { pitch: -45 * DEG, yaw: 0 }, // 3-4 front
  BOTTOM: { pitch: -90 * DEG, yaw: 0 }, // bottom
  TL: { pitch: CORNER_PITCH, yaw: 45 * DEG }, // initial position (3-4 front left)
  TR: { pitch: CORNER_PITCH, yaw: -45 * DEG }, // 3-4 front right
  TBL: { pitch: CORNER_PITCH, yaw: 135 * DEG }, // 3-4 back left
  TBR: { pitch: CORNER_PITCH, yaw: -135 * DEG }, // 3-4 back right
  CFL: { pitch: 0, yaw: 45 * DEG }, // 3-4 left
  CFR: { pitch: 0, yaw: -45 * DEG }, // 3-4 right
  CBL: { pitch: 0, yaw: 135 * DEG }, // 3-4-left back
  CBR: { pitch: 0, yaw: -135 * DEG }, // 3-4 right-back
  // back: elevazione posteriore, simmetrica al front sull'anello centrale
  // (sliver sottile con la camera livellata — è corretto così).
  BACK: { pitch: 0, yaw: 180 * DEG }, // back
  BFL: { pitch: -CORNER_PITCH, yaw: 45 * DEG }, // 3-4 front left bottom
  BFR: { pitch: -CORNER_PITCH, yaw: -45 * DEG }, // 3-4 front right bottom
}

/**
 * Vicini per direzione. `null` = nessuna posa in quella direzione: lì il
 * gesto trova solo la resistenza elastica (drag) o non committa (freccia).
 *
 * Anelli orizzontali (left = +yaw, right = -yaw), un giro per banda:
 *  - alto:   CFT(0) ↔ TL(45) ↔ TBL(135) ↔ TBR(-135) ↔ TR(-45) ↔ CFT
 *  - centro: FRONT(0) ↔ CFL(45) ↔ CBL(135) ↔ BACK(180) ↔ CBR(-135) ↔ CFR(-45)
 *    ↔ FRONT — BACK sta a 45° dai due corner del retro esattamente come FRONT
 *    dai due corner frontali: l'anello è simmetrico fronte/retro. I 90° dei
 *    3/4 restano dove non c'è una posa intermedia (i salti sui fianchi puri).
 *  - basso:  arco BFR(-45) ↔ CFB(0) ↔ BFL(45) (niente corner retro in basso)
 * Colonne verticali (up = +pitch), a yaw costante:
 *  - yaw 0:  TBACK ↔ TOP ↔ CFT ↔ FRONT ↔ CFB ↔ BOTTOM
 *  - yaw ±45 fronte: T? ↔ C?L/R ↔ B?L/R (i corner alti/bassi frontali)
 *  - yaw ±135 retro: T?  ↔ C?  (solo alto↔centro; niente back in basso)
 */
export const NEIGHBORS = {
  TBACK: { up: null, down: 'TOP', left: null, right: null },
  TOP: { up: 'TBACK', down: 'CFT', left: null, right: null },
  CFT: { up: 'TOP', down: 'FRONT', left: 'TL', right: 'TR' },
  FRONT: { up: 'CFT', down: 'CFB', left: 'CFL', right: 'CFR' },
  CFB: { up: 'FRONT', down: 'BOTTOM', left: 'BFL', right: 'BFR' },
  BOTTOM: { up: 'CFB', down: null, left: null, right: null },
  TL: { up: null, down: 'CFL', left: 'TBL', right: 'CFT' },
  TR: { up: null, down: 'CFR', left: 'CFT', right: 'TBR' },
  TBL: { up: null, down: 'CBL', left: 'TBR', right: 'TL' },
  TBR: { up: null, down: 'CBR', left: 'TR', right: 'TBL' },
  CFL: { up: 'TL', down: 'BFL', left: 'CBL', right: 'FRONT' },
  CFR: { up: 'TR', down: 'BFR', left: 'FRONT', right: 'CBR' },
  CBL: { up: 'TBL', down: null, left: 'BACK', right: 'CFL' },
  CBR: { up: 'TBR', down: null, left: 'CFR', right: 'BACK' },
  // Su/giù bloccati: il back non si raggiunge né si lascia in verticale
  // (regola cliente) — solo l'anello orizzontale lo attraversa.
  BACK: { up: null, down: null, left: 'CBR', right: 'CBL' },
  BFL: { up: 'CFL', down: null, left: null, right: 'CFB' },
  BFR: { up: 'CFR', down: null, left: 'CFB', right: null },
}

// Pose d'ingresso: landscape = corner "initial position" (TL); portrait =
// vista top con l'asse lungo verticale a schermo (pitch 90 + yaw 90). In
// portrait TUTTO il grafo è ruotato di +90° in yaw per il fit su schermo
// alto: la navigazione applica quell'offset (vedi PORTRAIT_YAW_OFFSET) così
// il grafo resta identico, solo traslato. La posa d'ingresso portrait è
// quindi TOP viste attraverso l'offset.
export const ENTRY_LANDSCAPE = { x: CORNER_PITCH, y: 45 * DEG }
export const ENTRY_PORTRAIT = { x: 90 * DEG, y: 90 * DEG }
export const PORTRAIT_YAW_OFFSET = 90 * DEG

const EPS_ANGLE = 1e-3
export const nearAngle = (a, b) => Math.abs(a - b) < EPS_ANGLE

// Riduce lo yaw a (-180°, 180°]: lo yaw grezzo del modello può accumulare più
// giri (il loop orizzontale non normalizza mai, vedi stepTo), ma il
// riconoscimento della posa lavora sempre sul valore ridotto. Serve anche a
// scegliere il percorso più breve fra due corner del retro (±135°): il loro
// delta canonico "lungo" è ±270°, che wrapYaw riduce a ∓90° — il giro breve
// attraverso il back, non quello attraverso il fronte.
// L'intervallo è semi-aperto per davvero: −180° va riportato a +180°, non lasciato
// com'è. La posa `back` è canonicamente a +180° ma ci si arriva a −180° venendo
// da CBR (−135° − 45°): senza questa riduzione `findPoseKey` non la
// riconoscerebbe (|−180 − 180| = 360) e la navigazione morirebbe sul back
// arrivandoci da destra. La soglia è quindi `<= −180 + EPS`, non `−180 − EPS`.
const TAU = 360 * DEG
export const wrapYaw = (yaw) => {
  let w = yaw % TAU
  if (w > 180 * DEG + EPS_ANGLE) w -= TAU
  else if (w <= -180 * DEG + EPS_ANGLE) w += TAU
  return w
}

// Chiave della posa canonica a (pitch, yaw). `yawOffset` sottrae la
// traslazione di banda (portrait): la coordinata grezza del modello meno
// l'offset ricade sulle coordinate canoniche del grafo.
export function findPoseKey(pitch, yaw, yawOffset = 0) {
  const y = wrapYaw(yaw - yawOffset)
  for (const key in POSE_COORD) {
    const c = POSE_COORD[key]
    if (nearAngle(c.pitch, pitch) && nearAngle(c.yaw, y)) return key
  }
  return null
}

/**
 * Target dello step da (pitch, yaw) nella direzione `dir`
 * ('up'|'down'|'left'|'right'), oppure `null` se non si è su una posa nota o
 * il vicino in quella direzione non esiste (estremo: solo elastico).
 *
 * Lo yaw restituito è relativo al valore GREZZO passato (yaw + delta più
 * breve), non lo yaw canonico assoluto del vicino: dopo N giri completi lo
 * yaw grezzo può essere lontano dal canonico, e agganciarsi ad esso
 * produrrebbe un salto di N giri invece del solo step richiesto. Il pitch
 * invece non fa mai il giro, quindi resta il valore canonico assoluto.
 */
export function stepTo(pitch, yaw, dir, yawOffset = 0) {
  const key = findPoseKey(pitch, yaw, yawOffset)
  if (!key) return null
  const nextKey = NEIGHBORS[key][dir]
  if (!nextKey) return null
  const cur = POSE_COORD[key]
  const target = POSE_COORD[nextKey]
  const delta = wrapYaw(target.yaw - cur.yaw)
  return { pitch: target.pitch, yaw: yaw + delta }
}
