/**
 * Geometria dell'INQUADRATURA: quanto grande appare il modello e quanta parte
 * del viewport copre. Matematica pura — nessun three, nessun React, nessuno
 * stato. La camera la applica useComposerControls.js, il costo di fill lo paga
 * runtime/postfx/PostFx.jsx, e questo è il solo posto che sa tradurre l'una
 * nell'altro.
 *
 * ## Perché esiste: il costo del frame è la SUPERFICIE COPERTA, non lo zoom
 *
 * Su questa scena il frame è bandwidth-bound e lineare nei pixel coperti
 * (~60 ns/px misurati, vedi CLAUDE.md). `PostFx` scalava la risoluzione a
 * partire dal solo fattore di zoom del focus, con la legge `scala = focusZoom`,
 * giustificata così: la frazione coperta va come 1/focusZoom², i pixel resi come
 * scala², quindi il prodotto è costante. Vero, ma solo fino a metà strada, e le
 * due metà che mancavano sono entrambe misurabili:
 *
 *  1. **La copertura SATURA.** Quando il modello riempie il viewport,
 *     avvicinarsi ancora non aggiunge un pixel da ombreggiare. La legge
 *     continuava a scendere, e l'unica cosa che la fermava era `dynamicScaleMin`
 *     — un numero senza derivazione, che è finito per decidere da solo tutto il
 *     frame peggiore.
 *  2. **Non sapeva quanto è grande la finestra.** `focusZoom` è un RAPPORTO:
 *     vale 0.19 sui rotori sia in un canvas 798×718 sia a tutto schermo su un
 *     1080p, dove i pixel sono 3.6× e il frame costa 3.6× di più. È la stessa
 *     cecità già registrata in CLAUDE.md come «the same sequence reads ~12 fps
 *     in a 798×718 canvas and ~6 fps fullscreen».
 *
 * Le due funzioni qui sotto danno la grandezza che mancava — i pixel coperti,
 * in assoluto — così la legge diventa «resta sotto al budget» invece di «resta
 * quanto costavi a riposo».
 *
 * ## Perché la SCATOLA e non la sfera (al contrario di focusFraming.js)
 *
 * `focusFraming.js` misura una SFERA apposta, ed è la scelta giusta là: inquadrare
 * un gruppo deve essere indipendente dalla posa, o l'inquadratura respira mentre
 * si orbita. Qui l'obiettivo è opposto — stimare una SUPERFICIE — e la sfera la
 * sbaglia di 2.6× su questo modello: la sfera contenitrice della tastiera
 * (3.2 × 0.411 × 1.432 unità di scena) copre il 26.5% del viewport
 * nell'inquadratura d'insieme, la proiezione della scatola il 19.8%, la sagoma
 * vera il 10.2%. Il 26.5% è, non per caso, il «~25% of the viewport» che
 * CLAUDE.md attribuisce allo stato di riposo: è la sfera, non la sagoma.
 *
 * ⚠️ Il rettangolo proiettato è però una SOVRASTIMA della sagoma — fattore ~1.9
 * sulle pose a 3/4, dove l'esagono della silhouette riempie circa metà del
 * proprio rettangolo — e la tentazione è correggerlo con un fattore di
 * riempimento costante. Non funziona, e vale la pena sapere perché prima di
 * riprovarci: quel fattore NON è costante. Vale 1 esatto di fronte (la sagoma È
 * il rettangolo), 0.51 sul corner a 3/4, e tende a 1 quando il quadro finisce
 * DENTRO la scatola e ogni pixel è pieno. Un numero medio comprimerebbe
 * l'escursione fra lo stato leggero e quello pesante, che è esattamente
 * l'informazione per cui questo modulo esiste.
 *
 * La via d'uscita è che non serve nessun numero: **l'area della sagoma di una
 * scatola ha forma chiusa** (`silhouetteArea` qui sotto, tre prodotti), quindi il
 * fattore di riempimento si CALCOLA, posa per posa, ed è esatto dove non c'è
 * taglio. Interpolarlo verso 1 in proporzione a quanto la scatola sborda dal
 * quadro chiude l'altro estremo. Verificato contro le due misure di CLAUDE.md:
 * a riposo dà 10.2% (la sagoma misurata) invece del 19.8% del rettangolo nudo, e
 * nello stato saturo resta ~1. Cioè la stima è ora quantitativamente giusta a
 * ENTRAMBI i capi, ed è quel che permette a `fillCostMsPerMpx` di essere UNA
 * costante invece di due tarature in conflitto.
 */

/**
 * Mezze estensioni A SCHERMO (in unità di scena) di una scatola allineata agli
 * assi, vista dalla camera del configuratore alla posa (pitch, yaw).
 *
 * Locale, come `silhouetteArea`: le usano solo le due funzioni esportate qui
 * sotto. La superficie pubblica di questo modulo è di due funzioni, una per
 * consumatore — il fit (`worstCaseHalfExtents`) e la scala dinamica
 * (`coverageFraction`).
 *
 * ⚠️ Le due formule sono asimmetriche, e non è una svista: **la camera non rolla
 * mai.** L'orientamento è `Euler(-pitch, -yaw, 0, 'YXZ')`, quindi il versore
 * "destra dello schermo" resta sempre nel piano xz — `(cos yaw, 0, sin yaw)` — e
 * l'ALTEZZA del modello (y) non contribuisce MAI alla larghezza proiettata. Su
 * questo modello y è l'asse corto (0.411 contro 3.2), quindi è proprio da qui che
 * questa stima è molto più stretta della sfera contenitrice.
 *
 * Il versore "alto dello schermo" è invece `(sin p·sin y, cos p, −sin p·cos y)`,
 * e tutte e tre le dimensioni vi contribuiscono.
 *
 * @param {{x:number,y:number,z:number}} size estensione PIENA della scatola
 * @returns {{halfW:number, halfH:number}}
 */
function projectedHalfExtents(size, pitch, yaw) {
  const cy = Math.abs(Math.cos(yaw))
  const sy = Math.abs(Math.sin(yaw))
  const cp = Math.abs(Math.cos(pitch))
  const sp = Math.abs(Math.sin(pitch))
  return {
    halfW: 0.5 * (size.x * cy + size.z * sy),
    halfH: 0.5 * (size.x * sp * sy + size.y * cp + size.z * sp * cy),
  }
}

/**
 * Le estensioni proiettate PEGGIORI su tutto il grafo delle pose: i due numeri
 * che l'inquadratura d'insieme deve contenere per non tagliare il modello da
 * nessuna posa raggiungibile.
 *
 * ⚠️ Si scandisce il grafo REALE e non si usa il limite indipendente
 * dall'orientamento (che sarebbe il raggio della sfera): la differenza non è
 * cosmetica. Sul modello di ARRAY_MODEL_L il massimo sul grafo vale
 * halfW 1.638 / halfH 1.114, mentre il limite libero vale 1.753 / 1.764 — cioè
 * il 58% in più in altezza, perché la posa che ci arriverebbe (pitch ~61°, yaw
 * ~24°) semplicemente non esiste fra le 21. Inquadrare per una posa che non c'è
 * significa buttare via un terzo del frame.
 *
 * ⚠️ `yawOffset` va passato: in portrait l'intero grafo vive traslato di 90° e
 * |cos| e |sin| si scambiano, quindi il massimo NON è lo stesso insieme di
 * numeri. È il `frame.current.yawOffset` di useComposerControls.js.
 *
 * @param {{x:number,y:number,z:number}} size
 * @param {Record<string,{pitch:number,yaw:number}>} poses
 */
export function worstCaseHalfExtents(size, poses, yawOffset = 0) {
  let halfW = 0
  let halfH = 0
  for (const key in poses) {
    const coord = poses[key]
    if (!coord) continue
    const e = projectedHalfExtents(size, coord.pitch, coord.yaw + yawOffset)
    if (e.halfW > halfW) halfW = e.halfW
    if (e.halfH > halfH) halfH = e.halfH
  }
  return { halfW, halfH }
}

/**
 * Area della SAGOMA di una scatola vista da una direzione, in forma chiusa.
 *
 * Le tre coppie di facce hanno area `y·z`, `x·z`, `x·y` e normali lungo i tre
 * assi; la proiezione di un solido convesso è la somma delle facce visibili, cioè
 * metà di tutte e sei pesate per il coseno con la direzione di vista — che si
 * semplifica in una somma di tre prodotti. Esatta, niente campionamento.
 *
 * Serve a sapere quanto del rettangolo proiettato la sagoma riempie davvero:
 * 1.0 di fronte (dove sagoma e rettangolo coincidono), 0.51 sul corner a 3/4 di
 * questo modello.
 */
function silhouetteArea(size, pitch, yaw) {
  // Direzione di vista: la stessa `(-cos p·sin y, sin p, cos p·cos y)` che
  // useComposerControls ricava dall'orientamento della camera. Contano solo i
  // valori assoluti.
  const nx = Math.abs(Math.cos(pitch) * Math.sin(yaw))
  const ny = Math.abs(Math.sin(pitch))
  const nz = Math.abs(Math.cos(pitch) * Math.cos(yaw))
  return nx * size.y * size.z + ny * size.x * size.z + nz * size.x * size.y
}

/**
 * Frazione del viewport coperta dal modello, fra 0 e 1.
 *
 * Tutte le grandezze sono in unità di scena sul piano immagine: `visibleHalfW/H`
 * sono le mezze estensioni inquadrate alla distanza corrente
 * (`raggio · tan(fov/2)` e quella per l'aspect), `offsetX/Y` lo scostamento fra
 * il centro della scatola e il punto che la camera guarda, proiettato sui due
 * assi dello schermo.
 *
 * ⚠️ L'offset non è un dettaglio: in focus il pivot dell'orbita si sposta sul
 * centro del gruppo, quindi il modello esce di quadro da un lato e la copertura
 * non è più centrata. Senza, inquadrare i rotori (che stanno di lato)
 * risulterebbe più costoso di quanto sia.
 *
 * Il taglio ai bordi è ciò che fa SATURARE la stima, cioè la sola cosa che la
 * vecchia legge basata su `focusZoom` non sapeva fare: una volta che la scatola
 * contiene il quadro il risultato non cresce più, per quanto ancora ci si
 * avvicini.
 */
export function coverageFraction({
  size,
  pitch,
  yaw,
  offsetX = 0,
  offsetY = 0,
  visibleHalfW,
  visibleHalfH,
}) {
  if (!size || !(visibleHalfW > 0) || !(visibleHalfH > 0)) return 0
  const { halfW, halfH } = projectedHalfExtents(size, pitch, yaw)
  const spanX = Math.min(visibleHalfW, offsetX + halfW) - Math.max(-visibleHalfW, offsetX - halfW)
  const spanY = Math.min(visibleHalfH, offsetY + halfH) - Math.max(-visibleHalfH, offsetY - halfH)
  if (spanX <= 0 || spanY <= 0) return 0

  const boxArea = 4 * halfW * halfH
  if (!(boxArea > 0)) return 0
  const visibleBoxArea = spanX * spanY
  // Quanto della scatola proiettata la sagoma riempie: esatto (vedi sopra)…
  const fill = Math.min(1, silhouetteArea(size, pitch, yaw) / boxArea)
  // …e tende a 1 quando il quadro è dentro la scatola, cioè quando la porzione
  // inquadrata è tutta pieno e i vuoti dell'esagono sono rimasti fuori.
  const clipped = 1 - visibleBoxArea / boxArea
  const solid = fill + (1 - fill) * clipped

  return Math.min(1, (solid * visibleBoxArea) / (4 * visibleHalfW * visibleHalfH))
}
