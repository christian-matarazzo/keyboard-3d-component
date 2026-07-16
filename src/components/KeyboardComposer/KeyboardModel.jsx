import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useControls } from 'leva'
import { collectSlotMeshes, applyFinish } from './materials/applyFinish'
import { useComposerControls } from './useComposerControls'
import { ENTRY_LANDSCAPE, ENTRY_PORTRAIT } from './poseGraph'
import { RAKE_LAYER } from './LightRig'

const DRACO_PATH = '/draco/'
export const DEFAULT_MODEL_URL = '/models/keyboard.glb'

// Larghezza finale del modello in unità scena, indipendente dalle unità
// del file sorgente (l'OBJ è in centimetri).
const TARGET_WIDTH = 3.2

export function KeyboardModel({ url = DEFAULT_MODEL_URL, finish, apiRef }) {
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

  // Solo i keycaps stanno anche sul layer del rake: la luce radente rivela il
  // loro rilievo senza toccare le piastre in alluminio (che brucerebbero).
  useEffect(() => {
    for (const mesh of slotMeshes.keycaps) mesh.layers.enable(RAKE_LAYER)
  }, [slotMeshes])

  const portrait = useThree((s) => s.size.width < s.size.height)

  // Posa d'ingresso: su desktop il corner "initial position" del cliente
  // (pitch 35.264° + yaw 45°, stop ViewCube — vedi poseGraph.js). Su mobile
  // portrait la vista verticale (faccia tasti alla camera, asse lungo
  // verticale, manopole in alto) resta pitch 90° + yaw 90° (Rx·Ry, ordine
  // 'XYZ'). Niente roll su wrapper esterno: così il pitch resta sull'asse
  // orizzontale dello schermo e lo swipe verticale trascina il modello
  // seguendo il dito, identico al desktop.
  useComposerControls(groupRef, {
    initialRotation: portrait
      ? { x: ENTRY_PORTRAIT.x, y: ENTRY_PORTRAIT.y }
      : { x: ENTRY_LANDSCAPE.x, y: ENTRY_LANDSCAPE.y },
    apiRef, // esposto alla pulsantiera delle viste, che sta fuori dal Canvas
  })

  // Luce "orbitale": agganciata al group che ruota (non al rig camera-relative
  // di LightRig), quindi resta sempre nella stessa posizione LOCALE — sotto
  // il modello — qualunque sia la posa corrente. Il rig segue la camera e non
  // "vede" mai il lato che il modello ha ruotato verso il basso; questa luce
  // orbita insieme all'oggetto e lo tiene sempre riempito da sotto.
  const orbital = useControls('Luci · orbitale (sotto)', {
    intensity: { value: 3.5, min: 0, max: 6, step: 0.1 },
    color: '#dce4ff',
  })

  return (
    <group>
      <group ref={groupRef}>
        <pointLight
          position={[-10, 1, 0.6]}
          intensity={orbital.intensity}
          decay={1.2}
          color={orbital.color}
        />
        <group scale={scale}>
          <primitive object={scene} position={offset} />
        </group>
      </group>
    </group>
  )
}

/** Da chiamare il prima possibile nel sito host per anticipare il fetch. */
export function preloadKeyboardModel(url = DEFAULT_MODEL_URL) {
  useGLTF.preload(url, DRACO_PATH)
}
