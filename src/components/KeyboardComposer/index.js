export { default } from './KeyboardComposer'
export { default as KeyboardComposer } from './KeyboardComposer'
export { preloadKeyboardModel } from './KeyboardModel'

// Registro dei prodotti — il tipo enumerativo del configuratore. Chi integra
// il componente sceglie un modello con `product={PRODUCT_IDS.ARRAY_MODEL_L}`
// (o la stringa equivalente), oppure ne dichiara uno proprio con
// `defineProduct` — vedi products/productSchema.js.
// ⚠️ Tre export sono stati tolti da qui perché non li chiamava NESSUNO, né
// dentro il repo né fuori (il pacchetto non è mai stato pubblicato):
// `PRODUCT_LIST` e `isProductId`, cancellati — con un prodotto solo erano una
// lista di uno e un confronto fra stringhe, e si riscrivono in una riga da
// `PRODUCTS` — e `getProduct`, che resta ma è diventato locale a
// `products/index.js`, dove serve a iniettare il registro in `resolveProduct`.
export {
  PRODUCTS,
  PRODUCT_IDS,
  DEFAULT_PRODUCT_ID,
  resolveProduct,
  defineProduct,
  ARRAY_MODEL_L,
} from './products'

// Fabbrica del grafo delle pose: serve a chi dichiara un prodotto nuovo e
// vuole costruirne il grafo a parte (in `defineProduct` basta passarne la
// descrizione, la fabbrica viene chiamata da lì).
export { createPoseGraph } from './poseGraph'

// La superficie di comando che arriva da `onReady(api)` / `apiRef`. Esportata
// perché ci si possa costruire sopra a mano (test, wrapper, un adapter
// postMessage); l'uso normale è riceverla, non costruirla.
export { createPublicApi } from './runtime/publicApi'

// Il flag di authoring, per chi vuole aprire l'editor su una propria rotta
// invece che con `?debug` nell'URL.
export { isDebug, setDebug } from './state/debug'
