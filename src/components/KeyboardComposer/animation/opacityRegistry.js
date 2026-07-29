/**
 * Layer di override dell'OPACITÀ a runtime — l'unico posto in cui l'opacità
 * viene scritta al di fuori dell'editor mesh.
 *
 * Perché non passa da `applyMaterialProps` (materials/groupMaterials.js):
 * aggiungere lì `opacity`/`transparent` le farebbe comparire in ogni folder
 * Leva `Materiale · <gruppo>`, in `window.__STATE_MATERIALS` e quindi in ogni
 * JSON salvato — e l'effetto di apply di MaterialGroupTuner rigira a ogni
 * cambio di quei valori. Sarebbero due proprietari della stessa proprietà, col
 * tuner che vince a momenti imprevedibili. Tenendola fuori, `applyMaterialProps`
 * scrive solo color/roughness/metalness/envMapIntensity/clearcoat/
 * clearcoatRoughness: muovere uno slider materiale durante un'animazione non
 * può sporcare un fade in corso. Ortogonali per costruzione, non per
 * disciplina.
 *
 * Il problema da risolvere: `prepareGroupMaterials` clona UN materiale per
 * GRUPPO, quindi le mesh di uno stesso gruppo condividono l'oggetto materiale.
 * Va benissimo per "sfuma tutto il gruppo", è sbagliato per "sfuma 3 keycap".
 * Due percorsi:
 *
 *  - FAST PATH — se la selezione contiene TUTTI gli utenti di un materiale
 *    (il caso comune: `allExcept('rotors')` sono 5 materiali di gruppo interi)
 *    si scrive direttamente sul materiale condiviso. Zero cloni, zero
 *    ricompilazioni di shader in più.
 *  - CLONE-ON-WRITE per mesh — sottoinsieme parziale di un materiale
 *    condiviso: ogni mesh selezionata riceve il proprio clone, ripristinato e
 *    distrutto al release.
 *
 * ⚠️ Disciplina anti-ricompilazione: `transparent`/`depthWrite`/`needsUpdate`
 * si toccano SOLO all'acquire e al release. Durante il fade si scrive solo
 * `material.opacity`, che è una uniform. Lo slider di MeshController.jsx fa
 * `needsUpdate = true` a ogni cambio: innocuo alla cadenza di un mouse,
 * disastroso per-frame con ~34 luci in forward rendering (vedi la nota sulla
 * ricompilazione degli shader in CLAUDE.md).
 */

export function createOpacityRegistry(getScene) {
  // Materiale (oggetto) -> stato posseduto. La chiave è l'oggetto su cui si
  // scrive davvero: o quello condiviso (fast path) o il clone per-mesh.
  const owned = new Map() // Material -> { prevOpacity, prevTransparent, prevDepthWrite, refs }
  // Mesh -> clone creato per lei (solo percorso clone-on-write).
  const cloned = new Map() // Mesh -> { base: Material, clone: Material }

  /**
   * Mappa materiale -> mesh che lo usano, ricostruita a ogni acquire.
   * È un traverse completo, ma gli acquire sono edge-triggered (inizio di uno
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

  const own = (material, depthWrite) => {
    const rec = owned.get(material)
    if (rec) {
      // ⚠️ NON ri-fotografare: un secondo acquire sullo stesso materiale
      // catturerebbe come "originale" il valore già scritto dal primo, e il
      // ripristino finale sarebbe sbagliato. È lo stesso bug che il dedup per
      // identità di materiale in MeshController.jsx previene fra mesh, qui
      // generalizzato nel tempo invece che nello spazio.
      rec.refs++
      return material
    }
    owned.set(material, {
      prevOpacity: material.opacity,
      prevTransparent: material.transparent,
      prevDepthWrite: material.depthWrite,
      refs: 1,
    })
    material.transparent = true
    material.depthWrite = depthWrite
    material.needsUpdate = true
    return material
  }

  const cloneFor = (mesh) => {
    const existing = cloned.get(mesh)
    if (existing) return existing.clone
    const base = mesh.material
    const clone = base.clone()
    // Il tag di provenienza va copiato, altrimenti prepareGroupMaterials
    // (idempotente proprio grazie a quel tag) riclonerebbe questa mesh al
    // primo ricalcolo che capita mentre il clone è in uso.
    clone.userData.__groupMaterialFor = base.userData?.__groupMaterialFor
    clone.userData.__animCloneOf = base
    mesh.material = clone
    cloned.set(mesh, { base, clone })
    return clone
  }

  const disown = (material) => {
    const rec = owned.get(material)
    if (!rec) return
    if (--rec.refs > 0) return
    material.opacity = rec.prevOpacity
    material.transparent = rec.prevTransparent
    material.depthWrite = rec.prevDepthWrite
    material.needsUpdate = true
    owned.delete(material)
  }

  const releaseClones = (meshes) => {
    for (const mesh of meshes) {
      const rec = cloned.get(mesh)
      if (!rec) continue
      // Se il clone è ancora posseduto da un altro handle non va smontato: il
      // refcount di `owned` è l'autorità.
      if (owned.has(rec.clone)) continue
      mesh.material = rec.base
      rec.clone.dispose()
      cloned.delete(mesh)
    }
  }

  /**
   * Prende possesso dell'opacità delle mesh indicate.
   * @returns handle con readCurrent()/set()/lerpTo()/release()
   */
  const acquire = (meshes, { depthWrite = true } = {}) => {
    const users = usersByMaterial()
    const bySourceMaterial = new Map()
    for (const mesh of meshes) {
      if (!mesh?.material) continue
      const arr = bySourceMaterial.get(mesh.material)
      if (arr) arr.push(mesh)
      else bySourceMaterial.set(mesh.material, [mesh])
    }

    const targets = []
    const clonedMeshes = []
    for (const [material, selected] of bySourceMaterial) {
      const totalUsers = users.get(material)?.length ?? selected.length
      if (selected.length >= totalUsers) {
        targets.push(own(material, depthWrite))
      } else {
        for (const mesh of selected) {
          targets.push(own(cloneFor(mesh), depthWrite))
          clonedMeshes.push(mesh)
        }
      }
    }

    let released = false
    return {
      materials: targets,
      /** Snapshot dei valori correnti, per interpolare DA dove si è ora. */
      readCurrent() {
        return targets.map((m) => m.opacity)
      },
      /** Scrive solo `opacity` — nessun needsUpdate, vedi la nota in testa. */
      set(value) {
        for (const m of targets) m.opacity = value
      },
      lerpTo(from, to, k) {
        for (let i = 0; i < targets.length; i++) {
          const a = from?.[i] ?? targets[i].opacity
          targets[i].opacity = a + (to - a) * k
        }
      },
      release() {
        if (released) return
        released = true
        for (const m of targets) disown(m)
        releaseClones(clonedMeshes)
      },
    }
  }

  /** Rete di sicurezza: rilascia tutto, usata allo smontaggio del director. */
  const releaseAll = () => {
    for (const material of [...owned.keys()]) {
      const rec = owned.get(material)
      rec.refs = 1
      disown(material)
    }
    releaseClones([...cloned.keys()])
  }

  const stats = () => ({ ownedMaterials: owned.size, clonedMeshes: cloned.size })

  return { acquire, releaseAll, stats }
}
