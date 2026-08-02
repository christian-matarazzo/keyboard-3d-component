/**
 * A quali OGGETTI materiale scrive un'azione che ha in mano un insieme di mesh.
 *
 * Estratto da opacityRegistry.js, dove viveva come dettaglio privato, nel
 * momento in cui è nato un SECONDO scrittore di materiali (materialRegistry.js,
 * la tinta di `setMaterial`). Non è una fattorizzazione di comodo: i due
 * registry devono condividere QUESTO stato, o si contendono `mesh.material`.
 *
 * Il problema di fondo resta quello di sempre: `prepareGroupMaterials` clona UN
 * materiale per GRUPPO, quindi le mesh di uno stesso gruppo condividono
 * l'oggetto. Va benissimo per "sfuma tutto il gruppo", è sbagliato per "sfuma 3
 * keycap". Due percorsi:
 *
 *  - FAST PATH — se la selezione contiene TUTTI gli utenti di un materiale (il
 *    caso comune: `allExcept('rotors')` sono 5 materiali di gruppo interi) si
 *    scrive direttamente sul materiale condiviso. Zero cloni, zero
 *    ricompilazioni di shader in più.
 *  - CLONE-ON-WRITE per mesh — sottoinsieme parziale di un materiale condiviso:
 *    ogni mesh selezionata riceve il proprio clone, smontato e distrutto quando
 *    l'ultimo che lo usava lo rilascia.
 *
 * ⚠️ **Il clone è REFCONTATO, e il conto è per MESH, non per registry.** Con
 * due registry indipendenti — ognuno con la propria mappa di cloni — una
 * dissolvenza e una tinta sulle stesse 3 keycap avrebbero creato due cloni in
 * fila (il secondo clonando il primo) e il rilascio del più veloce avrebbe
 * rimesso `mesh.material` al materiale di gruppo, portandosi via l'effetto
 * dell'altro. Silenzioso: nessun errore, solo un colore che sparisce quando
 * finisce una dissolvenza che non c'entra.
 *
 * ⚠️ Il raggruppamento avviene per `mesh.material` COM'È ADESSO, non per il
 * materiale di gruppo originale, e questo è ciò che rende l'ordine degli
 * acquire irrilevante: una mesh già su un clone porta il clone dentro
 * `bySource` come sorgente a sé, con un solo utente, quindi passa dal fast path
 * su quel clone. Chi arriva dopo scrive dove la mesh sta davvero.
 */

export function createMaterialTargets(getScene) {
  // Mesh -> { base, clone, refs }. `refs` conta gli acquire vivi di QUALUNQUE
  // registry, ed è l'unica autorità su quando rimettere `mesh.material` a posto.
  const cloned = new Map()

  /**
   * Mappa materiale -> mesh che lo usano, ricostruita a ogni resolve.
   * È un traverse completo, ma i resolve sono edge-triggered (inizio di uno
   * step), non per-frame — stessa logica di misura di measureGroupFraming.
   */
  const usersByMaterial = () => {
    const map = new Map()
    const scene = getScene()
    if (!scene) return map
    scene.traverse((o) => {
      if (!o.isMesh || o.userData?.__editorHelper) return
      const arr = map.get(o.material)
      if (arr) arr.push(o)
      else map.set(o.material, [o])
    })
    return map
  }

  const cloneFor = (mesh) => {
    const rec = cloned.get(mesh)
    if (rec) {
      rec.refs++
      return rec.clone
    }
    const base = mesh.material
    const clone = base.clone()
    // Il tag di provenienza va copiato, altrimenti prepareGroupMaterials
    // (idempotente proprio grazie a quel tag) riclonerebbe questa mesh al primo
    // ricalcolo che capita mentre il clone è in uso.
    clone.userData.__groupMaterialFor = base.userData?.__groupMaterialFor
    clone.userData.__animCloneOf = base
    mesh.material = clone
    cloned.set(mesh, { base, clone, refs: 1 })
    return clone
  }

  /**
   * Risolve un insieme di mesh nei materiali su cui scrivere davvero.
   * @returns {{ targets: Material[], clonedMeshes: Mesh[] }} — `clonedMeshes` va
   *   restituito a `release()` dallo stesso handle che l'ha ottenuto.
   */
  const resolve = (meshes) => {
    const users = usersByMaterial()
    const bySource = new Map()
    for (const mesh of meshes ?? []) {
      if (!mesh?.material) continue
      const arr = bySource.get(mesh.material)
      if (arr) arr.push(mesh)
      else bySource.set(mesh.material, [mesh])
    }

    const targets = []
    const clonedMeshes = []
    for (const [material, selected] of bySource) {
      const totalUsers = users.get(material)?.length ?? selected.length
      if (selected.length >= totalUsers) {
        targets.push(material)
      } else {
        for (const mesh of selected) {
          targets.push(cloneFor(mesh))
          clonedMeshes.push(mesh)
        }
      }
    }
    return { targets, clonedMeshes }
  }

  /** Restituisce i cloni ottenuti da un resolve: smonta solo l'ultimo a mollare. */
  const release = (meshes) => {
    for (const mesh of meshes ?? []) {
      const rec = cloned.get(mesh)
      if (!rec) continue
      if (--rec.refs > 0) continue
      mesh.material = rec.base
      rec.clone.dispose()
      cloned.delete(mesh)
    }
  }

  /** Rete di sicurezza: nessun clone deve sopravvivere allo smontaggio. */
  const releaseAll = () => {
    for (const [mesh, rec] of [...cloned.entries()]) {
      rec.refs = 1
      release([mesh])
    }
  }

  const stats = () => ({ clonedMeshes: cloned.size })

  return { resolve, release, releaseAll, stats }
}
