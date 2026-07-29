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

/**
 * Sopra questa opacità un materiale in dissolvenza continua a scrivere nel
 * depth buffer, sotto smette.
 *
 * ⚠️ **Il valore è un compromesso misurato, non una costante arbitraria: se lo
 * tocchi, sappi cosa stai scambiando.** Il cambio di modalità è per forza una
 * discontinuità — non esiste un'opacità in cui le due immagini coincidano, anzi
 * divergono di PIÙ verso l'opaco (a opacità 1 differiscono di 76 di delta medio
 * su 13.597 pixel, a 0.5 di 41). Alzare la soglia rende il salto più visibile,
 * abbassarla lo rimpicciolisce ma lascia più dissolvenza al regime che produce
 * lo sfarfallio. Misurato su questa scena, contro il ~4 di delta medio di un
 * normale passo di dissolvenza a 60 fps:
 *
 *     soglia   0.95   0.5   0.3   0.2   0.06
 *     salto      69    41    31    23      9
 *
 * A 0.95 il salto valeva ~17 passi di dissolvenza in un frame solo e si vedeva
 * come uno scatto; a 0.2 ne vale ~5. Sotto 0.1 diventa impercettibile ma il
 * depth write resta acceso per oltre il 90% della dissolvenza, cioè si torna
 * di fatto al comportamento che aveva l'artefatto.
 *
 * Vicoli ciechi già esplorati, per non ripercorrerli: `alphaHash` (transizione
 * continua per costruzione — a opacità 1 è pixel-identico all'opaco — e
 * indipendente dall'ordine, ma la grana stocastica senza accumulazione
 * temporale è troppo evidente su questo prodotto), e spegnere il depth write
 * già all'acquire (stesso salto, solo spostato all'inizio: 76 invece di 23).
 *
 * ⚠️ Non è una rifinitura: `depthWrite: true` su un insieme di mesh che si
 * compenetrano è ESATTAMENTE il caso in cui il disegno dipende dall'ordine.
 * Le trasparenti vengono ordinate per distanza a ogni frame, quindi la prima
 * disegnata scrive depth e ritaglia le altre — e l'ordine cambia mentre la
 * camera si muove, che durante un'animazione succede sempre. Risultato: pezzi
 * che sfarfallano l'uno dentro l'altro. Misurato sugli 80 keycap (un solo
 * materiale condiviso) a metà dissolvenza: spegnere depthWrite cambia 28.076
 * pixel, il 2,7% del frame, con delta medio 72/765.
 *
 * Perché una soglia e non `false` e basta: a opacità quasi piena l'oggetto è a
 * tutti gli effetti solido, e NON scrivere depth si vede altrettanto (facce
 * interne e posteriori che traspaiono attraverso quelle davanti). La soglia
 * tiene il comportamento da opaco finché è indistinguibile e passa a quello da
 * trasparente appena la trasparenza è percepibile.
 */
const DEPTH_WRITE_MIN = 0.2

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
      // Ciò che il chiamante CHIEDE. Quello che il materiale fa davvero è
      // questo AND la soglia di opacità — vedi syncDepthWrite.
      wantDepthWrite: depthWrite,
      refs: 1,
    })
    material.transparent = true
    material.depthWrite = depthWrite
    material.needsUpdate = true
    return material
  }

  /**
   * Riallinea `depthWrite` all'opacità corrente. Va chiamata da ogni percorso
   * che scrive opacità.
   *
   * ⚠️ È l'UNICA eccezione alla disciplina "durante il fade si scrive solo
   * opacity", ed è sicura: `depthWrite` è uno stato del renderer letto al
   * momento del disegno, non un define dello shader — cambiarlo non ricompila
   * nulla. Ciò che ricompila è `needsUpdate`, che qui infatti non si tocca. E
   * si scrive solo quando il valore cambia davvero, cioè un paio di volte per
   * dissolvenza, non a ogni frame.
   */
  const syncDepthWrite = (material) => {
    const rec = owned.get(material)
    if (!rec) return
    const want = rec.wantDepthWrite && material.opacity >= DEPTH_WRITE_MIN
    if (material.depthWrite !== want) material.depthWrite = want
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
      /** Scrive `opacity` (+ il riallineamento di depthWrite) — mai needsUpdate. */
      set(value) {
        for (const m of targets) {
          m.opacity = value
          syncDepthWrite(m)
        }
      },
      lerpTo(from, to, k) {
        for (let i = 0; i < targets.length; i++) {
          const a = from?.[i] ?? targets[i].opacity
          targets[i].opacity = a + (to - a) * k
          syncDepthWrite(targets[i])
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

  /**
   * Ripristino GRADUALE di tutto ciò che è sotto override, per l'azione
   * "Torna all'insieme": riporta ogni materiale dal valore che ha adesso a
   * quello fotografato all'acquire (in pratica 1 per questo asset, ma si usa lo
   * snapshot e non un 1 letterale, così un materiale autorato semi-trasparente
   * nel GLB non viene "riparato" per sbaglio).
   *
   * Il rilascio vero avviene solo a interpolazione finita (`finish()`):
   * rilasciare subito farebbe scattare il valore di partenza in un frame,
   * che è esattamente ciò che si vuole evitare.
   */
  const beginRestoreAll = () => {
    const targets = [...owned.keys()]
    const from = targets.map((m) => m.opacity)
    const to = targets.map((m) => owned.get(m).prevOpacity)
    let finished = false
    return {
      empty: targets.length === 0,
      get done() {
        return finished
      },
      /**
       * Quanti dei materiali fotografati sono ANCORA posseduti. Serve a chi
       * apre un ripristino e poi lascia che qualcun altro smonti nel mezzo
       * (vedi lo smontaggio morbido in animationRuntime.js): se non ne resta
       * nessuno non c'è nessuna dissolvenza da aspettare.
       */
      get remaining() {
        let n = 0
        for (const m of targets) if (owned.has(m)) n++
        return n
      },
      lerp(k) {
        if (finished) return
        for (let i = 0; i < targets.length; i++) {
          // Un materiale rilasciato nel frattempo da chi lo possedeva (lo
          // scambio di varianti chiude sempre la propria dissolvenza) è già
          // tornato al suo valore e non è più `transparent`: continuare a
          // scriverci sopra non si vedrebbe, ma è comunque una bugia.
          if (!owned.has(targets[i])) continue
          targets[i].opacity = from[i] + (to[i] - from[i]) * k
          // Risalendo verso l'opaco il depth write torna da sé alla soglia.
          syncDepthWrite(targets[i])
        }
      },
      finish() {
        if (finished) return
        finished = true
        releaseAll()
      },
    }
  }

  const stats = () => ({ ownedMaterials: owned.size, clonedMeshes: cloned.size })

  return { acquire, releaseAll, beginRestoreAll, stats }
}
