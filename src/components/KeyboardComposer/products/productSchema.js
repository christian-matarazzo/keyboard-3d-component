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

  return Object.freeze({
    id,
    label: def.label ?? id,
    modelUrl: def.modelUrl,
    configUrl: def.configUrl ?? `/lightconfig/${id}/app-state-config.json`,
    poseGraph,
    meshGroups: Object.freeze([...def.meshGroups]),
    meshVariants: Object.freeze([...(def.meshVariants ?? [])]),
  })
}

/**
 * Porta a un `Product` congelato qualunque forma sia stata passata come prop:
 * un id del registro, un prodotto già definito, o una definizione grezza.
 * `overrides` applica le prop legacy di `KeyboardComposer`
 * (`modelUrl`/`meshGroups`/`meshVariants`), che restano supportate come
 * scorciatoia per chi vuole cambiare un pezzo senza dichiarare un prodotto.
 *
 * `lookup` è iniettato (non importato) per non creare un ciclo con il registro
 * in `index.js`, che a sua volta importa questo file.
 */
export function resolveProduct(source, overrides = {}, lookup = null) {
  let base = source
  if (typeof source === 'string') {
    base = lookup?.(source)
    if (!base) throw new Error(`[product] id sconosciuto nel registro: ${source}`)
  }
  if (!base) throw new Error('[product] nessun prodotto indicato')

  const patch = {}
  for (const key of ['modelUrl', 'meshGroups', 'meshVariants'])
    if (overrides[key] !== undefined) patch[key] = overrides[key]

  // Nessun override: il prodotto del registro è già congelato e validato, si
  // passa lo stesso oggetto — l'identità stabile conta, è dipendenza di effetti
  // e di useMemo a valle.
  if (Object.keys(patch).length === 0 && base.poseGraph?.findPoseKey) return base

  return defineProduct({ ...base, ...patch })
}
