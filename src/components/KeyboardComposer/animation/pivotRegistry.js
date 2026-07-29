import * as THREE from 'three'
import { wrapMeshInPivot, wrapGroupInPivot } from './pivot'

/**
 * Possesso condiviso dei pivot di animazione.
 *
 * Senza un registry, due azioni che wrappano lo stesso gruppo si romperebbero a
 * vicenda in due modi: il secondo `attach()` strapperebbe le mesh al primo
 * pivot (che a quel punto smonterebbe verso un parent ormai sbagliato), e
 * entrambe scriverebbero `pivot.quaternion` litigandoselo.
 *
 * Rimedio: un handle solo per bersaglio, con refcount, e la trasformata
 * composta da CANALI separati — uno per l'offset autorato, uno per lo spin.
 * L'ordine `base · offset · spin` significa "gira su se stessa DOPO essere
 * stata spostata", cioè il caso esploso-e-rotante. Due azioni sullo STESSO
 * bersaglio (stessa chiave) condividono l'handle e si compongono: è il caso
 * "esplodi i rotori e falli girare", entrambi con pivot per mesh.
 *
 * ⚠️ Bersagli SOVRAPPOSTI ma non identici — tipicamente uno spin con pivot per
 * mesh più un offset rigido di gruppo sulle stesse mesh — non sono componibili:
 * sarebbero due pivot che si contendono gli stessi figli, e il primo a
 * smontarsi riparenterebbe mesh che nel frattempo stanno sotto l'altro. Il
 * registry tiene quindi una mappa di proprietà mesh→handle e RIFIUTA (con un
 * warning) un acquire che si sovrappone parzialmente a uno esistente, invece di
 * corrompere silenziosamente la gerarchia. Per ottenere quell'effetto si
 * autorano entrambi gli step con la stessa granularità (`perMesh`).
 */

const groupKey = (meshes) => `group:${meshes.map((m) => m.uuid).sort().join('|')}`

export function createPivotRegistry(getScene) {
  const handles = new Map() // chiave -> handle
  const meshOwner = new Map() // Mesh -> handle che la tiene

  /** true se nessuna delle mesh è già dentro un pivot di un ALTRO bersaglio. */
  const canClaim = (meshes, key) => {
    for (const mesh of meshes) {
      const owner = meshOwner.get(mesh)
      if (owner && owner.key !== key) {
        console.warn(
          '[anim] pivot rifiutato: la mesh',
          mesh.name || mesh.uuid,
          'è già dentro il pivot',
          owner.key,
          '— usa la stessa granularità (perMesh) per comporre spin e offset.',
        )
        return false
      }
    }
    return true
  }

  const makeHandle = (key, wrap) => {
    const handle = {
      key,
      pivot: wrap.pivot,
      basePosition: wrap.basePosition,
      baseQuaternion: wrap.baseQuaternion,
      meshes: wrap.meshes,
      refs: 1,
      channels: {
        offsetPos: new THREE.Vector3(),
        offsetQuat: new THREE.Quaternion(),
        spin: new THREE.Quaternion(),
      },
      compose() {
        this.pivot.position.copy(this.basePosition).add(this.channels.offsetPos)
        this.pivot.quaternion
          .copy(this.baseQuaternion)
          .multiply(this.channels.offsetQuat) // prima la collocazione autorata…
          .multiply(this.channels.spin)       // …poi lo spin, nel frame spostato
      },
      release(opts) {
        if (this.refs <= 0) return
        if (--this.refs > 0) return
        handles.delete(this.key)
        for (const mesh of this.meshes) {
          if (meshOwner.get(mesh) === this) meshOwner.delete(mesh)
        }
        // Default: RIPRISTINA (non cuoce) — vedi la nota in pivot.js sul perché
        // è non negoziabile per le animazioni.
        wrap.restore(opts)
      },
    }
    handles.set(key, handle)
    for (const mesh of handle.meshes) meshOwner.set(mesh, handle)
    return handle
  }

  /** Pivot sul centro geometrico di UNA mesh (è quello che serve allo spin). */
  const acquireMesh = (mesh) => {
    const key = `mesh:${mesh.uuid}`
    const existing = handles.get(key)
    if (existing) { existing.refs++; return existing }
    if (!canClaim([mesh], key)) return null
    const wrap = wrapMeshInPivot(mesh)
    return wrap ? makeHandle(key, wrap) : null
  }

  /**
   * Pivot unico sul centro cumulativo di N mesh (trasformazione rigida).
   * Anche con una sola mesh resta un pivot di GRUPPO — quaternion a identity
   * sotto la root della scena — e non il pivot orientato della mesh: altrimenti
   * la stessa rotazione autorata girerebbe attorno ad assi diversi a seconda di
   * quante mesh contiene il gruppo.
   */
  const acquireGroup = (meshes) => {
    if (!meshes || meshes.length === 0) return null
    const key = groupKey(meshes)
    const existing = handles.get(key)
    if (existing) { existing.refs++; return existing }
    if (!canClaim(meshes, key)) return null
    const wrap = wrapGroupInPivot(meshes, getScene())
    return wrap ? makeHandle(key, wrap) : null
  }

  /** Rete di sicurezza allo smontaggio del director. */
  const releaseAll = () => {
    for (const handle of [...handles.values()]) {
      handle.refs = 1
      handle.release()
    }
  }

  const stats = () => ({ pivots: handles.size, pivotedMeshes: meshOwner.size })

  return { acquireMesh, acquireGroup, releaseAll, stats }
}
