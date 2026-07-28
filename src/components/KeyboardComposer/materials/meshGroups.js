/**
 * Definizione dei gruppi di mesh: unica fonte di verità per come il modello
 * viene classificato in gruppi logici. Usata da:
 *  - materials/groupMaterials.js (scoperta/clonazione materiali per gruppo,
 *    generico — non conosce i nomi dei gruppi, riceve solo l'elenco)
 *  - Scene.jsx (un folder Leva "Materiale · <label>" per gruppo)
 *  - MeshController.jsx (doppio selettore Gruppo/Mesh, pivot su centro di
 *    massa cumulativo per i gruppi)
 *
 * Disaccoppiata dal resto: chi integra il componente può passare un proprio
 * elenco (prop `meshGroups` su KeyboardComposer → Scene → KeyboardModel/
 * MeshController) per classificare un GLB con convenzioni di naming diverse.
 *
 * Classificazione PURAMENTE per nome nodo (nameTokens, substring match): non
 * più per nome materiale. Più gruppi possono condividere lo stesso materiale
 * Maya (es. body/rotors/tasselli condividono standardSurface3SG in questo
 * asset) ed erano comunque disambiguati solo dal nome nodo, quindi il doppio
 * binario materiale+nodo era macchinario in più per un problema che il solo
 * nameTokens risolve già direttamente — ed elimina la classe di bug per cui
 * un nome materiale "vince" ignorando un nameTokens più specifico (una mesh
 * chiamata "..._Tasselli_..." finiva silenziosamente in `damping` perché
 * condivideva il materiale di damping, standardSurface2SG, nonostante il
 * nome nodo indicasse chiaramente `tasselli`).
 */

/**
 * @typedef {Object} MeshGroup
 * @property {string} id - chiave stabile: usata come chiave in
 *   window.__STATE_MATERIALS e come folder Leva.
 * @property {string} label - etichetta leggibile: dropdown mesh/gruppo di
 *   MeshController e nome del folder Leva ("Materiale · <label minuscolo>").
 * @property {string[]} [nameTokens] - substring del nome nodo che assegna
 *   una mesh a questo gruppo (i nomi possono includere prefissi della
 *   gerarchia Maya, quindi si confronta con includes()).
 */

/** @type {MeshGroup[]} */
export const DEFAULT_MESH_GROUPS = [
  { id: 'keycaps', label: 'Keycaps', nameTokens: ['Keycaps'] },
  { id: 'body', label: 'Body', nameTokens: ['S0'] },
  { id: 'damping', label: 'Damping', nameTokens: ['Damping'] },
  { id: 'rotors', label: 'Rotors', nameTokens: ['Rotor'] },
  { id: 'tasselli', label: 'Tasselli', nameTokens: ['Tasselli'] },
  { id: 'landing', label: 'Rialzo', nameTokens: ['Rialzo'] },
]

// Id di fallback quando nessun nameTokens matcha — deve essere un id
// presente in `groups`, altrimenti la mesh finisce comunque in un bucket
// valido (creato al volo) ma "invisibile" agli elenchi ordinati per gruppo.
const DEFAULT_FALLBACK_GROUP_ID = 'body'

/**
 * Traversa la scena una sola volta e raggruppa le mesh per gruppo logico
 * (`{ [groupId]: THREE.Mesh[] }`, un array per OGNI id in `groups`, anche se
 * vuoto). Attiva anche cast/receive shadow su ogni mesh.
 */
export function collectMeshGroups(scene, groups = DEFAULT_MESH_GROUPS, fallbackGroupId = DEFAULT_FALLBACK_GROUP_ID) {
  const result = {}
  for (const group of groups) result[group.id] = []

  scene.traverse((obj) => {
    if (!obj.isMesh) return
    // Impalcature dell'editor (halo di selezione di MeshController.jsx):
    // sono figlie delle mesh vere, quindi finirebbero classificate in un
    // gruppo (e nel dropdown mesh) a ogni ricalcolo che avvenga mentre una
    // selezione è attiva. Non sono geometria del prodotto: si saltano.
    if (obj.userData?.__editorHelper) return
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
export function collectMeshList(scene, groups = DEFAULT_MESH_GROUPS, fallbackGroupId = DEFAULT_FALLBACK_GROUP_ID) {
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
