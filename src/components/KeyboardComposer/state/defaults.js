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
  // Margine attorno alle estensioni PROIETTATE del modello nell'inquadratura
  // d'insieme: 1.5 = il 50% di aria attorno al caso peggiore di tutto il grafo
  // delle pose (vedi cameraFraming.js e il fit in useComposerControls.js).
  //
  // ⚠️ **1.5 e non 1.3, e la differenza l'ha trovata il browser, non il calcolo.**
  // Il modello VERGINE si accontenterebbe di ~1.05 (misurato: a 1.5 il massimo
  // |NDC| su tutte e 21 le pose è 0.682). Chi pretende 1.5 è l'animazione
  // `Esploso`, che sposta 97 mesh su ±0.9 unità di scena: a 1.3 sborda del 14%
  // (|NDC| 1.14 sulle pose d'angolo), a 1.45 dell'1.9%, a 1.5 sta dentro con
  // 0.984. La derivazione geometrica aveva stimato quello scoppio più piccolo di
  // quanto sia e aveva dato 1.3 per sicuro: era sbagliata, e l'unico modo di
  // accorgersene era proiettare la scena reale.
  //
  // ⚠️ Non è irraggiungibile in produzione: in `config` drag e frecce sono
  // spente, ma `apiRef.goTo` NON lo è (solo `editMode === 'meshes'` la blocca),
  // quindi la pulsantiera delle viste può girare attorno al modello esploso.
  // Chi volesse l'inquadratura stretta (1.05 → modello 1.9× più grande di oggi)
  // deve dare a `Esploso` un'inquadratura propria o far allargare il fit mentre
  // le mesh sono spostate — il percorso "solo allargamento" esiste già per la
  // modalità Luci in useComposerControls.js. È una scelta di prodotto, non una
  // taratura.
  //
  // ⚠️ Era 1.6, e ha cambiato significato oltre che valore. Il vecchio fit
  // vincolava solo la larghezza e la confrontava con la costante
  // FIT_HALF_WIDTH = 2.0, tarata a mano contro una mezza larghezza reale di 1.6:
  // c'era quindi un 25% di margine nascosto dentro la costante, e il risultato
  // era che il modello occupava il 51% della larghezza e il 39% dell'altezza.
  // Con le estensioni reali il modello è **1.30× più grande** (1.7× in
  // superficie) a margine 1.5, misurato in browser: |NDC| 0.678/0.624 sulla posa
  // d'ingresso contro 0.51/0.39 di prima.
  //
  // Il costo non è il problema: a riposo la copertura misurata passa dal 16% al
  // 21.2% del viewport, cioè ~6 ms di fill contro un budget da 14 — la scala
  // resta a 1, verificato (render target a piena larghezza). Lo stato pesante è
  // il focus, e quello non si muove di un'unità (vedi `focusMargin`).
  fitMargin: 1.5,
  // Lo stesso margine, per l'inquadratura di UN GRUPPO (focusGroup). Manopola
  // separata da `fitMargin`, e la separazione è il punto: fino a ieri la
  // distanza del focus era `R · radiusFactor · fitMargin / (tan(fov/2) · aspect)`,
  // cioè il margine dell'insieme entrava nel focus PER CASO, e stringere
  // l'inquadratura generale avvicinava del 23% ogni inquadratura autorata —
  // rotori compresi — senza una riga di differenza nel JSON.
  //
  // 1.6 e non 1.3 perché 1.6 era il vecchio `fitMargin`: con questo valore le
  // distanze di focus restano NUMERICAMENTE IDENTICHE a prima di questa
  // modifica (verificato in aritmetica: 36.57 × R·rf/2.0 = 24.33 × R·rf·1.6/2.129
  // = R·rf × 18.29). Non è un default prudente, è la conservazione di
  // un'inquadratura autorata a occhio che non va reinterpretata da sola.
  focusMargin: 1.6,
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
  //
  // ⚠️ **E rende MOLTO più di quanto i pixel dicano.** Misurato 2026-08-04 sulla
  // build di produzione a schermo pieno (target 3.06 Mpx), nello stato di focus:
  // da 1.32 a 1.0 il costo dell'app scende da 40.1 a 15.0 ms, cioè **−58%**
  // contro un −43% di pixel. Il costo per pixel coperto non è costante, triplica
  // fra target piccolo e grande (13 → 25 → 38 ms/Mpx) — vedi
  // `fillCostMsPerMpx` qui sotto. Perciò su finestre grandi questa manopola è
  // ancora più efficace di quanto il modello lineare prometta, ed è la prima da
  // muovere. La configurazione spedita di ARRAY_MODEL_L sta a **1.0** per questo;
  // il default di libreria resta più conservativo perché vale per prodotti e
  // macchine che non sono stati misurati.
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
  // legge l'inquadratura VERSO CUI si sta andando (`apiRef.frameCoverage()`,
  // pubblicato da useComposerControls.js), che è nota PRIMA che il frame costi.
  // Un anello chiuso sull'intervallo rAF si adatterebbe all'hardware, ma
  // oscillerebbe attorno alla soglia e darebbe due sessioni non confrontabili —
  // e qui la riproducibilità non è un lusso, è il modo in cui è stato misurato
  // tutto il resto di questo file. (Vale anche un avvertimento pratico: su un
  // display a 60 Hz l'intervallo rAF è 16.7 ms anche quando la GPU ha finito in
  // 4, quindi un anello chiuso ingenuo tarerebbe il costo sul vsync e
  // collasserebbe la risoluzione a scena ferma.)
  //
  // La legge applicata è `scala = √(budget / pixel coperti)`. Era
  // `scala = focusZoom`, giustificata così: la frazione coperta va come
  // 1/focusZoom², i pixel come scala², quindi il prodotto resta costante se
  // scala ∝ focusZoom. Vero a metà, e le due metà che mancavano sono entrambe
  // misurabili — l'argomento per esteso è in testa a cameraFraming.js:
  //   1. la COPERTURA SATURA. Riempito il viewport, avvicinarsi non aggiunge un
  //      pixel da ombreggiare, ma la legge continuava a scendere: l'unica cosa
  //      che la fermava era `dynamicScaleMin`, un numero senza derivazione che
  //      finiva per decidere da solo tutto il frame peggiore.
  //   2. non sapeva quanto è grande la FINESTRA. `focusZoom` è un rapporto: vale
  //      0.19 sui rotori sia in un canvas 798×718 sia a tutto schermo su un
  //      1080p, dove i pixel sono 3.6× — «~12 fps in a 798×718 canvas and ~6 fps
  //      fullscreen» in CLAUDE.md, cioè la contraddizione era già registrata.
  dynamicScale: true,
  // Il budget: quanti millisecondi di FILL si è disposti a pagare per frame.
  // 14 e non 16.7 perché ~2-3 ms del frame non sono fill (CPU 1.17 ms misurati +
  // geometria/submit), quindi 14 è la quota che questa legge può davvero
  // governare per stare dentro i 60 fps. Per un prodotto che si accontenta di 30
  // fps stabili con più nitidezza: 30.
  frameBudgetMs: 14,
  // La TARATURA, cioè l'unico numero di questo blocco che va rimisurato per
  // macchina: millisecondi di fill per megapixel COPERTO.
  //
  // 35 = misurato in browser (2026-08-04, Intel Iris Xe) sulla build di
  // PRODUZIONE a schermo pieno (1901×926, target 3.06 Mpx), nello stato peggiore
  // cioè a fine `GoToRotors` col modello che copre il 95% del viewport: 40.1 ms
  // di costo app su 1.047 Mpx coperti = 38 ms/Mpx. Era 28, ricavato per
  // sottrazione da una misura del 2026-08-02 con l'AO acceso, e sottostimava:
  // la legge scalava meno del necessario proprio nello stato che deve proteggere.
  //
  // ⚠️ **Il costo NON è lineare nei pixel coperti come questo singolo numero
  // suggerisce**, e su target grandi sbaglia in difetto. Misurato sulla stessa
  // scena, stessa copertura, tre risoluzioni:
  //   1.047 Mpx coperti → 40.1 ms → 38 ms/Mpx
  //   0.600            → 15.0    → 25
  //   0.419            →  5.4    → 13
  // Cioè il costo per pixel TRIPLICA fra il target piccolo e quello grande —
  // effetto di banda/residenza in cache su una GPU integrata che condivide la
  // memoria di sistema, non di aritmetica. Un'unica costante non può descrivere
  // entrambi i regimi: si tara sul regime PESANTE, così l'errore cade dal lato
  // sicuro (si scala un po' troppo dove non serve, mai troppo poco dove serve).
  //
  // ⚠️ Va tarato sullo stato PEGGIORE e non a riposo, e non è indifferente: la
  // copertura è stimata sulla proiezione della SCATOLA contenitrice, che a
  // inquadratura d'insieme sovrastima la sagoma di ~1.9× (19.8% contro 10.2%) e
  // nello stato saturo invece la coglie. Tarando sul peggiore l'errore cade dove
  // non fa danno: a riposo la scala è comunque bloccata a 1 da tutt'altro
  // margine. Tarando a riposo si otterrebbe il contrario — piena risoluzione
  // proprio nel frame che non ce la fa.
  //
  // ⚠️ Riaccendere `aoEnabled` cambia questo numero (~43 invece di 28): l'AO
  // costa ~15 ms nello stato saturo e scala anch'esso con i pixel coperti.
  fillCostMsPerMpx: 35,
  // Pavimento del moltiplicatore, e non è più la manopola che decide il frame
  // peggiore: quello lo decide il budget. Qui resta il limite di MORBIDEZZA
  // accettata — 0.6 × `pixelRatioCap` 1.32 ≈ 0.79 pixel per pixel di schermo,
  // cioè un upscale già percepibile sui bordi ma confinato agli stati pesanti.
  // Quando è lui a vincere il messaggio è preciso: quella finestra è troppo
  // grande per questo hardware, e la scelta fra fluidità e nitidezza torna
  // all'autore (abbassare `pixelRatioCap`, o accettare 30 fps alzando
  // `frameBudgetMs`). Era 0.7, e nel JSON spedito era stato alzato a mano a 0.85
  // — che è esattamente il sintomo di una manopola costretta a fare due lavori.
  dynamicScaleMin: 0.6,

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
