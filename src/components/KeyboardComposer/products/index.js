import { defineProduct, resolveProduct as resolveProductBase } from './productSchema'
import { ARRAY_MODEL_L } from './arrayModelL'

/**
 * REGISTRO DEI PRODOTTI — il "tipo enumerativo" del configuratore.
 *
 * Aggiungere un modello è: una cartella sotto `products/`, un
 * `defineProduct({...})`, una riga qui. Nient'altro nel componente conosce i
 * nomi dei gruppi, le chiavi delle pose o il percorso del GLB.
 *
 * `PRODUCT_IDS` è la forma enumerativa vera e propria (oggetto congelato
 * chiave→stringa): serve a scriverne uno senza ricordarsi la stringa esatta
 * (`PRODUCT_IDS.ARRAY_MODEL_L`) e a validare ciò che arriva da fuori — un
 * query param, un attributo del sito ospite, un campo del CMS.
 */

export const PRODUCTS = Object.freeze({
  [ARRAY_MODEL_L.id]: ARRAY_MODEL_L,
})

export const PRODUCT_IDS = Object.freeze(
  Object.fromEntries(Object.keys(PRODUCTS).map((id) => [id, id])),
)

// Prodotto di default del componente: finché ce n'è uno solo è lui, e resta
// il fallback quando non viene indicato niente.
export const DEFAULT_PRODUCT_ID = PRODUCT_IDS.ARRAY_MODEL_L

/**
 * Prodotto per id, o `null` se l'id non è nel registro. Locale: serve solo a
 * iniettare il registro dentro `resolveProduct` qui sotto.
 *
 * ⚠️ Qui vivevano anche `PRODUCT_LIST` (`Object.values(PRODUCTS)`) e
 * `isProductId`, entrambi esportati dalla radice del pacchetto e con ZERO
 * chiamanti — dentro il repo e fuori. Erano superficie pubblica scritta per un
 * bisogno immaginato: con un prodotto solo, "l'elenco dei prodotti" è una lista
 * di uno e "valida questo id" è un confronto con una stringa. Entrambi si
 * riottengono in una riga da `PRODUCTS`, che resta esportato; il momento di
 * riaggiungerli è quando esiste un secondo modello E qualcuno li chiama.
 */
const getProduct = (id) => PRODUCTS[id] ?? null

/**
 * Come `resolveProduct` dello schema, ma con il registro già agganciato: è la
 * forma che usa `KeyboardComposer.jsx`. Accetta un id, un prodotto già
 * definito, una definizione grezza o `null`/`undefined` (→ default).
 */
export function resolveProduct(source) {
  return resolveProductBase(source ?? DEFAULT_PRODUCT_ID, getProduct)
}

export { defineProduct }
export { ARRAY_MODEL_L }
