import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  Html,
  Lightformer,
  useProgress,
} from '@react-three/drei'
import { useControls } from 'leva'
import { KeyboardModel } from './KeyboardModel'
import LightRig from './LightRig'
import { tuneSlotMaterial } from './materials/applyFinish'

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div
        style={{
          color: 'rgba(255,255,255,0.75)',
          fontSize: 14,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Caricamento… {Math.round(progress)}%
      </div>
    </Html>
  )
}

// Esposizione regolabile dal vivo: il default è il valore di produzione.
function ExposureTuner() {
  const gl = useThree((s) => s.gl)
  const { exposure } = useControls('Resa', {
    exposure: { value: 1.5, min: 0.4, max: 2, step: 0.05 },
  })
  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])
  return null
}

// Ritocco live dei materiali dello slot body/keycaps (pannello ?debug):
// i default rispecchiano la finitura attiva definita nel registry.
function MaterialTuner({ finish }) {
  const body = useControls('Materiale · body', {
    color: finish.slots.body.color,
    roughness: { value: finish.slots.body.roughness, min: 0, max: 1 },
    metalness: { value: finish.slots.body.metalness, min: 0, max: 1 },
    envMapIntensity: { value: finish.slots.body.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: finish.slots.body.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: finish.slots.body.clearcoatRoughness ?? 0, min: 0, max: 1 },
  })
  const keycaps = useControls('Materiale · keycaps', {
    color: finish.slots.keycaps.color,
    roughness: { value: finish.slots.keycaps.roughness, min: 0, max: 1 },
    metalness: { value: finish.slots.keycaps.metalness, min: 0, max: 1 },
    envMapIntensity: { value: finish.slots.keycaps.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: finish.slots.keycaps.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: finish.slots.keycaps.clearcoatRoughness ?? 0, min: 0, max: 1 },
  })
  useEffect(() => {
    tuneSlotMaterial(finish.id, 'body', body)
  }, [finish.id, body])
  useEffect(() => {
    tuneSlotMaterial(finish.id, 'keycaps', keycaps)
  }, [finish.id, keycaps])
  return null
}

export default function Scene({ modelUrl, finish }) {
  const env = useControls('Luci · ambiente', {
    stripIntensity: { value: 7, min: 0, max: 15, step: 0.25, label: 'strip top' },
    edgeIntensity: { value: 2.5, min: 0, max: 10, step: 0.25, label: 'strip bordo' },
    ambientIntensity: { value: 0.9, min: 0, max: 2, step: 0.05, label: 'base diffusa' },
    frontIntensity: { value: 1.8, min: 0, max: 6, step: 0.1, label: 'pannello frontale' },
  })
  const shadow = useControls('Ombra a contatto', {
    opacity: { value: 0.5, min: 0, max: 1, step: 0.05 },
    blur: { value: 2.6, min: 0.5, max: 6, step: 0.1 },
  })

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.4, 5.2] }} // il fov deriva dalla focale (useComposerControls)
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      style={{ width: '100%', height: '100%' }}
      // Con ?debug espone scena/camera per la verifica automatica delle pose
      // (screenshot + drag sintetici), come il pannello leva.
      onCreated={(state) => {
        if (new URLSearchParams(window.location.search).has('debug'))
          window.__r3f_state = state
      }}
    >
      <ExposureTuner />
      <Suspense fallback={<Loader />}>
        {/* Modello centrato: ruotando su X i bordi non escono dal frame. */}
        <group position={[0, 0.1, 0]}>
          <KeyboardModel url={modelUrl} finish={finish} />
        </group>
        <MaterialTuner finish={finish} />
        <ContactShadows
          position={[0, -1.5, 0]}
          opacity={shadow.opacity}
          scale={9}
          blur={shadow.blur}
          far={3.2}
          resolution={512}
        />

        {/* Environment cinematico (riferimento shooting Apple): strip light
            lunghe e sottili = bande speculari che spazzolano keycaps e
            alluminio durante la rotazione; base diffusa bassissima perché
            le zone d'ombra scivolino verso il nero (contrasto commercial). */}
        <Environment resolution={256}>
          {/* strip principale dall'alto, leggermente avanzata verso camera */}
          <Lightformer
            intensity={env.stripIntensity}
            position={[0, 4, 1.5]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[9, 0.6, 1]}
          />
          {/* strip di taglio da dietro-sinistra: glint freddi sui bordi */}
          <Lightformer
            intensity={env.edgeIntensity}
            position={[-4.5, 2, -3]}
            rotation={[0, Math.PI / 3, 0]}
            scale={[7, 0.4, 1]}
            color="#cfd8ff"
          />
          {/* pannello frontale ampio e soffuso: solleva la faccia rivolta
              alla camera (decisivo in portrait, dove i keycaps guardano
              l'osservatore) senza appiattire le bande delle strip */}
          <Lightformer
            intensity={env.frontIntensity}
            position={[0, 0.5, 5]}
            rotation={[0, Math.PI, 0]}
            scale={[6, 4, 1]}
          />
          {/* cupola debolissima: i neri restano leggibili, mai vuoti */}
          <Lightformer
            intensity={env.ambientIntensity}
            position={[0, 5, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[14, 14, 1]}
          />
        </Environment>

        {/* Studio fotografico: main + fill + rim, solidali alla camera. */}
        <LightRig />
      </Suspense>
    </Canvas>
  )
}
