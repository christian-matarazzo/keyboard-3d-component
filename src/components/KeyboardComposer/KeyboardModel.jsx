import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { collectSlotMeshes, applyFinish } from './materials/applyFinish'
import { useComposerControls } from './useComposerControls'

const DRACO_PATH = '/draco/'
export const DEFAULT_MODEL_URL = '/models/keyboard.glb'

// Larghezza finale del modello in unità scena, indipendente dalle unità
// del file sorgente (l'OBJ è in centimetri).
const TARGET_WIDTH = 3.2

export function KeyboardModel({ url = DEFAULT_MODEL_URL, finish }) {
  const groupRef = useRef()
  const { scene } = useGLTF(url, DRACO_PATH)

  // Auto-fit: centra il modello e lo scala a TARGET_WIDTH, così camera e
  // ombre funzionano qualunque siano le unità dell'asset.
  const { scale, offset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = TARGET_WIDTH / Math.max(size.x, size.z, 1e-6)
    return { scale: s, offset: center.multiplyScalar(-1) }
  }, [scene])

  const slotMeshes = useMemo(() => collectSlotMeshes(scene), [scene])

  useEffect(() => {
    if (finish) applyFinish(slotMeshes, finish)
  }, [slotMeshes, finish])

  useComposerControls(groupRef)

  return (
    <group ref={groupRef}>
      <group scale={scale}>
        <primitive object={scene} position={offset} />
      </group>
    </group>
  )
}

/** Da chiamare il prima possibile nel sito host per anticipare il fetch. */
export function preloadKeyboardModel(url = DEFAULT_MODEL_URL) {
  useGLTF.preload(url, DRACO_PATH)
}
