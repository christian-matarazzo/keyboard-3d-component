export { default } from './KeyboardComposer'
export { default as KeyboardComposer } from './KeyboardComposer'
export { preloadKeyboardModel } from './KeyboardModel'

// Registro dei prodotti — il tipo enumerativo del configuratore. Chi integra
// il componente sceglie un modello con `product={PRODUCT_IDS.ARRAY_MODEL_L}`
// (o la stringa equivalente), oppure ne dichiara uno proprio con
// `defineProduct` — vedi products/productSchema.js.
export {
  PRODUCTS,
  PRODUCT_IDS,
  PRODUCT_LIST,
  DEFAULT_PRODUCT_ID,
  getProduct,
  isProductId,
  resolveProduct,
  defineProduct,
  ARRAY_MODEL_L,
} from './products'

// Fabbrica del grafo delle pose: serve a chi dichiara un prodotto nuovo e
// vuole costruirne il grafo a parte (in `defineProduct` basta passarne la
// descrizione, la fabbrica viene chiamata da lì).
export { createPoseGraph } from './poseGraph'
