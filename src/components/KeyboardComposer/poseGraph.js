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
 * completo), qui esistono SOLO le pose fotografate dal cliente: gli archi
 * sono clampati (niente retro puro, niente retro-basso) e oltre l'ultima
 * posa il gesto incontra solo la resistenza elastica (vedi
 * useComposerControls).
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
  Top: { pitch: 90 * DEG, yaw: 0 },
  '3-4 top': { pitch: 45 * DEG, yaw: 0 },
  front: { pitch: 0, yaw: 0 },
  '3-4 front': { pitch: -45 * DEG, yaw: 0 },
  bottom: { pitch: -90 * DEG, yaw: 0 },
  // Spigolo top/retro VISTO DRITTO da dietro (manopola a sinistra, come nel
  // JPEG): raggiunto dall'arco verticale a φ=135° via toModelRotation.
  '3-4 back': { pitch: 45 * DEG, yaw: 180 * DEG },
  '3-4 left': { pitch: 0, yaw: 45 * DEG },
  left: { pitch: 0, yaw: 90 * DEG },
  '3-4-left back': { pitch: 0, yaw: 135 * DEG },
  '3-4 right': { pitch: 0, yaw: -45 * DEG },
  right: { pitch: 0, yaw: -90 * DEG },
  '3-4 right-back': { pitch: 0, yaw: -135 * DEG },
}

// Arco verticale principale, in parametro d'ORBITA φ: bottom → 3-4 front →
// front → 3-4 top → Top → 3-4 back. Nessun wrap: il retro puro non è nel
// set del cliente. Fino a 90° φ coincide col pitch del modello; oltre, la
// vista scavalca lo zenit e toModelRotation aggiunge il mezzo giro di yaw
// (stessa transizione animata del ViewCube di Maya da Top allo spigolo
// retro: la scena "spinna" di 180° attraversando il polo).
const PITCH_ARC_MAIN = [-90, -45, 0, 45, 90, 135].map((d) => d * DEG)
// Alle pose 3-4 left/right (yaw ±45°) l'unico passo verticale è il mini-step
// che sale al corner fotografato ("initial position" / "3-4 front right").
const PITCH_ARC_CORNER = [0, CORNER_PITCH]
// Altrove il pitch non ha pose: il drag verticale trova solo l'elastico.
const PITCH_LOCKED = [0]

// Arco orizzontale (sbloccato solo a pitch 0): ±135° max, niente retro puro.
export const YAW_STOPS = [-135, -90, -45, 0, 45, 90, 135].map((d) => d * DEG)

// Pose d'ingresso: landscape = corner "initial position"; portrait = vista
// top ruotata a schermo (pitch 90 + yaw 90, comportamento già in produzione).
export const ENTRY_LANDSCAPE = { x: CORNER_PITCH, y: 45 * DEG }
export const ENTRY_PORTRAIT = { x: 90 * DEG, y: 90 * DEG }

const EPS_ANGLE = 1e-3
const nearAngle = (a, b) => Math.abs(a - b) < EPS_ANGLE

/**
 * Stop di pitch disponibili allo yaw corrente. In portrait l'arco principale
 * vive anche sull'asse d'ingresso (yaw 90°), così il flusso verticale parte
 * dalla posa top verticale esattamente come oggi.
 */
export function pitchStopsAt(yaw, portrait = false) {
  if (nearAngle(yaw, 0)) return PITCH_ARC_MAIN
  if (portrait && nearAngle(yaw, 90 * DEG)) return PITCH_ARC_MAIN
  if (nearAngle(Math.abs(yaw), 45 * DEG)) return PITCH_ARC_CORNER
  return PITCH_LOCKED
}

/**
 * Mappa (φ verticale, yaw dell'anello) → rotazione Euler del modello.
 * Fino allo zenit (φ ≤ 90°) è l'identità; oltre, la vista prosegue verso lo
 * spigolo retro: pitch retrocede (180° − φ) mentre lo yaw compie il mezzo
 * giro, linearmente su φ ∈ (90°, 135°]. Continua in φ = 90°, quindi damp e
 * molla animano la transizione senza scatti — lo "spin da polo" di Maya.
 */
export function toModelRotation(phi, ringYaw) {
  const zenith = 90 * DEG
  if (phi <= zenith) return { x: phi, y: ringYaw }
  const t = (phi - zenith) / (45 * DEG)
  return { x: Math.PI - phi, y: ringYaw + Math.PI * t }
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
