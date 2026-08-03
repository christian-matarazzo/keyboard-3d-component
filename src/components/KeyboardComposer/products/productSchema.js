import { createPoseGraph } from '../poseGraph'

/**
 * SCHEMA DI PRODOTTO — un configuratore, più modelli.
 *
 * Tutto ciò che dipende dal MODELLO (e non dal comportamento del
 * configuratore) vive qui dentro, in un solo oggetto dichiarativo:
 *
 *  - `modelUrl`      il GLB da caricare
 *  - `configUrl`     il JSON dello stato autorato (luci per posa, materiali,
 *                    focus, animazioni, sezione app) — vedi LightRig.jsx
 *  - `poseGraph`     pose navigabili + adiacenza + ingressi (poseGraph.js)
 *  - `meshGroups`    classificazione delle mesh in gruppi logici
 *  - `meshVariants`  insiemi di mesh alternative (layout ISO/ANSI, …)
 *
 * ⚠️ I quattro pezzi NON sono indipendenti fra loro, ed è la ragione per cui
 * il prodotto è l'unità sostituibile invece di quattro prop scollegate: il
 * file di configurazione è indicizzato PER CHIAVE DI POSA (`lights`) e PER ID
 * DI GRUPPO (`materials`, `focus`), e le animazioni autorate citano chiavi di
 * posa, id di gruppo e id di variante. Mescolare il pose graph di un modello
 * con i gruppi di un altro produce un JSON che carica a metà, in silenzio.
 * Un prodotto = un GLB + un JSON + i tre elenchi che li indicizzano.
 *
 * Perché ANCHE un registro con id enumerativi (`PRODUCT_IDS` in `index.js`) e
 * non solo una prop con l'oggetto: gli id sono ciò che finisce in un query
 * param, in un attributo del sito ospite o in un campo del CMS — cioè dove
 * passa una stringa, non un modulo. `resolveProduct` accetta entrambe le
 * forme, più un terzo caso (oggetto di override parziali) che serve a chi
 * integra il componente e vuole cambiare un solo pezzo senza riscrivere il
 * prodotto: `<KeyboardComposer product={{ ...ARRAY_MODEL_L, modelUrl: '…' }} />`.
 *
 * ⚠️ Niente `selection` delle varianti qui dentro: quale layout è acceso è
 * stato dell'UTENTE (sessionStorage), non configurazione di prodotto — vedi
 * il commento lungo in KeyboardComposer.jsx.
 */

/**
 * @typedef {Object} ProductDef  come lo si scrive
 * @property {string} id            chiave enumerativa (SCREAMING_SNAKE_CASE)
 * @property {string} [label]       nome leggibile (UI di debug, selettori)
 * @property {string} modelUrl      percorso del GLB
 * @property {string} [configUrl]   JSON dello stato autorato; default
 *   `/lightconfig/<id>/app-state-config.json`
 * @property {import('../poseGraph').PoseGraphDef} poseGraph
 * @property {import('../materials/meshGroups').MeshGroup[]} meshGroups
 * @property {import('../materials/meshVariants').MeshVariant[]} [meshVariants]
 */

/**
 * @typedef {Object} Product  come lo si consuma (congelato)
 * @property {string} id
 * @property {string} label
 * @property {string} modelUrl
 * @property {string} configUrl
 * @property {import('../poseGraph').PoseGraph} poseGraph  già costruito
 * @property {Object[]} meshGroups
 * @property {Object[]} meshVariants
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Percorso del decoder Draco quando un prodotto non ne dichiara uno.
 * Esportato perché `preloadKeyboardModel` deve poter pre-scaldare con LO STESSO
 * valore: la cache di drei è indicizzata per `(url, dracoPath)`, quindi un
 * default duplicato a mano che diverga da questo significherebbe due decoder e
 * due scaricamenti dello stesso GLB.
 */
export const DEFAULT_DRACO_PATH = '/draco/'

/**
 * Valida e congela una definizione di prodotto, costruendo il pose graph.
 *
 * Le due verifiche di coerenza (`homePose` esistente, id di gruppo unici) non
 * sono paranoia: sono esattamente i due modi in cui un prodotto nuovo si
 * rompe in silenzio invece che rumorosamente — una posa home inesistente
 * lascia il modello sull'ingresso di fallback senza dire niente, e due gruppi
 * con lo stesso id si sovrascrivono a vicenda in `materials`/`focus`.
 */
export function defineProduct(def) {
  if (!isPlainObject(def)) throw new Error('[product] definizione non valida')
  const { id } = def
  if (typeof id !== 'string' || !id) throw new Error('[product] manca `id`')
  if (typeof def.modelUrl !== 'string' || !def.modelUrl)
    throw new Error(`[product:${id}] manca \`modelUrl\``)
  if (!Array.isArray(def.meshGroups) || def.meshGroups.length === 0)
    throw new Error(`[product:${id}] \`meshGroups\` deve essere un elenco non vuoto`)

  const seen = new Set()
  for (const g of def.meshGroups) {
    if (!g?.id) throw new Error(`[product:${id}] un gruppo di mesh è senza \`id\``)
    if (seen.has(g.id)) throw new Error(`[product:${id}] id di gruppo duplicato: ${g.id}`)
    seen.add(g.id)
  }

  // Il pose graph può arrivare già costruito (un prodotto derivato da un altro
  // lo riusa così com'è) o come descrizione da costruire.
  const poseGraph = def.poseGraph?.findPoseKey
    ? def.poseGraph
    : createPoseGraph({ id, ...def.poseGraph })

  // ⚠️ La base si applica solo agli URL RELATIVI alla radice (`/models/…`), che
  // sono quelli che questo repo dichiara. Un URL assoluto (già su una CDN) o
  // uno relativo al documento passa intatto: chi lo scrive per esteso sa dove
  // sta andando, e riscriverglielo sarebbe una sorpresa.
  const base = def.assetsBaseUrl ? String(def.assetsBaseUrl).replace(/\/$/, '') : ''
  const withBase = (url) => (base && typeof url === 'string' && url.startsWith('/') ? base + url : url)

  return Object.freeze({
    id,
    label: def.label ?? id,
    // Dove stanno gli asset del prodotto. Serve a chi installa il pacchetto e
    // serve GLB, JSON e decoder da un'altra origine (una CDN, un sottopercorso)
    // invece che dalla radice del proprio sito.
    assetsBaseUrl: base || null,
    modelUrl: withBase(def.modelUrl),
    configUrl: withBase(def.configUrl ?? `/lightconfig/${id}/app-state-config.json`),
    // ⚠️ Il decoder Draco entra nella CHIAVE DI CACHE di drei insieme all'URL:
    // due percorsi diversi fra i chiamanti di `useGLTF` significano due decoder
    // e due scaricamenti dello stesso GLB. Sta qui, congelato dentro il
    // prodotto, proprio perché così tutti i chiamanti ne ricevono uno solo
    // per costruzione — era un globale di modulo in KeyboardModel.jsx, scritto
    // durante il render, e due prodotti sulla stessa pagina se lo
    // sovrascrivevano a vicenda.
    dracoPath: withBase(def.dracoPath ?? DEFAULT_DRACO_PATH),
    poseGraph,
    meshGroups: Object.freeze([...def.meshGroups]),
    meshVariants: Object.freeze([...(def.meshVariants ?? [])]),
  })
}

/**
 * Porta a un `Product` congelato qualunque forma sia stata passata come prop:
 * un id del registro, un prodotto già definito, o una definizione grezza.
 *
 * ⚠️ C'era un terzo parametro, `overrides`, che applicava le prop legacy di
 * `KeyboardComposer` (`modelUrl`/`meshGroups`/`meshVariants`/`assetsBaseUrl`/
 * `dracoPath`). Nessuno lo usava: zero chiamanti nel repo, e il pacchetto non
 * è mai stato pubblicato. Non serviva nemmeno come scorciatoia, perché lo
 * stesso risultato si ottiene già con una definizione derivata —
 * `product={{ ...ARRAY_MODEL_L, modelUrl: '…' }}` — che passa da qui e viene
 * validata da `defineProduct` come qualunque altro prodotto. Cioè: una seconda
 * strada per fare la stessa cosa, con in più il rischio che le due divergano.
 *
 * `lookup` è iniettato (non importato) per non creare un ciclo con il registro
 * in `index.js`, che a sua volta importa questo file.
 */
export function resolveProduct(source, lookup = null) {
  let base = source
  if (typeof source === 'string') {
    base = lookup?.(source)
    if (!base) throw new Error(`[product] id sconosciuto nel registro: ${source}`)
  }
  if (!base) throw new Error('[product] nessun prodotto indicato')

  // Un prodotto del registro è già congelato e validato: si passa lo STESSO
  // oggetto — l'identità stabile conta, è dipendenza di effetti e di useMemo a
  // valle. Una definizione grezza va invece validata e congelata ora.
  if (base.poseGraph?.findPoseKey) return base

  return defineProduct(base)
}
