/**
 * I valori di partenza del configuratore, in un posto solo.
 *
 * Prima vivevano come `value:` dentro gli schema Leva sparsi in cinque file —
 * cioè i default di PRODUZIONE erano scritti dentro l'UI di authoring, e
 * togliere Leva dal percorso di produzione li avrebbe portati via con sé.
 * Adesso la direzione è l'opposta: questo modulo è la fonte, e gli schema Leva
 * lo importano per popolare gli slider.
 *
 * È lo stesso ragionamento già scritto per `DEFAULT_VIEW_SETTINGS` (che ora
 * abita qui): un default dichiarato due volte è un default che prima o poi
 * diverge, e diverge in silenzio, perché nessuno confronta a mano un JSON
 * salvato l'anno scorso con lo schema di oggi.
 *
 * ⚠️ Queste chiavi sono le chiavi del JSON salvato. Rinominarne una rimappa in
 * silenzio ogni configurazione già autorata: le vecchie chiavi non vengono più
 * lette e le nuove ricadono sul default, che è esattamente il tipo di
 * regressione che non alza nessun errore.
 */

/** Feel di camera e navigazione: sezione `rotation`. Letta ogni frame. */
export const DEFAULT_ROTATION = {
  dragSpeed: 0.01,
  followTime: 0.2,
  commitFraction: 0.2,
  springStiffness: 150,
  springDamping: 0.85,
  rubberFactor: 0,
  rubberCapDeg: 0,
  timeScale: 0.3,
  fitMargin: 1.6,
  zoomOutMobile: 1.25,
  focusDamp: 0.6,
  focusOutDamp: 0.6,
}

/** Luce direzionale che proietta l'ombra: sezione `keylight`. */
export const DEFAULT_KEYLIGHT = {
  enabled: true,
  showGizmo: false,
  intensity: 0.5,
  posX: 0,
  posY: 5,
  posZ: 2,
  bias: -0.0005,
  normalBias: 0.02,
}

/** Faretto secondario, spento di default: sezione `spotlight`. */
export const DEFAULT_SPOTLIGHT = {
  enabled: false,
  showGizmo: false,
  intensity: 1.0,
  angle: 0.6,
  penumbra: 0.5,
  distance: 15,
  posX: -3,
  posY: 4,
  posZ: 3,
  bias: -0.0005,
  normalBias: 0.02,
}

/**
 * Inquadratura di UN gruppo. Il default è l'identità: `radiusFactor: 1` e
 * offset nulli lasciano esattamente il focus calcolato dalla sfera contenitrice
 * (focusFraming.js), che è già un default sicuro. Un gruppo assente dalla
 * sezione `focus` ricade qui, quindi si comporta come se non fosse mai stato
 * autorato — ed è il comportamento voluto.
 */
export const DEFAULT_FOCUS_GROUP = {
  radiusFactor: 1,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
}

/**
 * Materiale di ripiego per un gruppo di cui non si conosce il materiale reale.
 * ⚠️ Non è il default di produzione: quello si legge dal materiale REALE del
 * GLB, autorato in Maya (vedi materials/groupMaterials.js). Questi valori
 * servono solo a dare un fondo agli slider quando il gruppo non ha mesh.
 */
export const DEFAULT_MATERIAL = {
  color: '#888888',
  roughness: 0.5,
  metalness: 0,
  envMapIntensity: 1,
  clearcoat: 0,
  clearcoatRoughness: 0,
}

/**
 * Valori PER VISTA, salvati dentro `lights[posa]` accanto a `top_0_intensity`
 * & co. I quattro damping erano tunabili in `?debug` ma non venivano salvati da
 * nessuna parte: erano l'unico parametro dell'app a non sopravvivere a un
 * salva/ricarica. `showHelpers`/`showSurfaces` non stanno qui pur essendo
 * salvati per vista: sono visualizzazione di debug, non un parametro di resa.
 */
export const DEFAULT_VIEW_SETTINGS = {
  margin: 1.0,
  animMarginDamp: 0.25,
  animLightOnDamp: 0.08,
  animLightOffDamp: 0.25,
  animColorDamp: 0.35,
}

/**
 * Sezione `app`: ciò che non è né luce né materiale né animazione, ma governa
 * come il componente si comporta.
 *  - `idleAnimation` è l'animazione autorata che riporta la scena a riposo
 *    uscendo da config ('' = transizione secca).
 *  - `release*` sono velocità e curva del RIENTRO di uscita, su due binari
 *    indipendenti perché hanno tempi naturali diversi: l'opacità
 *    (`releaseDuration`/`releaseEasing`) e la POSA delle mesh traslate o ruotate
 *    (`releaseTransforms*`, spegnibile). Il terzo pezzo del rientro, lo
 *    zoom-out, ha la sua manopola gemella in `rotation.focusOutDamp`, perché è
 *    feel di camera e viaggia con quella sezione.
 *
 * ⚠️ `homePose` non è qui dentro: è una CHIAVE DI POSA, quindi dipende dal
 * prodotto. Un letterale 'TL' funzionava solo finché il grafo era uno solo.
 */
export const DEFAULT_APP_CONFIG = {
  idleAnimation: '',
  releaseDuration: 0.5,
  releaseEasing: 'easeInOutCubic',
  releaseTransforms: true,
  releaseTransformsDuration: 0.7,
  releaseTransformsEasing: 'easeInOutCubic',
}

/**
 * Sezione `postfx`: TARATURA della catena di post-processing, non il suo
 * interruttore.
 *
 * ⚠️ La divisione fra questa sezione e la prop `postfx` di KeyboardComposer non
 * è arbitraria, ed è l'unica che regge. ACCENDERE il composer cambia la CHIAVE
 * DI CACHE dei programmi di OGNI materiale della scena: three compila
 * `toneMapping`/`outputColorSpace` dentro il fragment shader e ne sceglie i
 * valori in base a dove si sta disegnando (schermo → ACES + sRGB, render target
 * → nessuno + lineare). Passare dall'uno all'altro a sessione avviata
 * ricompilerebbe tutto, a 192 ms per programma — lo stesso costo misurato che
 * `materials/warmupTransparency.js` esiste per evitare.
 *
 * Quindi: l'ACCENSIONE si decide una volta sola, in modo sincrono, dalla prop
 * (il JSON autorato arriva via fetch, cioè troppo tardi per definizione). Qui
 * restano solo i valori che si possono muovere a caldo perché toccano il render
 * target e i quad fullscreen, mai i materiali della scena.
 */
export const DEFAULT_POSTFX = {
  // Campioni MSAA del render target. Il framebuffer di default ne ha di suoi
  // (`antialias: true`), ma si perdono nel momento in cui si rende attraverso
  // un composer: qui vanno richiesti a mano, o il primo pass aggiunto PEGGIORA
  // l'immagine invece di migliorarla.
  //
  // ⚠️ 2 e non 4, MISURATO: sopra `pixelRatioCap` 1.25 il numero di campioni non
  // si vede più. Delta medio sui pixel di bordo contro l'immagine a dpr 2 +
  // msaa 4: 9.06/255 con msaa 4, 9.19/255 con msaa 2 — indistinguibili. Chi
  // decide la qualità dei bordi è la RISOLUZIONE, non i campioni; da 4 a 2 si
  // risparmiano ~4 ms per frame senza contropartita.
  msaaSamples: 2,
  // Precisione del render target. `false` scende a 8 bit per canale, cioè
  // dimezza i byte per campione — l'unica classe di risparmio che si misuri su
  // questa scena (bandwidth-bound, vedi CLAUDE.md).
  //
  // ⚠️ MISURATO 2026-08-02, ed è una manopola vera ma la meno conveniente delle
  // tre. Vale **−9.2%** (54.6 → 49.6 ms, dispersioni 2.1 e 0.7 che non si
  // sovrappongono). Il prezzo, contro un controllo 16-vs-16 bit che a riposo dà
  // differenza ESATTAMENTE zero:
  //   a riposo   0.18/255 medio, max 15, 0.027% dei pixel oltre 8 → invisibile
  //   in zoom    1.31/255 medio, max 59, 0.425% → piccolo ma sopra il rumore
  // Lo zoom è peggio perché lì ~105 mesh sono in blending e la quantizzazione
  // si accumula strato su strato.
  //
  // Resta `true` di default, e non perché 9% sia poco: è l'unica delle manopole
  // misurate il cui danno dipende dal CONTENUTO invece che dalla geometria
  // dell'immagine. La scena entra qui in HDR lineare (il tone mapping è in
  // OutputPass), quindi tutto ciò che supera 1.0 si tronca prima che ACES possa
  // comprimerlo — e il GLB testurato in arrivo può portare materiali più
  // lucidi, cioè più alte luci sopra 1.0 di quante ne abbia oggi. Il posto dove
  // spenderla è semmai il mobile, dove il costo di fill è peggiore e lo schermo
  // più piccolo.
  hdrTarget: true,
  // Tetto al pixel ratio del render target, cioè la manopola di gran lunga più
  // efficace di questo file — il costo di questa scena è LINEARE nei pixel.
  //
  // Misurato in browser (2026-08-02, Intel Iris Xe) nello stato peggiore, cioè
  // a fine `GoToRotors`, dove il focus sui rotori porta il modello da ~25% del
  // viewport a coprirlo tutto: ~60 ns per pixel, costante su tre risoluzioni
  // (1.46 Mpx → 87.3 ms, 1.29 → 76.6, 0.89 → 60.0). La CPU dell'intero frame è
  // 1.17 ms: l'asse è solo quello.
  //
  // 1.25 invece di 2 vale −31% da sola e −36% insieme a `msaaSamples: 2`. Il
  // prezzo, misurato con lo split per gradiente locale su 365k campioni contro
  // l'immagine a dpr 2: 98% dei pixel (le superfici) a 0.15/255, cioè
  // invisibile, e 2% (le sagome) a 9.1/255, che è reale ma confinato ai bordi.
  // Chi volesse più qualità: 1.5 costa 7.6/255 sui bordi ma rende solo −12%.
  //
  // ⚠️ Non è un LOD a runtime: come `msaaSamples` ricostruisce la catena
  // (vedi il useLayoutEffect di runtime/postfx/PostFx.jsx), quindi è un valore
  // autorato e basta.
  pixelRatioCap: 1.25,

  // --- Scala dinamica della risoluzione -----------------------------------
  //
  // `pixelRatioCap` è un tetto AUTORATO: vale sempre lo stesso, quindi va scelto
  // per lo stato peggiore o per quello migliore, mai per entrambi. Questo è lo
  // stesso valore reso funzione dello stato della scena.
  //
  // Il perché sta tutto in due misure già fatte e scritte qui sopra: il costo è
  // LINEARE nei pixel coperti (~60 ns/px), e la stessa scena costa ~3 ms per
  // frame a riposo e ~56 ms quando un focus porta il modello a riempire il
  // viewport. Non è un picco da assorbire con un warm-up — è un secondo stato
  // stazionario, e l'unico modo di pagarlo quanto il primo è renderizzare meno
  // pixel proprio lì.
  //
  // ⚠️ FEED-FORWARD, non retroazione: non si misura il frame precedente, si
  // legge il fattore di zoom del focus (`apiRef.focusZoomFactor()`, pubblicato
  // da useComposerControls.js), che è noto PRIMA che il frame costi. Un anello
  // chiuso sull'intervallo rAF si adatterebbe all'hardware, ma oscillerebbe
  // attorno alla soglia e darebbe due sessioni non confrontabili — e qui la
  // riproducibilità non è un lusso, è il modo in cui è stato misurato tutto il
  // resto di questo file.
  //
  // La legge applicata è `scala = focusZoom`, e non è una scelta di gusto: la
  // frazione di viewport coperta va come 1/focusZoom², i pixel renderizzati come
  // scala², quindi il loro prodotto — cioè il costo — resta costante solo se
  // scala ∝ focusZoom.
  dynamicScale: true,
  // Pavimento del moltiplicatore. Serve perché la legge qui sopra smette di
  // valere quando la copertura SATURA: una volta che il modello riempie il
  // viewport, avvicinarsi ancora non aggiunge un pixel da ombreggiare, e
  // continuare a scendere sarebbe qualità regalata senza contropartita.
  // 0.7 = al più metà dei pixel (0.7² = 0.49).
  dynamicScaleMin: 0.7,

  // --- Occlusione ambientale (ombre di contatto) --------------------------
  //
  // ⚠️ Qui l'AO non è una rifinitura: è l'UNICA occlusione che il prodotto ha.
  // Delle ~34 luci del rig, 31 non possono proiettare ombra per costruzione
  // (rectAreaLight non le supporta, le point solo via cube map: 6 render di
  // scena a luce), e le due luci-ombra sono spente per scelta estetica nella
  // configurazione spedita. Senza questo passaggio niente stacca il keycap
  // dalla piastra, il tassello dalla sua sede, il rotore dal corpo.
  aoEnabled: true,
  // Risoluzione dell'AO come frazione di quella del render target. 0.5 = metà
  // per lato, cioè un quarto dei pixel. È l'asse su cui questa scena è più
  // sensibile (fragment), e il denoise di Poisson del pass fa già da
  // ricampionamento guidato dalla profondità.
  aoResolutionScale: 0.5,
  // Raggio di ricerca in UNITÀ DI SCENA. Il modello è largo `TARGET_WIDTH`
  // = 3.2, quindi 0.12 è dell'ordine della fuga fra due keycap: è la distanza
  // a cui vogliamo vedere il contatto, non l'occlusione d'insieme.
  aoRadius: 0.12,
  // Quanto l'AO scurisce il colore finale (`blendIntensity`). Fisicamente
  // dovrebbe modulare solo la luce indiretta; qui le 32 luci non-ombreggianti
  // SONO il sostituto dell'indiretta, quindi moltiplicare il colore finale è
  // difendibile in questa scena in particolare.
  aoIntensity: 1,
  // Spessore presunto degli oggetti visti di taglio: alza per ridurre gli aloni
  // chiari attorno alle silhouette, abbassa se il contatto sparisce.
  aoThickness: 1,
  // Curva di caduta con la distanza. >1 concentra l'effetto sui contatti
  // ravvicinati invece di spalmarlo.
  aoDistanceExponent: 2,
  // Campioni per pixel. 16 è il default del pass, e a metà risoluzione è già
  // generoso.
  //
  // ⚠️ NON è la manopola da abbassare se serve margine — questo commento diceva
  // il contrario, ed è stato misurato falso: 16 → 4 vale ZERO (87.4 ms contro
  // 87.3), mentre spegnere del tutto la pass vale 15 ms. Il costo dell'AO qui è
  // BANDA (quattro quad fullscreen: AO, denoise di Poisson, copia, blend), non
  // aritmetica. Le uniche leve reali sono `aoEnabled` e `aoResolutionScale`.
  aoSamples: 16,
}

/** Stato dell'editor: non si salva, vedi UI_SECTION in composerStore.js. */
export const DEFAULT_UI = {
  editMode: 'none',
  homePose: '',
}

/**
 * Lo stato iniziale completo, pronto per `createComposerStore`.
 *
 * `lights`, `materials` e `focus` nascono VUOTI, e non è una dimenticanza: sono
 * indicizzati per chiave di posa e per id di gruppo, cioè per dati che
 * appartengono al prodotto e non a questo modulo. Si popolano dal JSON di
 * configurazione (`hydrate`) o, per i materiali, dal GLB stesso.
 *
 * @param {Object} [overrides] valori noti al chiamante, tipicamente
 *   `{ ui: { homePose } }` con la posa d'ingresso del grafo del prodotto.
 */
export const createInitialState = (overrides = {}) => ({
  lights: {},
  materials: {},
  rotation: { ...DEFAULT_ROTATION },
  keylight: { ...DEFAULT_KEYLIGHT },
  spotlight: { ...DEFAULT_SPOTLIGHT },
  focus: {},
  animations: { version: 1, items: [] },
  variants: { swapAnimations: {} },
  app: { ...DEFAULT_APP_CONFIG, ...overrides.app },
  postfx: { ...DEFAULT_POSTFX },
  ui: { ...DEFAULT_UI, ...overrides.ui },
  view: { ...DEFAULT_VIEW_SETTINGS, showHelpers: false, showSurfaces: false },
})
