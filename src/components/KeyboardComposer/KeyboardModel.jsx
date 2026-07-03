import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useControls } from 'leva'
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

  // Mobile portrait: la tastiera si sviluppa in verticale (roll 90° sul
  // wrapper esterno, così pitch/yaw del gesto restano sul group interno).
  const portrait = useThree((s) => s.size.width < s.size.height)

  // Posa d'ingresso: hero a 80° su desktop; su mobile portrait invece 90°
  // (vista dall'alto) combinato col roll del wrapper esterno riproduce lo
  // shot verticale di riferimento (righe di tasti orizzontali, manopole in
  // alto). Non è un semplice "stesso pitch ruotato": il roll è attorno
  // all'asse Z del mondo, non all'asse di vista della camera, quindi pose
  // diverse rispondono al roll in modo diverso — 90° è quella verificata.
  useComposerControls(groupRef, {
    initialRotation: { x: portrait ? Math.PI / 2 : (80 * Math.PI) / 180, y: 0 },
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
    // L'inclinazione a 80° proietta il baricentro visivo un po' a sinistra:
    // piccolo offset X di compensazione per una composizione centrata.
    <group
      rotation={[0, 0, portrait ? -Math.PI / 2 : 0]}
      position={[portrait ? 0.3 : 0, 0, 0]}
    >
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
