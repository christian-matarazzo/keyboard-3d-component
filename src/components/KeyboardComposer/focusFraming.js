import * as THREE from 'three'
import { collectMeshGroups } from './materials/meshGroups'

/**
 * Misura geometrica di un gruppo di mesh per lo zoom di prodotto ("focus").
 *
 * Qui NON si fa matematica di camera: si restituiscono solo centro ed
 * estensione del gruppo in WORLD SPACE. La conversione in distanza camera vive
 * in useComposerControls.js, che è l'unico posto che conosce fov/aspect/margini
 * — vedi lì il rapporto `radius / FIT_HALF_WIDTH`.
 *
 * Due scelte deliberate:
 *
 *  - **Sfera, non estensione proiettata sugli assi della camera.** Il raggio è
 *    la mezza diagonale del bounding box, quindi NON dipende dalla posa: un
 *    giro completo attorno al gruppo non fa "respirare" l'inquadratura e per
 *    costruzione non taglia mai nulla da nessuna angolazione. Costa un po' di
 *    margine sulle pose favorevoli — si recupera con il `radiusFactor` autorato
 *    per gruppo (vedi FocusTuner in Scene.jsx), che è comunque il modo giusto
 *    di decidere un'inquadratura di prodotto.
 *  - **Misura LIVE, via collectMeshGroups.** Stessa classificazione (e stessa
 *    esclusione delle mesh `__editorHelper`, gli halo di MeshController.jsx)
 *    usata da materiali e light box: un halo gonfiato del 4% falserebbe il
 *    raggio esattamente come falserebbe la scatola delle luci.
 *
 * `Box3().setFromObject` su mesh già inserite nell'albero restituisce
 * world-space (le mesh sono figlie di `<group scale={scale}>` in
 * KeyboardModel.jsx): NON rimoltiplicare per `scale`, è lo stesso doppio-scala
 * già preso e corretto sul fit dinamico della camera.
 *
 * @returns {{ center: THREE.Vector3, radius: number } | null} null se il
 *   gruppo non esiste, è vuoto o non ha volume.
 */
export function measureGroupFraming(scene, groups, groupId) {
  if (!scene || !groupId || !groups) return null

  const meshes = collectMeshGroups(scene, groups)[groupId]
  if (!meshes || meshes.length === 0) return null

  const box = new THREE.Box3()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    box.union(new THREE.Box3().setFromObject(mesh))
  }
  if (box.isEmpty()) return null

  return {
    center: box.getCenter(new THREE.Vector3()),
    radius: box.getSize(new THREE.Vector3()).length() / 2,
  }
}
