import { CORNER_PITCH, DEG } from '../../poseGraph'

/**
 * Pose navigabili di ARRAY_MODEL_L (round 10/11) — DATI, non macchina: la
 * fabbrica che li rende un grafo sta in `poseGraph.js`, questo file è solo il
 * contratto autorato con il cliente per QUESTO modello.
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

// Le 21 pose raggiungibili, con coordinate canoniche (yaw ridotto in
// (-180°, 180°]). Le chiavi brevi sono il contratto interno del grafo; fra
// parentesi il nome del file JPEG del rig set (contratto visivo col cliente).
export const ARRAY_MODEL_L_POSES = {
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
export const ARRAY_MODEL_L_NEIGHBORS = {
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

/*
 * `HUD_VIEWS` (le 5 pose della paginazione `01–05`) è stato RIMOSSO insieme al
 * pager dell'HUD: in prodotto le pose non si scelgono più da un pulsante, le
 * porta un'animazione autorata (vedi Hud.jsx). Stessa fine di
 * `VIEW_SHORTCUTS`, la mappa direzione→posa del vecchio ViewPad — non
 * reintrodurli.
 */

/**
 * Etichette brevi per l'HUD (readout alto-centro "3/4 FT"): chiave posa →
 * label maiuscola. Fallback = la chiave stessa se non elencata.
 */
export const ARRAY_MODEL_L_POSE_LABELS = {
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

/**
 * Descrizione completa del grafo, pronta per `createPoseGraph`.
 *
 * Pose d'ingresso: landscape = corner "initial position" (TL); portrait =
 * vista top con l'asse lungo verticale a schermo (pitch 90 + yaw 90). In
 * portrait TUTTO il grafo è ruotato di +90° in yaw per il fit su schermo
 * alto: la navigazione applica quell'offset (`portraitYawOffset`) così il
 * grafo resta identico, solo traslato. La posa d'ingresso portrait è quindi
 * TOP vista attraverso l'offset.
 */
export const ARRAY_MODEL_L_POSE_GRAPH = {
  id: 'ARRAY_MODEL_L',
  poses: ARRAY_MODEL_L_POSES,
  neighbors: ARRAY_MODEL_L_NEIGHBORS,
  labels: ARRAY_MODEL_L_POSE_LABELS,
  entryLandscape: { x: CORNER_PITCH, y: 45 * DEG },
  entryPortrait: { x: 90 * DEG, y: 90 * DEG },
  portraitYawOffset: 90 * DEG,
}
