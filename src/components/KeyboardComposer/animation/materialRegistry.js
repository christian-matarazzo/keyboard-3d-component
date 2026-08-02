import * as THREE from 'three'

/**
 * Layer di override della TINTA a runtime: colore, rugosità, metallicità ed
 * emissiva di un insieme di mesh, per la durata di un'animazione.
 *
 * Gemello di opacityRegistry.js — stessa forma (acquisisci · fotografa ·
 * interpola · restituisci), stesso possesso condiviso dei materiali
 * (materialTargets.js), stesso ripristino graduale invece che a scatto. Sono
 * due file e non uno perché fotografano proprietà diverse e, soprattutto,
 * perché l'opacità porta con sé `transparent`/`depthWrite`, che qui non si
 * toccano: una tinta non deve spostare una mesh nel pass ordinato in
 * profondità.
 *
 * ⚠️ Perché non passa da `applyMaterialProps` (materials/groupMaterials.js),
 * che scrive esattamente queste proprietà: sono lo STESSO campo con due
 * proprietari. Il tuner Leva riapplica i valori autorati a ogni cambio e
 * vincerebbe a momenti imprevedibili, cioè un'animazione che tinge di rosso
 * tornerebbe grigia appena qualcuno tocca uno slider. Qui la fotografia
 * all'acquire è l'autorità e il tuner, mentre l'override è vivo, semplicemente
 * scrive sotto: al rilascio si torna a ciò che c'era. Ortogonali per
 * costruzione, non per disciplina — stesso argomento di opacityRegistry.js.
 *
 * ⚠️ **Ogni proprietà qui dentro è una UNIFORM, e non è un caso.** Colore,
 * rugosità, metallicità, emissiva e la sua intensità entrano nello shader come
 * valori, non come define: scriverle per-frame non ricompila niente. Cambiare
 * invece una proprietà che è un define (`clearcoat` che attraversa lo zero, la
 * presenza di una `map`) durante un'animazione è la trappola già annotata in
 * CLAUDE.md — e con un override di opacità attivo non arriva nemmeno allo
 * shader. Se un giorno servisse animare il clearcoat, non basta aggiungerlo a
 * `PROPS`.
 */

// Le proprietà scalari gestite, con i limiti che il registry impone comunque
// (un'emissiva negativa o una rugosità sopra 1 non hanno significato).
const SCALARS = {
  roughness: [0, 1],
  metalness: [0, 1],
  emissiveIntensity: [0, 20],
}

const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v))

/** Fotografia dei valori che questo registry sa rimettere a posto. */
const snapshotOf = (m) => ({
  color: m.color?.clone() ?? null,
  emissive: m.emissive?.clone() ?? null,
  roughness: m.roughness,
  metalness: m.metalness,
  emissiveIntensity: m.emissiveIntensity,
})

export function createMaterialRegistry(targets) {
  // Materiale -> { prev, refs }. `prev` è la fotografia del PRIMO acquire: un
  // secondo acquire sullo stesso materiale non ri-fotografa, o catturerebbe
  // come "originale" ciò che il primo ha già scritto (stessa trappola, e stessa
  // soluzione, di `own` in opacityRegistry.js).
  const owned = new Map()
  // Materiali pilotati da un ripristino graduale: le azioni vive continuano a
  // chiamare lerp(), ma non scrivono più. Gemello di `restoring` in
  // pivotRegistry.js e in opacityRegistry.js.
  const restoring = new Set()
  const live = new Set()

  const own = (material) => {
    const rec = owned.get(material)
    if (rec) {
      rec.refs++
      return material
    }
    owned.set(material, { prev: snapshotOf(material), refs: 1 })
    return material
  }

  const applySnapshot = (m, s) => {
    if (s.color && m.color) m.color.copy(s.color)
    if (s.emissive && m.emissive) m.emissive.copy(s.emissive)
    if (s.roughness != null) m.roughness = s.roughness
    if (s.metalness != null) m.metalness = s.metalness
    if (s.emissiveIntensity != null) m.emissiveIntensity = s.emissiveIntensity
  }

  const disown = (material) => {
    const rec = owned.get(material)
    if (!rec) return
    if (--rec.refs > 0) return
    applySnapshot(material, rec.prev)
    // ⚠️ Nessun `needsUpdate`: sono tutte uniform (vedi l'intestazione).
    // Scriverlo qui costerebbe una ricompilazione per materiale a ogni fine
    // animazione, cioè lo stallo che warmupTransparency.js esiste per evitare.
    owned.delete(material)
    restoring.delete(material)
  }

  /**
   * Normalizza i parametri autorati nella forma su cui si interpola: colori
   * come `THREE.Color` (costruiti una volta sola, non per frame) e scalari già
   * limitati. `null` = "non toccare questa proprietà", che è ciò che rende
   * possibile tingere solo l'emissiva senza dichiarare anche il colore base.
   */
  const targetProps = ({ color, emissive, roughness, metalness, emissiveIntensity } = {}) => {
    const out = {}
    // ⚠️ `new THREE.Color(hex)` interpreta la stringa come sRGB e la converte
    // in lineare, esattamente come `applyMaterialProps`. Interpolare in lineare
    // è coerente col resto della pipeline (vedi la nota sRGB→lineare del bake
    // AR in CLAUDE.md): un lerp fra due esadecimali "come si leggono" darebbe
    // un passaggio intermedio più chiaro di quello giusto.
    if (color) out.color = new THREE.Color(color)
    if (emissive) out.emissive = new THREE.Color(emissive)
    for (const [key, range] of Object.entries(SCALARS)) {
      const v = { roughness, metalness, emissiveIntensity }[key]
      if (v != null && Number.isFinite(v)) out[key] = clamp(v, range)
    }
    return out
  }

  /**
   * Prende possesso della tinta delle mesh indicate.
   * @returns handle con readCurrent()/lerp()/release()
   */
  const acquire = (meshes) => {
    const { targets: mats, clonedMeshes } = targets.resolve(meshes)
    for (const m of mats) own(m)

    let released = false
    const handle = {
      materials: mats,
      /** Snapshot dei valori CORRENTI: si interpola da dove si è ora. */
      readCurrent() {
        return mats.map(snapshotOf)
      },
      /**
       * @param {Array} from output di readCurrent()
       * @param {Object} to output di targetProps()
       * @param {number} k 0..1, già passato per l'easing
       */
      lerp(from, to, k) {
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i]
          if (restoring.has(m)) continue
          const a = from?.[i]
          if (!a) continue
          if (to.color && m.color && a.color) m.color.lerpColors(a.color, to.color, k)
          if (to.emissive && m.emissive && a.emissive) {
            m.emissive.lerpColors(a.emissive, to.emissive, k)
          }
          for (const key of Object.keys(SCALARS)) {
            if (to[key] == null || a[key] == null) continue
            m[key] = a[key] + (to[key] - a[key]) * k
          }
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

  /** Rete di sicurezza — vedi il gemello in opacityRegistry.js sul perché passa dagli handle. */
  const releaseAll = () => {
    for (const handle of [...live]) handle.release()
    for (const material of [...owned.keys()]) {
      owned.get(material).refs = 1
      disown(material)
    }
  }

  /**
   * Ripristino GRADUALE di tutto ciò che è tinto, per lo smontaggio morbido di
   * `stop()` e per "Torna all'insieme": ogni materiale torna dalla tinta che ha
   * adesso alla fotografia dell'acquire interpolando, invece di scattarci.
   * Stessa forma dei gemelli in opacityRegistry.js e pivotRegistry.js, così il
   * runtime può trattare i tre binari allo stesso modo.
   */
  const beginRestoreAll = () => {
    const snapshot = [...owned.keys()]
    const from = snapshot.map(snapshotOf)
    const to = snapshot.map((m) => owned.get(m).prev)
    for (const m of snapshot) restoring.add(m)
    let finished = false
    return {
      empty: snapshot.length === 0,
      get done() {
        return finished
      },
      get remaining() {
        let n = 0
        for (const m of snapshot) if (owned.has(m)) n++
        return n
      },
      lerp(k) {
        if (finished) return
        for (let i = 0; i < snapshot.length; i++) {
          const m = snapshot[i]
          if (!owned.has(m)) continue // rilasciato nel frattempo: è già tornato
          const a = from[i]
          const b = to[i]
          if (a.color && b.color && m.color) m.color.lerpColors(a.color, b.color, k)
          if (a.emissive && b.emissive && m.emissive) {
            m.emissive.lerpColors(a.emissive, b.emissive, k)
          }
          for (const key of Object.keys(SCALARS)) {
            if (a[key] == null || b[key] == null) continue
            m[key] = a[key] + (b[key] - a[key]) * k
          }
        }
      },
      finish() {
        if (finished) return
        finished = true
        releaseAll()
      },
    }
  }

  const stats = () => ({ tintedMaterials: owned.size })

  return { acquire, targetProps, releaseAll, beginRestoreAll, stats }
}
