import * as THREE from 'three'

/**
 * "Wrap in un pivot temporaneo" — estratto verbatim da MeshController.jsx, che
 * ora consuma questo modulo invece di avere la logica in corpo all'effetto.
 *
 * Serve perché molte sub-mesh di questo GLB esportato da Maya hanno l'origine
 * locale lontana dal proprio volume visibile (pattern "freeze transform": la
 * collocazione reale è cotta nei vertici, non nella trasformata del nodo).
 * Ruotare/traslare `mesh.position`/`.rotation` direttamente le farebbe orbitare
 * attorno a un punto arbitrario invece di girare su se stesse. Il rimedio è
 * reparentarle sotto un `THREE.Group` posizionato sul centro del bounding box
 * (approssimazione "centro di massa" — il baricentro volumetrico vero è
 * complessità inutile qui), via `Object3D.attach()`, che ricalcola la
 * trasformata locale preservando la posa mondiale: nessun salto visivo al
 * wrap/unwrap.
 *
 * Precondizione ereditata da `attach()`: nessuna scala non uniforme fra gli
 * antenati. Oggi vale (l'unica scala in scena è lo `scale={scale}` uniforme di
 * KeyboardModel.jsx), ma è una mina se cambia.
 *
 * ⚠️ DUE SEMANTICHE DI SMONTAGGIO, ed è la differenza più importante di tutto
 * il sistema di animazione:
 *   - `restore({ bake: true })` — `parent.attach(mesh)`: la trasformata
 *     corrente viene COTTA nella mesh. È ciò che vuole un editor (la modifica
 *     dell'utente persiste). È il comportamento storico di MeshController.
 *   - `restore()` (default) — riparenta con `add()` e RISCRIVE la trasformata
 *     locale esatta fotografata al wrap. È ciò che vuole un'animazione:
 *     `stopAnimation()` dopo un `transformOffset` deve tornare al modello
 *     vergine, non cuocere l'esploso nel GLB in memoria per sempre. Non ci si
 *     affida ad `attach()` per il ritorno anche perché sarebbe un round-trip
 *     di matrici, cioè drift in virgola mobile.
 */

const snapshotOf = (mesh) => ({
  parent: mesh.parent,
  position: mesh.position.clone(),
  quaternion: mesh.quaternion.clone(),
  scale: mesh.scale.clone(),
})

const restoreSnapshot = (mesh, snap, bake) => {
  if (bake) {
    // Cuoce: attach() ricalcola la locale per preservare la posa MONDIALE
    // corrente, quindi la modifica resta.
    snap.parent?.attach(mesh)
    return
  }
  snap.parent?.add(mesh)
  mesh.position.copy(snap.position)
  mesh.quaternion.copy(snap.quaternion)
  mesh.scale.copy(snap.scale)
  mesh.updateMatrix()
}

/**
 * Pivot sul centro geometrico di UNA mesh, parentato sotto il parent originale
 * della mesh stessa.
 * @returns {{ pivot, basePosition, baseQuaternion, meshes, restore }}
 */
export function wrapMeshInPivot(mesh, { name = '__animPivot' } = {}) {
  const parent = mesh.parent
  if (!parent) return null

  mesh.updateWorldMatrix(true, false)
  mesh.geometry.computeBoundingBox()
  const localCenter = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())
  const worldCenter = mesh.localToWorld(localCenter.clone())

  // Orientamento del pivot = orientamento mondiale della mesh espresso nello
  // spazio locale di `parent` (via getWorldQuaternion, non copiando il
  // quaternion locale: robusto a prescindere da come pivot e mesh verranno
  // manipolati più avanti).
  const parentWorldQuat = parent.getWorldQuaternion(new THREE.Quaternion())
  const meshWorldQuat = mesh.getWorldQuaternion(new THREE.Quaternion())

  const snap = snapshotOf(mesh)

  const pivot = new THREE.Group()
  pivot.name = name
  parent.add(pivot)
  pivot.position.copy(parent.worldToLocal(worldCenter.clone()))
  pivot.quaternion.copy(parentWorldQuat.invert().multiply(meshWorldQuat))
  pivot.attach(mesh)

  return {
    pivot,
    basePosition: pivot.position.clone(),
    baseQuaternion: pivot.quaternion.clone(),
    meshes: [mesh],
    restore({ bake = false } = {}) {
      restoreSnapshot(mesh, snap, bake)
      pivot.parent?.remove(pivot)
    },
  }
}

/**
 * Pivot sul centro dell'UNIONE dei bounding box world-space di N mesh, parentato
 * sotto la root della scena GLTF (l'unico contenitore comune stabile quando le
 * mesh hanno parent diversi fra loro).
 *
 * `scene` non ha rotazione/scala proprie ma NON è a identity in world space
 * (eredita rotazione di posa e scala TARGET_WIDTH dai `<group>` antenati in
 * KeyboardModel.jsx): il centro world-space va comunque convertito con
 * `scene.worldToLocal`, esattamente come il ramo mesh-singola fa col proprio
 * `parent`.
 */
export function wrapGroupInPivot(meshes, scene, { name = '__animPivot' } = {}) {
  if (!meshes || meshes.length === 0 || !scene) return null

  meshes.forEach((m) => m.updateWorldMatrix(true, false))
  const box = new THREE.Box3()
  for (const m of meshes) box.union(new THREE.Box3().setFromObject(m))
  if (box.isEmpty()) return null
  const worldCenter = box.getCenter(new THREE.Vector3())

  const pivot = new THREE.Group()
  pivot.name = name
  scene.add(pivot)
  pivot.position.copy(scene.worldToLocal(worldCenter.clone()))
  // Quaternion lasciato a identity: con più mesh di orientamento diverso non
  // esiste un singolo "orientamento del gruppo" ben definito — la rotazione
  // rigida in blocco funziona comunque via composizione parent/figlio di
  // attach(), qualunque sia l'orientamento di partenza del pivot.

  const snaps = meshes.map(snapshotOf)
  for (const m of meshes) pivot.attach(m)

  return {
    pivot,
    basePosition: pivot.position.clone(),
    baseQuaternion: pivot.quaternion.clone(),
    meshes: [...meshes],
    restore({ bake = false } = {}) {
      meshes.forEach((m, i) => restoreSnapshot(m, snaps[i], bake))
      pivot.parent?.remove(pivot)
    },
  }
}
