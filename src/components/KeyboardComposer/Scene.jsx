import { Suspense, useEffect, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Html, useProgress } from '@react-three/drei'
import { useControls } from 'leva'
import { KeyboardModel } from './KeyboardModel'
import LightRig from './LightRig'
import MeshController from './MeshController'
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

// Ritocco live dei materiali dei quattro slot (pannello ?debug): i default
// rispecchiano la finitura attiva definita nel registry. Il valore corrente
// è specchiato su `window.__STATE_MATERIALS` e ripristinabile via l'evento
// `app-load-materials`, entrambi usati dal salvataggio/caricamento JSON del
// LightRig (vedi handleSaveJSON/handleLoadJSON).
function MaterialTuner({ finish }) {
  const [body, setBody] = useControls('Materiale · body', () => ({
    color: finish.slots.body.color,
    roughness: { value: finish.slots.body.roughness, min: 0, max: 1 },
    metalness: { value: finish.slots.body.metalness, min: 0, max: 1 },
    envMapIntensity: { value: finish.slots.body.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: finish.slots.body.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: finish.slots.body.clearcoatRoughness ?? 0, min: 0, max: 1 },
  }), { collapsed: true })
  const [keycaps, setKeycaps] = useControls('Materiale · keycaps', () => ({
    color: finish.slots.keycaps.color,
    roughness: { value: finish.slots.keycaps.roughness, min: 0, max: 1 },
    metalness: { value: finish.slots.keycaps.metalness, min: 0, max: 1 },
    envMapIntensity: { value: finish.slots.keycaps.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: finish.slots.keycaps.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: finish.slots.keycaps.clearcoatRoughness ?? 0, min: 0, max: 1 },
  }), { collapsed: true })
  const [landing, setLanding] = useControls('Materiale · rialzo', () => ({
    color: finish.slots.landing.color,
    roughness: { value: finish.slots.landing.roughness, min: 0, max: 1 },
    metalness: { value: finish.slots.landing.metalness, min: 0, max: 1 },
    envMapIntensity: { value: finish.slots.landing.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: finish.slots.landing.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: finish.slots.landing.clearcoatRoughness ?? 0, min: 0, max: 1 },
  }), { collapsed: true })

  useEffect(() => {
    window.__STATE_MATERIALS = { body, keycaps, landing }
  }, [body, keycaps, landing])

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail
      if (detail?.body) setBody(detail.body)
      if (detail?.keycaps) setKeycaps(detail.keycaps)
      if (detail?.landing) setLanding(detail.landing)
    }
    window.addEventListener('app-load-materials', handler)
    return () => window.removeEventListener('app-load-materials', handler)
  }, [setBody, setKeycaps, setLanding])

  useEffect(() => {
    tuneSlotMaterial(finish.id, 'body', body)
  }, [finish.id, body])
  useEffect(() => {
    tuneSlotMaterial(finish.id, 'keycaps', keycaps)
  }, [finish.id, keycaps])
  useEffect(() => {
    tuneSlotMaterial(finish.id, 'landing', landing)
  }, [finish.id, landing])
  return null
}

export default function Scene({ modelUrl, finish, apiRef, explodeApiRef }) {
  const [modelSize, setModelSize] = useState(null)
  const [selectedMesh, setSelectedMesh] = useState(null)

  // Modalità editor esclusiva (Nessuno/Luci/Mesh): l'editor luci (LightRig,
  // helper cliccabili) e l'editor mesh (KeyboardModel + MeshController)
  // condividono lo stesso canvas e raycastano indipendentemente — prima di
  // questo switch un click sul modello poteva selezionare anche una luce
  // sottostante (onPointerDown della mesh e onClick degli helper luce sono
  // due pipeline di eventi R3F separate, stopPropagation sull'una non ferma
  // l'altra). Un solo sistema alla volta riceve i click (vedi editMode
  // passato a KeyboardModel/LightRig/MeshController); il drag di rotazione
  // si disattiva solo in Mesh (in Luci serve poter cambiare posa per
  // configurare le luci vista per vista — vedi controlsDisabled sotto).
  const { editMode } = useControls('⚙️ Editor · Modalità', {
    editMode: {
      options: { Nessuno: 'none', Luci: 'lights', Mesh: 'meshes' },
      value: 'none',
      label: 'Modalità',
    },
  }, { collapsed: false })

  // Entrando in modalità Mesh, snappa subito alla vista 3/4 FT ('TL') — non
  // al selezionare una mesh (altrimenti risalterebbe lì ogni volta che si
  // cambia mesh dal dropdown/click 3D dentro la stessa sessione di editing).
  useEffect(() => {
    if (editMode === 'meshes' && apiRef?.current) {
      apiRef.current.goTo('TL')
    }
  }, [editMode, apiRef])

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
      // Deseleziona quando si clicca sullo sfondo vuoto
      onPointerMissed={() => setSelectedMesh(null)}
    >
      <Suspense fallback={<Loader />}>
        {/* Modello centrato: ruotando su X i bordi non escono dal frame. */}
        <group position={[0, 0.1, 0]}>
          <KeyboardModel
            url={modelUrl}
            finish={finish}
            apiRef={apiRef}
            explodeApiRef={explodeApiRef}
            onSizeComputed={setModelSize}
            onSelectMesh={setSelectedMesh}
            // Solo Mesh disattiva il drag: in Luci serve poter cambiare posa
            // per configurare le luci vista per vista (vedi anche onWheel in
            // useComposerControls.js, che resta sempre attivo — zoom mai
            // disattivato da nessuna modalità).
            controlsDisabled={editMode === 'meshes'}
            editMode={editMode}
          />
        </group>
        <MaterialTuner finish={finish} />

        {/* Rig volumetrico: griglia di point light + rectAreaLight per faccia
            attorno al bounding box del modello, più le due luci-ombra
            (key/spot) con gizmo di editing. Sostituisce lo studio fotografico
            camera-solidale + Environment/Lightformer della vecchia versione:
            è l'unica sorgente di luce della scena. */}
        <LightRig modelSize={modelSize} apiRef={apiRef} editMode={editMode} />
        {/* AGGIUNGI IL CONTROLLER */}
        <MeshController
          modelUrl={modelUrl}
          selectedMesh={selectedMesh}
          onSelectMesh={setSelectedMesh}
          editMode={editMode}
        />
      </Suspense>
    </Canvas>
  )
}
