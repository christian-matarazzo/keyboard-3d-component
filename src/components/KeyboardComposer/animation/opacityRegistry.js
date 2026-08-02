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
 * A QUALI oggetti materiale si scrive — fast path sul materiale di gruppo
 * condiviso oppure clone-on-write per mesh — non lo decide più questo file: lo
 * decide `materialTargets.js`, condiviso con `materialRegistry.js`. I due
 * registry devono partire dalla stessa mappa di cloni, o si contendono
 * `mesh.material` (la ragione per esteso è in testa a quel file). Qui resta il
 * possesso dell'OPACITÀ: chi l'ha presa, con che valore di partenza, e come si
 * restituisce.
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

export function createOpacityRegistry(targets) {
  // Materiale (oggetto) -> stato posseduto. La chiave è l'oggetto su cui si
  // scrive davvero: o quello condiviso (fast path) o il clone per-mesh.
  const owned = new Map() // Material -> { prevOpacity, prevTransparent, prevDepthWrite, refs }
  // Materiali che un ripristino graduale sta pilotando: le azioni vive
  // continuano pure a chiamare set()/lerpTo(), ma da qui in poi non scrivono
  // più nulla. Gemello esatto di `restoring` in pivotRegistry.js e per la
  // stessa ragione: senza, un'azione che riscrive l'opacità A OGNI FRAME
  // (`pulseOpacity`, e prima di lei nessuna) combatterebbe col rientro e
  // vincerebbe l'ultimo scrittore del frame. `setOpacity` non ne aveva bisogno
  // perché smette da sé a regime (`inst.data.settled`).
  const restoring = new Set()
  // Handle emessi e non ancora rilasciati: è da qui che passa `releaseAll`.
  const live = new Set()

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

  const disown = (material) => {
    const rec = owned.get(material)
    if (!rec) return
    if (--rec.refs > 0) return
    material.opacity = rec.prevOpacity
    material.transparent = rec.prevTransparent
    material.depthWrite = rec.prevDepthWrite
    material.needsUpdate = true
    owned.delete(material)
    restoring.delete(material)
  }

  /**
   * Prende possesso dell'opacità delle mesh indicate.
   * @returns handle con readCurrent()/set()/lerpTo()/release()
   */
  const acquire = (meshes, { depthWrite = true } = {}) => {
    const { targets: mats, clonedMeshes } = targets.resolve(meshes)
    for (const m of mats) own(m, depthWrite)

    let released = false
    const handle = {
      materials: mats,
      /** Snapshot dei valori correnti, per interpolare DA dove si è ora. */
      readCurrent() {
        return mats.map((m) => m.opacity)
      },
      /** Scrive `opacity` (+ il riallineamento di depthWrite) — mai needsUpdate. */
      set(value) {
        for (const m of mats) {
          if (restoring.has(m)) continue
          m.opacity = value
          syncDepthWrite(m)
        }
      },
      lerpTo(from, to, k) {
        for (let i = 0; i < mats.length; i++) {
          if (restoring.has(mats[i])) continue
          const a = from?.[i] ?? mats[i].opacity
          mats[i].opacity = a + (to - a) * k
          syncDepthWrite(mats[i])
        }
      },
      release() {
        if (released) return
        released = true
        live.delete(handle)
        for (const m of mats) disown(m)
        targets.release(clonedMeshes)
      },
    }
    live.add(handle)
    return handle
  }

  /**
   * Rete di sicurezza: rilascia tutto, usata allo smontaggio del director.
   *
   * ⚠️ Passa dagli HANDLE vivi, non direttamente da `owned`: i cloni sono ora
   * refcontati e condivisi con gli altri scrittori di materiali (vedi
   * materialTargets.js), quindi solo l'handle sa quanti riferimenti restituire.
   * Azzerare `owned` a mano lascerebbe i cloni montati per sempre.
   */
  const releaseAll = () => {
    for (const handle of [...live]) handle.release()
    // Materiali posseduti senza un handle vivo non dovrebbero esistere; se
    // esistono, meglio restituirli che lasciarli semitrasparenti per sempre.
    for (const material of [...owned.keys()]) {
      owned.get(material).refs = 1
      disown(material)
    }
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
    const snapshot = [...owned.keys()]
    const from = snapshot.map((m) => m.opacity)
    const to = snapshot.map((m) => owned.get(m).prevOpacity)
    // Da qui in poi le azioni vive non scrivono più su questi materiali: è il
    // rientro a pilotarli. Vedi la nota su `restoring` in testa alla funzione.
    for (const m of snapshot) restoring.add(m)
    let finished = false
    return {
      empty: snapshot.length === 0,
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
        for (const m of snapshot) if (owned.has(m)) n++
        return n
      },
      lerp(k) {
        if (finished) return
        for (let i = 0; i < snapshot.length; i++) {
          // Un materiale rilasciato nel frattempo da chi lo possedeva (lo
          // scambio di varianti chiude sempre la propria dissolvenza) è già
          // tornato al suo valore e non è più `transparent`: continuare a
          // scriverci sopra non si vedrebbe, ma è comunque una bugia.
          if (!owned.has(snapshot[i])) continue
          snapshot[i].opacity = from[i] + (to[i] - from[i]) * k
          // Risalendo verso l'opaco il depth write torna da sé alla soglia.
          syncDepthWrite(snapshot[i])
        }
      },
      finish() {
        if (finished) return
        finished = true
        // `disown` toglie da `restoring` mano a mano: a valle di questa riga
        // nessun materiale resta congelato, e un'animazione lanciata subito
        // dopo riparte scrivendo normalmente.
        releaseAll()
      },
    }
  }

  const stats = () => ({ ownedMaterials: owned.size })

  return { acquire, releaseAll, beginRestoreAll, stats }
}
