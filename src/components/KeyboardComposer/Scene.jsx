import { Suspense } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  Html,
  Lightformer,
  useProgress,
} from '@react-three/drei'
import { KeyboardModel } from './KeyboardModel'

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

export default function Scene({ modelUrl, finish }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.4, 5.2] }} // il fov deriva dalla focale (useComposerControls)
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.25,
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <Suspense fallback={<Loader />}>
        {/* Modello centrato: ruotando su X i bordi non escono dal frame. */}
        <group position={[0, 0.1, 0]}>
          <KeyboardModel url={modelUrl} finish={finish} />
        </group>
        <ContactShadows
          position={[0, -1.5, 0]}
          opacity={0.6}
          scale={9}
          blur={2.6}
          far={3.2}
          resolution={512}
        />

        {/* Environment procedurale (nessun HDR esterno): softbox da studio. */}
        <Environment resolution={256}>
          <Lightformer
            intensity={2.2}
            position={[0, 4, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[8, 4, 1]}
          />
          <Lightformer
            intensity={1.4}
            position={[-4, 1.5, 3]}
            rotation={[0, Math.PI / 4, 0]}
            scale={[3, 2, 1]}
          />
          <Lightformer
            intensity={1.1}
            position={[4, 1, -3]}
            rotation={[0, -Math.PI / 3, 0]}
            scale={[3, 2, 1]}
            color="#cfd8ff"
          />
        </Environment>

        {/* Faro dall'alto: cono di luce puntato sul modello. */}
        <spotLight
          castShadow
          position={[0, 6, 0.6]}
          intensity={110}
          angle={0.55}
          penumbra={0.9}
          decay={1.6}
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[3, 5, 2]} intensity={1.8} />
        {/* Fill frontale morbido: le pose ruotate restano leggibili. */}
        <directionalLight position={[0, 1.5, 6]} intensity={0.9} />
        <spotLight
          position={[-4, 3, -4]}
          intensity={12}
          angle={0.5}
          penumbra={1}
          color="#b9c6ff"
        />
      </Suspense>
    </Canvas>
  )
}
