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
  ui: { ...DEFAULT_UI, ...overrides.ui },
  view: { ...DEFAULT_VIEW_SETTINGS, showHelpers: false, showSurfaces: false },
})
