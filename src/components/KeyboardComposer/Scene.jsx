import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Html, useGLTF, useProgress } from '@react-three/drei'
import { useControls } from 'leva'
import { KeyboardModel, DRACO_PATH } from './KeyboardModel'
import LightRig from './LightRig'
import MeshController from './MeshController'
import { prepareGroupMaterials, applyMaterialProps } from './materials/groupMaterials'
import { DEFAULT_MESH_GROUPS } from './materials/meshGroups'
import { POSE_COORD, POSE_HUD_LABEL } from './poseGraph'

// POSE_HUD_LABEL ha etichette duplicate per design (più pose condividono la
// stessa label breve, es. 'TL'/'TR'/'CFB' → '3/4 FT') — non può essere usata
// da sola come chiave dell'options Leva, si disambigua accodando la chiave
// posa. Costruito una sola volta a livello di modulo.
const LOCKED_POSE_OPTIONS = Object.fromEntries(
  Object.keys(POSE_COORD).map((key) => [`${POSE_HUD_LABEL[key] ?? key} · ${key}`, key])
)

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

// Ritocco live del materiale di UN gruppo (pannello ?debug): i default
// vengono letti dal materiale REALE già presente sul GLB (autorato in
// Maya/DCC), non da un preset "finish" autorato a mano — vedi
// materials/groupMaterials.js per il perché. Il valore corrente viene
// riportato al genitore (window.__STATE_MATERIALS, usato dal salvataggio/
// caricamento JSON del LightRig — vedi handleSaveJSON/handleLoadJSON) e
// ripristinabile via l'evento `app-load-materials`.
//
// Componente per-gruppo, non un loop di `useControls` dentro MaterialTuner:
// mappare un array di lunghezza variabile su una CHIAMATA DI HOOK dentro un
// ciclo violerebbe le Rules of Hooks; mappare l'array su un COMPONENTE per
// iterazione (ognuno con la propria istanza React, quindi la propria singola
// chiamata fissa a useControls) è invece il pattern sicuro — è così che
// MaterialTuner sotto instanzia un folder Leva per gruppo a runtime.
function MaterialGroupTuner({ group, materials, onChange }) {
  const seed = materials[0] ?? null
  const folderLabel = `Materiale · ${group.label.toLowerCase()}`
  const [values, setValues] = useControls(folderLabel, () => ({
    color: seed ? `#${seed.color.getHexString()}` : '#888888',
    roughness: { value: seed?.roughness ?? 0.5, min: 0, max: 1 },
    metalness: { value: seed?.metalness ?? 0, min: 0, max: 1 },
    envMapIntensity: { value: seed?.envMapIntensity ?? 1, min: 0, max: 2 },
    clearcoat: { value: seed?.clearcoat ?? 0, min: 0, max: 1 },
    clearcoatRoughness: { value: seed?.clearcoatRoughness ?? 0, min: 0, max: 1 },
  }), { collapsed: true })

  useEffect(() => {
    onChange(group.id, values)
  }, [group.id, values, onChange])

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail?.[group.id]
      if (detail) setValues(detail)
    }
    window.addEventListener('app-load-materials', handler)
    return () => window.removeEventListener('app-load-materials', handler)
  }, [group.id, setValues])

  useEffect(() => {
    for (const material of materials) applyMaterialProps(material, values)
  }, [materials, values])

  return null
}

/**
 * Un folder Leva per gruppo di mesh, instanziato a runtime dall'elenco
 * `groups` (default `DEFAULT_MESH_GROUPS`, vedi materials/meshGroups.js).
 * Carica il GLB in proprio (stessa cache di drei condivisa con
 * KeyboardModel.jsx/MeshController.jsx, nessun fetch aggiuntivo) e scopre i
 * materiali via `prepareGroupMaterials` — idempotente, quindi indipendente
 * dall'ordine in cui questo componente e KeyboardModel.jsx montano i propri
 * effetti (sono fratelli sotto Scene.jsx, non genitore/figlio).
 */
function MaterialTuner({ modelUrl, groups = DEFAULT_MESH_GROUPS }) {
  const { scene } = useGLTF(modelUrl, DRACO_PATH)
  const materialsByGroup = useMemo(() => prepareGroupMaterials(scene, groups), [scene, groups])

  const [materialState, setMaterialState] = useState({})
  const handleGroupChange = useCallback((groupId, values) => {
    setMaterialState((prev) => ({ ...prev, [groupId]: values }))
  }, [])

  useEffect(() => {
    window.__STATE_MATERIALS = materialState
  }, [materialState])

  return groups.map((group) => (
    <MaterialGroupTuner key={group.id} group={group} materials={materialsByGroup[group.id] ?? []} onChange={handleGroupChange} />
  ))
}

export default function Scene({ modelUrl, apiRef, timelineApiRef, meshGroups = DEFAULT_MESH_GROUPS }) {
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
  const { editMode, lockedPose } = useControls('⚙️ Editor · Modalità', {
    editMode: {
      options: { Nessuno: 'none', Luci: 'lights', Mesh: 'meshes', Timeline: 'timeline' },
      value: 'none',
      label: 'Modalità',
    },
    lockedPose: { options: LOCKED_POSE_OPTIONS, value: 'TL', label: 'Posa bloccata' },
  }, { collapsed: false })

  // Entrando in modalità Mesh o Timeline (o cambiando la posa bloccata mentre
  // già ci si è dentro), snappa/ri-snappa alla posa bloccata configurabile
  // (non più hardcoded a 'TL') — non al selezionare una mesh/gruppo,
  // altrimenti risalterebbe lì ogni volta che si cambia selezione dentro la
  // stessa sessione di editing.
  useEffect(() => {
    if (!apiRef?.current) return
    if (editMode === 'meshes' || editMode === 'timeline') {
      apiRef.current.goTo?.(lockedPose)
    }
  }, [editMode, lockedPose, apiRef])

  // Ponte verso Hud.jsx/Timeline.jsx (fuori dal Canvas): pubblica editMode e
  // la posa bloccata sullo stesso apiRef.current condiviso con
  // useComposerControls.js (dentro il Canvas) — Object.assign, mai
  // riassegnazione, perché i due scrittori non hanno un ordine garantito fra
  // loro (alberi React separati, uno dentro <Canvas>).
  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, { editMode, lockedPoseKey: lockedPose })
  }, [editMode, lockedPose, apiRef])

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
            apiRef={apiRef}
            onSizeComputed={setModelSize}
            onSelectMesh={setSelectedMesh}
            // Mesh e Timeline disattivano il drag (posa bloccata, vedi sopra):
            // in Luci serve poter cambiare posa per configurare le luci vista
            // per vista (vedi anche onWheel in useComposerControls.js, che
            // resta sempre attivo — zoom mai disattivato da nessuna modalità).
            controlsDisabled={editMode === 'meshes' || editMode === 'timeline'}
            editMode={editMode}
            lockedPoseKey={lockedPose}
            meshGroups={meshGroups}
          />
        </group>
        <MaterialTuner modelUrl={modelUrl} groups={meshGroups} />

        {/* Rig volumetrico: griglia di point light + rectAreaLight per faccia
            attorno al bounding box del modello, più le due luci-ombra
            (key/spot) con gizmo di editing. Sostituisce lo studio fotografico
            camera-solidale + Environment/Lightformer della vecchia versione:
            è l'unica sorgente di luce della scena. */}
        <LightRig modelSize={modelSize} apiRef={apiRef} editMode={editMode} modelUrl={modelUrl} />
        {/* AGGIUNGI IL CONTROLLER */}
        <MeshController
          modelUrl={modelUrl}
          selectedMesh={selectedMesh}
          onSelectMesh={setSelectedMesh}
          editMode={editMode}
          meshGroups={meshGroups}
          timelineApiRef={timelineApiRef}
        />
      </Suspense>
    </Canvas>
  )
}
