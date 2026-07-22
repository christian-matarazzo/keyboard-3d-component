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
 *  - Colonna centrale yaw 0 (TBACK·TOP·CFT·FRONT·CFB·BOTTOM·BBACK): unica via
 *    allo zenit/nadir. Ai due estremi prosegue di un ultimo step da 45° OLTRE
 *    il Top (TBACK, pitch 135°) e OLTRE il bottom (BBACK, pitch -135°, il
 *    sottoscocca): la colonna è simmetrica. Non sono flip: sono rotazioni
 *    semplici di pitch, il modello non ruota mai su se stesso.
 *  - Banda bassa: anello completo, specchio esatto del centrale (round 11 —
 *    aggiunti i due corner del retro in basso BBL/BBR e l'edge back-basso BBE).
 *    Il back-basso però resta raggiungibile SOLO in orizzontale, mai da BACK con
 *    Giù: la regola "il back non si raggiunge/lascia in verticale" vale ancora.
 */

export const DEG = Math.PI / 180

// Elevazione dei corner ViewCube: vista lungo la diagonale del cubo.
export const CORNER_PITCH = Math.atan(Math.SQRT1_2) // ≈ 35.264°

// Le 18 pose raggiungibili, con coordinate canoniche (yaw ridotto in
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
  // Speculare esatta di TBACK sotto l'orizzonte: 45° OLTRE il bottom, vista
  // del sottoscocca (piastra inferiore + piedini). Non è nel rig set — è una
  // posa aggiunta dal cliente al round 10, confermata a riferimento Maya.
  BBACK: { pitch: -135 * DEG, yaw: 0 }, // 3-4 back bottom
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
  // Retro-basso: le tre viste dell'underside da dietro, aggiunte dal cliente
  // (round 11, screenshot Maya in NewPoses/). Completano la banda bassa perché
  // sia lo specchio esatto dell'anello centrale (BBE = mirror di CFB dietro).
  BBL: { pitch: -CORNER_PITCH, yaw: 135 * DEG }, // 3-4 back left bottom
  BBR: { pitch: -CORNER_PITCH, yaw: -135 * DEG }, // 3-4 back right bottom
  BBE: { pitch: -45 * DEG, yaw: 180 * DEG }, // back bottom (edge, specchio di CFB)
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
 *  - basso:   CFB(0) ↔ BFL(45) ↔ BBL(135) ↔ BBE(180) ↔ BBR(-135) ↔ BFR(-45)
 *    ↔ CFB — anello pieno, specchio esatto del centrale (BBE sta al back-basso
 *    come FRONT/BACK al centro). I 90° sui fianchi puri restano (BFL↔BBL,
 *    BFR↔BBR) come CFL↔CBL / CFR↔CBR sopra.
 * Colonne verticali (up = +pitch), a yaw costante:
 *  - yaw 0:  TBACK ↔ TOP ↔ CFT ↔ FRONT ↔ CFB ↔ BOTTOM ↔ BBACK — simmetrica:
 *    agli estremi prosegue di un ultimo 45° oltre lo zenit (TBACK) e oltre il
 *    nadir (BBACK, il sottoscocca), mai un flip
 *  - yaw ±45 fronte: T? ↔ C?L/R ↔ B?L/R (i corner alti/bassi frontali)
 *  - yaw ±135 retro: T? ↔ C? ↔ B? (alto↔centro↔basso; i corner del retro basso
 *    BBL/BBR si raggiungono scendendo da CBL/CBR — ma BACK/BBE non sono
 *    collegati in verticale: il back-basso è solo un anello orizzontale)
 */
export const NEIGHBORS = {
  TBACK: { up: null, down: 'TOP', left: null, right: null },
  TOP: { up: 'TBACK', down: 'CFT', left: null, right: null },
  CFT: { up: 'TOP', down: 'FRONT', left: 'TL', right: 'TR' },
  FRONT: { up: 'CFT', down: 'CFB', left: 'CFL', right: 'CFR' },
  CFB: { up: 'FRONT', down: 'BOTTOM', left: 'BFL', right: 'BFR' },
  BOTTOM: { up: 'CFB', down: 'BBACK', left: null, right: null },
  BBACK: { up: 'BOTTOM', down: null, left: null, right: null },
  TL: { up: null, down: 'CFL', left: 'TBL', right: 'CFT' },
  TR: { up: null, down: 'CFR', left: 'CFT', right: 'TBR' },
  TBL: { up: null, down: 'CBL', left: 'TBR', right: 'TL' },
  TBR: { up: null, down: 'CBR', left: 'TR', right: 'TBL' },
  CFL: { up: 'TL', down: 'BFL', left: 'CBL', right: 'FRONT' },
  CFR: { up: 'TR', down: 'BFR', left: 'FRONT', right: 'CBR' },
  CBL: { up: 'TBL', down: 'BBL', left: 'BACK', right: 'CFL' },
  CBR: { up: 'TBR', down: 'BBR', left: 'CFR', right: 'BACK' },
  // Su/giù bloccati: il back non si raggiunge né si lascia in verticale
  // (regola cliente) — solo l'anello orizzontale lo attraversa. Vale anche per
  // BBE (back-basso): ci si arriva solo in orizzontale, mai da BACK con Giù.
  BACK: { up: null, down: null, left: 'CBR', right: 'CBL' },
  BFL: { up: 'CFL', down: null, left: 'BBL', right: 'CFB' },
  BFR: { up: 'CFR', down: null, left: 'CFB', right: 'BBR' },
  // Anello basso completo (specchio del centrale): BBL/BBR scendono dai corner
  // del retro (CBL/CBR), BBE è raggiungibile solo lateralmente.
  BBL: { up: 'CBL', down: null, left: 'BBE', right: 'BFL' },
  BBR: { up: 'CBR', down: null, left: 'BFR', right: 'BBE' },
  BBE: { up: null, down: null, left: 'BBR', right: 'BBL' },
}

/**
 * Viste della pulsantiera (ViewPad): le 4 pose che il cliente vuole a un
 * click, con la freccetta che le richiama. Sono SCORCIATOIE — saltano
 * direttamente alla posa, senza percorrere il grafo passo-passo come fanno
 * le frecce della tastiera — ma restano pose del grafo, quindi da lì la
 * navigazione normale riprende senza casi speciali.
 */
export const VIEW_SHORTCUTS = {
  up: 'TOP', // vista dall'alto piena
  left: 'TL', // 3/4 sinistro ("initial position")
  right: 'TR', // 3/4 destro ("3-4 front right")
  down: 'BOTTOM', // sottoscocca piatto
}

/**
 * Selettore vista dell'HUD di prodotto: la paginazione `01–05` sopra la
 * tastiera (rimpiazza le frecce ViewPad). Ordine = ordine dei numeri. La `04`
 * = `TL` (initial position, 3/4 front) è la posa d'ingresso landscape, quindi
 * al caricamento è la voce attiva — riproduce lo screen del cliente 1:1.
 * Restano pose del grafo: da qui la navigazione a drag/tastiera riprende
 * senza casi speciali. Facilmente riordinabile su richiesta del cliente.
 */
export const HUD_VIEWS = ['TOP', 'CFT', 'FRONT', 'TL', 'BOTTOM']

/**
 * Etichette brevi per l'HUD (readout alto-centro "3/4 FT"): chiave posa →
 * label maiuscola. Fallback = la chiave stessa se non elencata.
 */
export const POSE_HUD_LABEL = {
  TBACK: '3/4 BK',
  TOP: 'TOP',
  CFT: '3/4 TP',
  FRONT: 'FRONT',
  CFB: '3/4 FT',
  BOTTOM: 'BOTTOM',
  BBACK: '3/4 BK',
  TL: '3/4 FT',
  TR: '3/4 FT',
  TBL: '3/4 BK',
  TBR: '3/4 BK',
  CFL: '3/4 L',
  CFR: '3/4 R',
  CBL: '3/4 BL',
  CBR: '3/4 BR',
  BACK: 'BACK',
  BFL: '3/4 FL',
  BFR: '3/4 FR',
  BBL: '3/4 BL',
  BBR: '3/4 BR',
  BBE: 'BACK',
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
