import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useGLTF, TransformControls } from '@react-three/drei'
import { useControls } from 'leva'
import { DRACO_PATH } from './KeyboardModel'
import { collectMeshList } from './materials/applyFinish'

const HALO_SCALE = 1.04
const HALO_COLOR = '#4dabf7'

export default function MeshController({ modelUrl, selectedMesh, onSelectMesh, editMode = 'none' }) {
  const active = editMode === 'meshes'
  const { scene } = useGLTF(modelUrl, DRACO_PATH)

  const meshList = useMemo(() => collectMeshList(scene), [scene])
  const meshOptions = useMemo(() => {
    const opts = { '— nessuna —': '' }
    for (const m of meshList) opts[m.label] = m.uuid
    return opts
  }, [meshList])
  const meshByUuid = useMemo(() => new Map(meshList.map((m) => [m.uuid, m.mesh])), [meshList])

  // posX/Y/Z e rotX/Y/Z sono offset RELATIVI al centro geometrico della
  // mesh selezionata (pivot), non più valori assoluti — vedi pivotInfo.
  const [meshCtrl, setMeshCtrl] = useControls('⚙️ Editor Mesh (Debug)', () => ({
    meshName: { options: meshOptions, value: '', label: 'Mesh' },
    mode: { options: ['translate', 'rotate'], value: 'translate', label: 'Modalità' },
    opacity: { value: 1, min: 0, max: 1, step: 0.01, label: 'Opacità' },
    posX: { value: 0, min: -2, max: 2, step: 0.005, label: 'Pos X (rel.)' },
    posY: { value: 0, min: -2, max: 2, step: 0.005, label: 'Pos Y (rel.)' },
    posZ: { value: 0, min: -2, max: 2, step: 0.005, label: 'Pos Z (rel.)' },
    rotX: { value: 0, min: -180, max: 180, step: 1, label: 'Rot X° (rel.)' },
    rotY: { value: 0, min: -180, max: 180, step: 1, label: 'Rot Y° (rel.)' },
    rotZ: { value: 0, min: -180, max: 180, step: 1, label: 'Rot Z° (rel.)' },
  }), { collapsed: false, render: (get) => get('⚙️ Editor · Modalità.editMode') === 'meshes' }, [meshOptions])
  const { meshName, mode, opacity, posX, posY, posZ, rotX, rotY, rotZ } = meshCtrl

  useEffect(() => {
    if (!active) onSelectMesh?.(null)
  }, [active, onSelectMesh])

  useEffect(() => {
    if (!active) return
    const mesh = meshName ? meshByUuid.get(meshName) : null
    if ((mesh ?? null) !== selectedMesh) onSelectMesh?.(mesh ?? null)
  }, [meshName, active, meshByUuid])

  // --- Pivot al centro geometrico -----------------------------------
  // Molte sub-mesh di questo GLB hanno origine locale lontana dal loro
  // volume visibile (freeze transform Maya): la mesh selezionata viene
  // temporaneamente riparentata sotto un Group creato al volo, posizionato
  // al centro del bounding box locale, con Object3D.attach() (three.js) che
  // ricalcola la trasformata locale necessaria a preservare la posa
  // mondiale — la mesh non "salta" né all'aggancio né allo sgancio.
  // NB: attach() non supporta scale non uniformi lungo la catena di parent
  // (qui l'unico scale è quello uniforme di KeyboardModel.jsx).
  const [pivotInfo, setPivotInfo] = useState(null)
  const suppressApplyRef = useRef(false)

  useEffect(() => {
    if (!selectedMesh) { setPivotInfo(null); return }
    const mesh = selectedMesh
    const parent = mesh.parent
    if (!parent) { setPivotInfo(null); return }

    mesh.updateWorldMatrix(true, false)
    mesh.geometry.computeBoundingBox()
    const localCenter = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())
    const worldCenter = mesh.localToWorld(localCenter.clone())

    // Orientamento del pivot = orientamento mondiale della mesh, espresso
    // nello spazio locale di `parent` (via getWorldQuaternion, non copiando
    // il quaternion locale: robusto a prescindere da come pivot e mesh
    // verranno manipolati più avanti).
    const parentWorldQuat = parent.getWorldQuaternion(new THREE.Quaternion())
    const meshWorldQuat = mesh.getWorldQuaternion(new THREE.Quaternion())

    const pivot = new THREE.Group()
    pivot.name = '__meshEditorPivot'
    parent.add(pivot)
    pivot.position.copy(parent.worldToLocal(worldCenter.clone()))
    pivot.quaternion.copy(parentWorldQuat.invert().multiply(meshWorldQuat))
    pivot.attach(mesh)

    setPivotInfo({
      pivot,
      basePosition: pivot.position.clone(),
      baseQuaternion: pivot.quaternion.clone(),
    })

    return () => {
      parent.attach(mesh) // "cuoce" l'edit corrente nella trasformata locale originale della mesh
      parent.remove(pivot)
    }
  }, [selectedMesh])

  // Nuovo pivot => gli slider ripartono da zero (offset relativo) e il
  // dropdown si riallinea alla selezione (serve quando la mesh è stata
  // scelta con un click 3D anziché dal dropdown stesso).
  useEffect(() => {
    suppressApplyRef.current = true
    setMeshCtrl({
      meshName: selectedMesh?.uuid ?? '',
      posX: 0, posY: 0, posZ: 0,
      rotX: 0, rotY: 0, rotZ: 0,
    })
  }, [pivotInfo])

  // Applica l'offset relativo al pivot. Dipendenze SOLO su posX..rotZ,
  // deliberatamente senza pivotInfo: al cambio mesh gli slider vengono
  // sempre azzerati (effetto sopra) prima che questo effetto possa mai
  // girare di nuovo, dato che non si riattiva finché gli slider stessi non
  // cambiano — quindi non osserva mai un pivot nuovo con valori vecchi.
  // Guardia suppressApplyRef tenuta comunque come difesa in profondità.
  useEffect(() => {
    if (suppressApplyRef.current) {
      suppressApplyRef.current = false
      return
    }
    if (!pivotInfo) return
    pivotInfo.pivot.position.copy(pivotInfo.basePosition).add(new THREE.Vector3(posX, posY, posZ))
    const deltaQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(rotX), THREE.MathUtils.degToRad(rotY), THREE.MathUtils.degToRad(rotZ))
    )
    pivotInfo.pivot.quaternion.copy(pivotInfo.baseQuaternion).multiply(deltaQuat)
  }, [posX, posY, posZ, rotX, rotY, rotZ])

  // --- Halo di selezione ----------------------------------------------
  // Guscio invertito (backface, leggermente più grande, materiale unlit):
  // figlio della MESH (non del pivot), così eredita la trasformata mondiale
  // reale a prescindere dal wrap/unwrap del pivot qui sopra. Scale applicato
  // ATTORNO al centro geometrico (non all'origine locale della mesh, per lo
  // stesso motivo del pivot) via position+scale combinati sulla stessa
  // mesh — non serve un Group extra. `raycast = () => null` altrimenti un
  // click sul bordo (dove l'halo sporge oltre la mesh reale) selezionerebbe
  // l'halo invece della mesh vera.
  useEffect(() => {
    if (!selectedMesh) return
    const mesh = selectedMesh
    mesh.geometry.computeBoundingBox()
    const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())

    const halo = new THREE.Mesh(
      mesh.geometry, // riferimento condiviso: NON clonare, NON fare dispose
      new THREE.MeshBasicMaterial({
        color: HALO_COLOR,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    )
    halo.scale.setScalar(HALO_SCALE)
    halo.position.copy(center).multiplyScalar(1 - HALO_SCALE)
    halo.renderOrder = 999
    halo.raycast = () => null
    mesh.add(halo)

    return () => {
      mesh.remove(halo)
      halo.material.dispose()
    }
  }, [selectedMesh])

  useEffect(() => {
    if (selectedMesh && selectedMesh.material) {
      const mat = selectedMesh.material
      const prevTransparent = mat.transparent
      const prevOpacity = mat.opacity
      mat.transparent = true
      mat.opacity = opacity
      mat.needsUpdate = true
      return () => {
        mat.transparent = prevTransparent
        mat.opacity = prevOpacity
        mat.needsUpdate = true
      }
    }
  }, [selectedMesh, opacity])

  if (!active || !selectedMesh || !pivotInfo) return null

  return (
    <TransformControls
      object={pivotInfo.pivot}
      mode={mode}
      onMouseDown={() => {
        if (window.__abortComposerDrag) window.__abortComposerDrag()
      }}
      onChange={() => {
        const offset = pivotInfo.pivot.position.clone().sub(pivotInfo.basePosition)
        const deltaQuat = pivotInfo.baseQuaternion.clone().invert().multiply(pivotInfo.pivot.quaternion)
        const deltaEuler = new THREE.Euler().setFromQuaternion(deltaQuat)
        setMeshCtrl({
          posX: offset.x, posY: offset.y, posZ: offset.z,
          rotX: THREE.MathUtils.radToDeg(deltaEuler.x),
          rotY: THREE.MathUtils.radToDeg(deltaEuler.y),
          rotZ: THREE.MathUtils.radToDeg(deltaEuler.z),
        })
      }}
    />
  )
}
