/**
 * GRAFO DELLE POSE — la macchina, non i dati.
 *
 * Questo file non conosce nessun modello: contiene le primitive angolari
 * (product-independent) e la FABBRICA `createPoseGraph`, che prende la
 * descrizione delle pose di un prodotto e ne restituisce un grafo navigabile.
 * Le pose vere di ARRAY_MODEL_L vivono in `products/arrayModelL/poseGraph.js`,
 * e ogni prodotto nuovo porta le proprie — vedi `products/productSchema.js`.
 *
 * La separazione non è cosmesi: `POSE_COORD`/`NEIGHBORS` erano costanti di
 * modulo importate staticamente da cinque file, quindi un secondo modello
 * avrebbe potuto solo SOSTITUIRE il primo, mai affiancarlo. Ora il grafo è un
 * oggetto che scende come prop (dentro `product`), esattamente come
 * `meshGroups`/`meshVariants` facevano già.
 *
 * ── Il contratto che ogni prodotto deve rispettare ─────────────────────────
 * Convenzione ViewCube di Maya (il cliente lavora in Maya): facce a 0°/90°,
 * spigoli a 45°, angoli (i "3/4") guardando lungo la diagonale del cubo, cioè
 * elevazione atan(1/√2) ≈ 35.264° con azimut ±45°/±135°.
 *
 * Nel nostro schema è il MODELLO a ruotare (camera fissa e livellata):
 * rotation.x = pitch, rotation.y = yaw (Euler 'XYZ'); yaw positivo porta il
 * lato sinistro del modello verso la camera.
 *
 * La navigazione è un GRAFO DI ADIACENZA esplicito: ogni posa ha al più un
 * vicino per direzione (`up`/`down`/`left`/`right`) e uno step è semplicemente
 * "vai a quella posa". Questo mappa 1:1 il modello mentale del cliente ("da
 * posa X, freccia Y → posa Z"), vieta per costruzione qualunque flip (uno step
 * è un vicino nominato o niente) e rende le frecce letterali.
 */

export const DEG = Math.PI / 180

// Elevazione dei corner ViewCube: vista lungo la diagonale del cubo.
export const CORNER_PITCH = Math.atan(Math.SQRT1_2) // ≈ 35.264°

const EPS_ANGLE = 1e-3
const nearAngle = (a, b) => Math.abs(a - b) < EPS_ANGLE

// Riduce lo yaw a (-180°, 180°]: lo yaw grezzo del modello può accumulare più
// giri (il loop orizzontale non normalizza mai, vedi stepTo), ma il
// riconoscimento della posa lavora sempre sul valore ridotto. Serve anche a
// scegliere il percorso più breve fra due corner del retro (±135°): il loro
// delta canonico "lungo" è ±270°, che wrapYaw riduce a ∓90° — il giro breve
// attraverso il back, non quello attraverso il fronte.
// L'intervallo è semi-aperto per davvero: −180° va riportato a +180°, non lasciato
// com'è. Una posa canonicamente a +180° ci si arriva a −180° venendo dal corner
// a −135° (−135° − 45°): senza questa riduzione `findPoseKey` non la
// riconoscerebbe (|−180 − 180| = 360) e la navigazione morirebbe sul back
// arrivandoci da destra. La soglia è quindi `<= −180 + EPS`, non `−180 − EPS`.
const TAU = 360 * DEG
export const wrapYaw = (yaw) => {
  let w = yaw % TAU
  if (w > 180 * DEG + EPS_ANGLE) w -= TAU
  else if (w <= -180 * DEG + EPS_ANGLE) w += TAU
  return w
}

const NO_NEIGHBORS = { up: null, down: null, left: null, right: null }

/**
 * @typedef {Object} PoseGraphDef  descrizione autorata di un prodotto
 * @property {{ [key: string]: { pitch: number, yaw: number } }} poses
 *   coordinate canoniche (yaw ridotto in (-180°, 180°]) — le chiavi sono il
 *   contratto interno: le usano il JSON delle luci (`lights`), gli step
 *   `goToPose` delle animazioni e la posa home.
 * @property {{ [key: string]: { up?, down?, left?, right? } }} [neighbors]
 *   vicini per direzione; `null`/assente = nessuna posa in quella direzione,
 *   lì il gesto trova solo la resistenza elastica e la freccia non committa.
 * @property {{ [key: string]: string }} [labels] etichette brevi per l'HUD.
 * @property {{ x: number, y: number }} [entryLandscape] posa d'ingresso
 *   landscape usata come fallback quando non c'è una posa home autorata.
 * @property {{ x: number, y: number }} [entryPortrait] ingresso portrait: è
 *   una scelta di FIT su schermo alto, non una posa di prodotto.
 * @property {number} [portraitYawOffset] traslazione in yaw di TUTTO il grafo
 *   in portrait, così la navigazione resta identica, solo traslata.
 */

/**
 * @typedef {Object} PoseGraph  il grafo pronto all'uso
 * @property {Object} poses            (era POSE_COORD)
 * @property {Object} neighbors        (era NEIGHBORS)
 * @property {Object} labels           (era POSE_HUD_LABEL)
 * @property {string[]} keys           chiavi nell'ordine di dichiarazione
 * @property {Function} findPoseKey
 * @property {Function} stepTo
 * @property {Function} label          chiave → etichetta HUD (fallback: chiave)
 */

/**
 * Costruisce il grafo di un prodotto dalla sua descrizione.
 *
 * Normalizza (non è pedanteria: è ciò che rende autorabile un prodotto nuovo
 * senza rileggere questo file):
 *  - ogni posa ha una entry in `neighbors`, anche vuota — `stepTo` legge
 *    `neighbors[key][dir]` e senza questo una posa dimenticata farebbe
 *    esplodere la navigazione invece di limitarsi a non avere uscite;
 *  - un vicino che punta a una chiave inesistente viene scartato con un warn,
 *    non tenuto: a runtime sarebbe un `POSE_COORD[undefined]` silenzioso.
 */
export function createPoseGraph({
  id = 'pose-graph',
  poses,
  neighbors = {},
  labels = {},
  entryLandscape,
  entryPortrait,
  portraitYawOffset = 90 * DEG,
} = {}) {
  if (!poses || typeof poses !== 'object' || Object.keys(poses).length === 0)
    throw new Error(`[poseGraph:${id}] serve almeno una posa in \`poses\``)

  const keys = Object.keys(poses)
  const known = new Set(keys)

  const resolved = {}
  for (const key of keys) {
    const raw = neighbors[key] ?? NO_NEIGHBORS
    const entry = { up: null, down: null, left: null, right: null }
    for (const dir of ['up', 'down', 'left', 'right']) {
      const target = raw[dir] ?? null
      if (target && !known.has(target)) {
        console.warn(`[poseGraph:${id}] vicino inesistente ${key}.${dir} → ${target}, scartato`)
        continue
      }
      entry[dir] = target
    }
    resolved[key] = entry
  }
  for (const key of Object.keys(neighbors))
    if (!known.has(key)) console.warn(`[poseGraph:${id}] adiacenza per una posa inesistente: ${key}`)

  // Chiave della posa canonica a (pitch, yaw). `yawOffset` sottrae la
  // traslazione di banda (portrait): la coordinata grezza del modello meno
  // l'offset ricade sulle coordinate canoniche del grafo.
  const findPoseKey = (pitch, yaw, yawOffset = 0) => {
    const y = wrapYaw(yaw - yawOffset)
    for (const key of keys) {
      const c = poses[key]
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
  const stepTo = (pitch, yaw, dir, yawOffset = 0) => {
    const key = findPoseKey(pitch, yaw, yawOffset)
    if (!key) return null
    const nextKey = resolved[key][dir]
    if (!nextKey) return null
    const delta = wrapYaw(poses[nextKey].yaw - poses[key].yaw)
    return { pitch: poses[nextKey].pitch, yaw: yaw + delta }
  }

  const firstKey = keys[0]
  const entryL = entryLandscape ?? { x: poses[firstKey].pitch, y: poses[firstKey].yaw }

  return Object.freeze({
    id,
    poses: Object.freeze(poses),
    neighbors: Object.freeze(resolved),
    labels: Object.freeze({ ...labels }),
    keys: Object.freeze(keys),
    entryLandscape: Object.freeze(entryL),
    entryPortrait: Object.freeze(entryPortrait ?? entryL),
    portraitYawOffset,
    findPoseKey,
    stepTo,
    label: (key) => labels[key] ?? key,
    has: (key) => known.has(key),
  })
}
