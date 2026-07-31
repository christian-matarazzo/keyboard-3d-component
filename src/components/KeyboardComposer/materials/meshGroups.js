/**
 * Classificazione delle mesh in gruppi logici — la MACCHINA, non i dati.
 *
 * Questo file non conosce nessun gruppo: riceve sempre l'elenco del prodotto
 * attivo (`product.meshGroups`, vedi `products/`). L'elenco di ARRAY_MODEL_L
 * sta in `products/arrayModelL/meshGroups.js`.
 *
 * Usata da:
 *  - materials/groupMaterials.js (scoperta/clonazione materiali per gruppo)
 *  - Scene.jsx (un folder Leva "Materiale · <label>" per gruppo)
 *  - MeshController.jsx (doppio selettore Gruppo/Mesh, pivot su centro di
 *    massa cumulativo per i gruppi)
 *  - focusFraming.js e animation/selectors.js
 *
 * ⚠️ `groups` NON ha più un default: prima ricadeva sull'elenco di
 * ARRAY_MODEL_L, il che con più prodotti significa classificare il modello
 * sbagliato in silenzio. Senza default, un chiamante che dimentica di passarlo
 * esplode subito — è il comportamento voluto.
 */

/**
 * @typedef {Object} MeshGroup
 * @property {string} id - chiave stabile: usata come chiave in
 *   window.__STATE_MATERIALS, come folder Leva e come indice delle sezioni
 *   `materials`/`focus` del JSON di configurazione del prodotto.
 * @property {string} label - etichetta leggibile: dropdown mesh/gruppo di
 *   MeshController e nome del folder Leva ("Materiale · <label minuscolo>").
 * @property {string[]} [nameTokens] - substring del nome nodo che assegna
 *   una mesh a questo gruppo (i nomi possono includere prefissi della
 *   gerarchia Maya, quindi si confronta con includes()).
 * @property {boolean} [fallback] - bucket delle mesh che non matchano nulla.
 *   Uno solo per prodotto; se manca vince il primo gruppo dell'elenco.
 */

/**
 * Id del gruppo di raccolta: dichiarato NELL'ELENCO (`fallback: true`) invece
 * che passato a ogni chiamata. È un fatto del modello — quale gruppo è
 * abbastanza generico da accogliere l'ignoto — non della funzione che
 * classifica, e come parametro avrebbe dovuto attraversare ogni singolo
 * chiamante di `collectMeshGroups` per restare corretto con più prodotti.
 * Resta comunque sovrascrivibile per chiamata.
 */
export const fallbackGroupIdOf = (groups) =>
  groups.find((g) => g.fallback)?.id ?? groups[0]?.id ?? null

/**
 * Traversa la scena una sola volta e raggruppa le mesh per gruppo logico
 * (`{ [groupId]: THREE.Mesh[] }`, un array per OGNI id in `groups`, anche se
 * vuoto). Attiva anche cast/receive shadow su ogni mesh.
 */
export function collectMeshGroups(scene, groups, fallbackGroupId = fallbackGroupIdOf(groups)) {
  const result = {}
  for (const group of groups) result[group.id] = []

  scene.traverse((obj) => {
    if (!obj.isMesh) return
    // Impalcature dell'editor (halo di selezione di MeshController.jsx):
    // sono figlie delle mesh vere, quindi finirebbero classificate in un
    // gruppo (e nel dropdown mesh) a ogni ricalcolo che avvenga mentre una
    // selezione è attiva. Non sono geometria del prodotto: si saltano.
    if (obj.userData?.__editorHelper) return
    // Variante non scelta (vedi materials/meshVariants.js): geometria vera ma
    // spenta. Va saltata o l'ISO nascosto continuerebbe a contare
    // nell'inquadratura di un gruppo, nelle dissolvenze e nel dropdown mesh.
    if (obj.userData?.__variantHidden) return
    obj.castShadow = true
    obj.receiveShadow = true

    const hit = groups.find((g) => (g.nameTokens ?? []).some((token) => obj.name.includes(token)))
    const groupId = hit ? hit.id : fallbackGroupId
    result[groupId] ??= []
    result[groupId].push(obj)
  })

  return result
}

/**
 * Appiattisce collectMeshGroups in un elenco selezionabile (mesh selector di
 * MeshController): stessa logica di enumerazione/classificazione, solo
 * appiattita e ordinata per gruppo (nell'ordine di `groups`) poi nome, con
 * suffisso di disambiguazione per i nomi duplicati (le option Leva
 * richiedono chiavi uniche).
 */
export function collectMeshList(scene, groups, fallbackGroupId = fallbackGroupIdOf(groups)) {
  const byGroup = collectMeshGroups(scene, groups, fallbackGroupId)
  const seen = new Map()
  const list = []
  for (const group of groups) {
    const meshes = [...(byGroup[group.id] ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    for (const mesh of meshes) {
      const base = mesh.name || mesh.uuid.slice(0, 8)
      const count = (seen.get(base) || 0) + 1
      seen.set(base, count)
      const name = count > 1 ? `${base} (${count})` : base
      list.push({ uuid: mesh.uuid, label: `${group.label} · ${name}`, mesh })
    }
  }
  return list
}
