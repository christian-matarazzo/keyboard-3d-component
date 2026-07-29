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

/**
 * ⚠️ L'ORDINE DI QUESTO ARRAY È SIGNIFICATIVO: `collectMeshGroups` usa
 * `groups.find(...)`, quindi vince il PRIMO gruppo che matcha. È l'ordine, non
 * i token, il modo previsto per disambiguare i casi in cui più regole
 * potrebbero rivendicare la stessa mesh.
 *
 * Due dipendenze concrete da questo ordine:
 *  - `patchesISO`/`patchesANSI` PRIMA di `body`: le mesh delle varianti si
 *    chiamano `…S05_L_ISO…`, quindi il token `S0` di `body` le rivendicherebbe
 *    per primo e i patch non avrebbero mai un gruppo proprio.
 *  - `damping` prima di `landing`: `Damping_Foots_Rialzo` contiene entrambi i
 *    token e appartiene al damping.
 *
 * ⚠️ I token vanno confrontati con i nomi che GLTFLoader produce A RUNTIME, non
 * con quelli del file: il loader sostituisce gli spazi con underscore e
 * aggiunge suffissi di deduplica (`L_ARRAY S05_L_ISO` → `L_ARRAY_S05_L_ISO_1`).
 * Token come `S01_1` sembrano plausibili leggendo il GLB ma non matchano nulla
 * a runtime, dove i nomi sono `L_ARRAY_S01`; le mesh finirebbero nel gruppo
 * giusto solo per via del fallback, cioè per caso.
 *
 * @type {MeshGroup[]}
 */
export const DEFAULT_MESH_GROUPS = [
  { id: 'keycaps', label: 'Keycaps', nameTokens: ['Keycaps'] },
  { id: 'patchesISO', label: 'PatchSystemISO', nameTokens: ['ISO'] },
  { id: 'patchesANSI', label: 'PatchSystemANSI', nameTokens: ['ANSI'] },
  { id: 'body', label: 'Body', nameTokens: ['S0'] },
  { id: 'damping', label: 'Damping', nameTokens: ['Damping'] },
  { id: 'rotors', label: 'Rotors', nameTokens: ['Rotor'] },
  { id: 'tasselli', label: 'Tasselli', nameTokens: ['Tasselli'] },
  { id: 'landing', label: 'Rialzo', nameTokens: ['Rialzo'] },
  { id: 'viti', label: 'Viti', nameTokens: ['M3_'] },
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
