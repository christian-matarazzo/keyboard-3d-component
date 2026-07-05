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
    topIntensity: { value: 5, min: 0, max: 15, step: 0.25, label: 'strip top' },
    leftIntensity: { value: 7, min: 0, max: 20, step: 0.25, label: 'strip sinistra' },
    rightIntensity: { value: 3.5, min: 0, max: 20, step: 0.25, label: 'strip destra' },
    ambientIntensity: { value: 0.55, min: 0, max: 2, step: 0.05, label: 'base diffusa' },
  })
  const shadow = useControls('Ombra a contatto', {
    opacity: { value: 0.5, min: 0, max: 1, step: 0.05 },
    blur: { value: 2.6, min: 0.5, max: 6, step: 0.1 },
  })

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.1, 5.2] }} // livellata sul pivot; il fov deriva dalla focale (useComposerControls)
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

        {/* Environment 1:1 con `rig set/light disposition .jpeg`: tre strip
            a filo dei bordi del soggetto (sinistra a tutta altezza, destra
            solo metà superiore, top lungo il bordo alto) = i segni verdi
            del riferimento. Base diffusa bassissima: il falloff verso il
            nero del riferimento resta drammatico. Dimensioni riscalate
            sulla tastiera (molto più larga del telefono dimostrativo). */}
        <Environment resolution={256}>
          {/* strip top: corre lungo il bordo superiore, copre tutta la
              larghezza della tastiera */}
          <Lightformer
            intensity={env.topIntensity}
            position={[0, 4, 1]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[9, 0.6, 1]}
          />
          {/* strip sinistra: verticale, TUTTA l'altezza del soggetto — il
              bordo sinistro del riferimento brilla per intero */}
          <Lightformer
            intensity={env.leftIntensity}
            position={[-4, 0.1, 0.5]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[0.8, 5, 1]}
          />
          {/* strip destra: verticale ma solo la metà SUPERIORE, più corta e
              debole — l'asimmetria voluta dal riferimento */}
          <Lightformer
            intensity={env.rightIntensity}
            position={[4, 1.4, 0.5]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[0.8, 2.5, 1]}
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
