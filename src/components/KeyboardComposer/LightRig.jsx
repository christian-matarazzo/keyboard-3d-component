import { useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls, button } from 'leva'
import { easing } from 'maath'
import * as THREE from 'three'
import { Html, useHelper, TransformControls, useGLTF } from '@react-three/drei'
// Inizializzazione GLOBALE: deve avvenire prima che i materiali PBR
// vengano compilati, altrimenti le RectAreaLight vengono ignorate.
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

import { POSE_COORD, wrapYaw } from './poseGraph'
import { DRACO_PATH, DEFAULT_MODEL_URL } from './KeyboardModel'

const RIG_POSITION = [0, 0.1, 0]
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// --- Stili degli overlay di debug ----------------------------------------
// Erano oggetti inline ripetuti quasi identici (i due <select>, i due bottoni
// salva/carica): qui una sola volta, con le sole differenze come override sul
// posto. Sono overlay dell'editor `?debug`, non UI di prodotto — per quella
// valgono i CSS module (Hud.module.css).
const SELECT_STYLE = {
  background: 'rgba(20, 20, 20, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: '12px',
  fontFamily: 'sans-serif',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  outline: 'none',
  appearance: 'auto',
}

const PANEL_BTN_STYLE = {
  background: 'rgba(20, 20, 20, 0.8)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontFamily: 'sans-serif',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  backdropFilter: 'blur(4px)',
}

// --- SCATOLA LUCI ADATTIVA ------------------------------------------------
// La scatola (griglia 3x3x3 di point light + 6 rectAreaLight per faccia) non
// deriva più dalla bounding box STATICA del modello vergine (`modelSize`,
// calcolata una volta sola in KeyboardModel.jsx e simmetrica attorno
// all'origine): viene misurata dal vivo sull'albero di scena reale, quindi
// segue qualunque traslazione/rotazione applicata a mesh o gruppi
// dall'editor Mesh. Se la mesh più alta sale di m, il piano `top`
// (e le luci della fascia top) salgono con lei e restano a distanza
// `margin` dalla superficie: la scatola si ALLUNGA sull'asse, non trasla in
// blocco — ogni faccia è ancorata al proprio estremo del box.
//
// Costo: la misura è un traverse dell'intera scena, quindi NON gira a ogni
// frame ma ogni BOX_REFRESH_FRAMES; il valore misurato è poi smorzato
// (stesso damping del margine) così il movimento resta fluido anche a
// frequenza di campionamento bassa.
const BOX_REFRESH_FRAMES = 4
const BOX_KEYS = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']

const _geoBox = new THREE.Box3()
const _worldBox = new THREE.Box3()
const _corner = new THREE.Vector3()

/**
 * Bounding box del modello espressa nello spazio LOCALE del rig.
 * Ignora le mesh di servizio dell'editor (halo di selezione, marcate con
 * `userData.__editorHelper`): sono gusci ingranditi del 4% attorno alla mesh
 * selezionata e falserebbero il box mentre si edita. Ignora anche le varianti
 * non scelte (`userData.__variantHidden`, vedi materials/meshVariants.js): sono
 * geometria vera ma spenta, e dimensionerebbero le luci su un layout che non si
 * sta guardando.
 * Ritorna null se non c'è nulla da misurare.
 */
function measureModelBox(root, rig) {
  if (!root || !rig) return null
  root.updateWorldMatrix(true, true)
  _worldBox.makeEmpty()
  root.traverse((node) => {
    if (!node.isMesh || node.userData?.__editorHelper || node.userData?.__variantHidden) return
    const geo = node.geometry
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    if (!geo.boundingBox) return
    _geoBox.copy(geo.boundingBox).applyMatrix4(node.matrixWorld)
    _worldBox.union(_geoBox)
  })
  if (_worldBox.isEmpty()) return null

  // Il rig non ha rotazione (è figlio diretto della root della scena), quindi
  // i due angoli restano gli estremi anche dopo la conversione; il min/max
  // esplicito è comunque una difesa a costo zero.
  rig.updateWorldMatrix(true, false)
  const min = rig.worldToLocal(_corner.copy(_worldBox.min)).clone()
  const max = rig.worldToLocal(_corner.copy(_worldBox.max)).clone()
  return {
    minX: Math.min(min.x, max.x), maxX: Math.max(min.x, max.x),
    minY: Math.min(min.y, max.y), maxY: Math.max(min.y, max.y),
    minZ: Math.min(min.z, max.z), maxZ: Math.max(min.z, max.z),
  }
}

/** Fallback simmetrico attorno all'origine del rig: il comportamento
 *  storico, usato solo finché la prima misura live non è disponibile. */
const boxFromModelSize = (modelSize) => ({
  minX: -modelSize.x / 2, maxX: modelSize.x / 2,
  minY: -modelSize.y / 2, maxY: modelSize.y / 2,
  minZ: -modelSize.z / 2, maxZ: modelSize.z / 2,
})

const generateDefaultConfig = () => {
  const def = { margin: 1.0, showHelpers: true, showSurfaces: true } 
  for (let i = 0; i < 9; i++) { def[`top_${i}_intensity`] = 0; def[`top_${i}_color`] = '#ffffff'; def[`top_${i}_decay`] = 2; }
  for (let i = 0; i < 8; i++) { def[`mid_${i}_intensity`] = 0; def[`mid_${i}_color`] = '#ffffff'; def[`mid_${i}_decay`] = 2; }
  for (let i = 0; i < 9; i++) { def[`bot_${i}_intensity`] = 0; def[`bot_${i}_color`] = '#ffffff'; def[`bot_${i}_decay`] = 2; }
  
  const surfaces = ['top', 'bot', 'left', 'right', 'front', 'back']
  surfaces.forEach(s => {
    def[`surf_${s}_intensity`] = 0
    def[`surf_${s}_color`] = '#ffffff'
  })
  
  return def
}

// --- SHADOW KEYLIGHT ---
function ShadowKeyLight({ debug, lightsActive }) {
  const lightRef = useRef()
  
  // 1. Salviamo l'oggetto intero in 'controls'
  const [controls, setControls] = useControls('Ombra: Directional (Keylight)', () => ({
    enabled: { value: true, label: 'Accesa' },
    showGizmo: { value: false, label: 'Mostra Gizmo 3D' },
    intensity: { value: 0.5, min: 0, max: 100, step: 0.05 },
    posX: { value: 0, min: -10, max: 10 },
    posY: { value: 5, min: -10, max: 10 },
    posZ: { value: 2, min: -10, max: 10 },
    bias: { value: -0.0005, min: -0.005, max: 0.005, step: 0.0001 },
    normalBias: { value: 0.02, min: -0.1, max: 0.1, step: 0.001 },
  // Cartella visibile solo in modalità Luci: `render` nasconde la riga nel
  // pannello senza smontare il componente, quindi i valori restano intatti
  // (a differenza di un unmount/remount, che li resetterebbe ai default).
  }), { collapsed: true, render: (get) => get('⚙️ Editor · Modalità.editMode') === 'lights' })

  // 2. Destrutturiamo i valori per usarli nel JSX
  const { enabled, showGizmo, intensity, posX, posY, posZ, bias, normalBias } = controls

  // 3. Ora 'controls' esiste e l'useEffect funziona perfettamente!
  useEffect(() => { window.__STATE_KEYLIGHT = controls }, [controls])
  
  useEffect(() => {
    const handler = (e) => { if (e.detail) setControls(e.detail) }
    window.addEventListener('app-load-keylight', handler)
    return () => window.removeEventListener('app-load-keylight', handler)
  }, [setControls])

  useHelper(debug && lightsActive && showGizmo && lightRef, THREE.DirectionalLightHelper, 1, '#00ffcc')

  // ... (il resto del return con la directionalLight e il Gizmo rimane identico)
  if (!enabled) return null

  return (
    <>
      <directionalLight
        ref={lightRef}
        position={[posX, posY, posZ]}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={bias}
        shadow-normalBias={normalBias}
      >
        <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 20]} />
      </directionalLight>

      {debug && lightsActive && showGizmo && (
        <TransformControls 
          object={lightRef} 
          mode="translate" 
          size={0.7} 
          // 1. Appena il mouse preme il Gizmo, disabilitiamo il drag del modello!
          onMouseDown={() => {
            if (window.__abortComposerDrag) window.__abortComposerDrag()
          }}
          // 2. Sincronizziamo in tempo reale con i parametri Leva
          // 3. Quando muoviamo il Gizmo, aggiorniamo in tempo reale gli slider di Leva
          onChange={() => {
            if (lightRef.current) {
              setControls({
                posX: lightRef.current.position.x,
                posY: lightRef.current.position.y,
                posZ: lightRef.current.position.z,
              })
            }
          }}
        />
      )}
    </>
  )
}

// --- SHADOW SPOTLIGHT ---
function ShadowSpotLight({ debug, lightsActive }) {
  const lightRef = useRef()
  
  // 1. Salviamo l'oggetto intero in 'controls'
  const [controls, setControls] = useControls('Ombra: Spotlight', () => ({
    enabled: { value: false, label: 'Accesa' }, 
    showGizmo: { value: false, label: 'Mostra Gizmo 3D' },
    intensity: { value: 1.0, min: 0, max: 100, step: 0.1 },
    angle: { value: 0.6, min: 0.1, max: Math.PI / 2, step: 0.01 },
    penumbra: { value: 0.5, min: 0, max: 1, step: 0.01 },
    distance: { value: 15, min: 1, max: 50, step: 0.5 },
    posX: { value: -3, min: -10, max: 10 },
    posY: { value: 4, min: -10, max: 10 },
    posZ: { value: 3, min: -10, max: 10 },
    bias: { value: -0.0005, min: -0.005, max: 0.005, step: 0.0001 },
    normalBias: { value: 0.02, min: -0.1, max: 0.1, step: 0.001 },
  }), { collapsed: true, render: (get) => get('⚙️ Editor · Modalità.editMode') === 'lights' })

  // 2. Destrutturiamo i valori per usarli nel JSX
  const { enabled, showGizmo, intensity, angle, penumbra, distance, posX, posY, posZ, bias, normalBias } = controls

  // 3. Salviamo lo stato globale
  useEffect(() => { window.__STATE_SPOTLIGHT = controls }, [controls])
  
  useEffect(() => {
    const handler = (e) => { if (e.detail) setControls(e.detail) }
    window.addEventListener('app-load-spotlight', handler)
    return () => window.removeEventListener('app-load-spotlight', handler)
  }, [setControls])

  useHelper(debug && lightsActive && showGizmo && lightRef, THREE.SpotLightHelper, '#ff00cc')

  // ... (il resto del return con la spotLight e il Gizmo rimane identico)
  if (!enabled) return null

  return (
    <>
      <spotLight
        ref={lightRef}
        position={[posX, posY, posZ]}
        intensity={intensity}
        angle={angle}
        penumbra={penumbra}
        distance={distance}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={bias}
        shadow-normalBias={normalBias}
      />

      {debug && lightsActive && showGizmo && (
        <TransformControls 
          object={lightRef} 
          mode="translate" 
          size={0.7} 
          // 1. Appena il mouse preme il Gizmo, disabilitiamo il drag del modello!
          onMouseDown={() => {
            if (window.__abortComposerDrag) window.__abortComposerDrag()
          }}
          // 2. Sincronizziamo in tempo reale con i parametri Leva
          // 3. Sincronizzazione con Leva
          onChange={() => {
            if (lightRef.current) {
              setControls({
                posX: lightRef.current.position.x,
                posY: lightRef.current.position.y,
                posZ: lightRef.current.position.z,
              })
            }
          }}
        />
      )}
    </>
  )
}

export default function LightRig({ modelSize, apiRef, editMode = 'none', modelUrl = DEFAULT_MODEL_URL } = {}) {
  // Stessa cache di drei condivisa con KeyboardModel/MeshController/
  // MaterialTuner: nessun fetch aggiuntivo, è la STESSA istanza di scena su
  // cui l'editor mesh applica le sue trasformate — che è esattamente ciò che
  // qui va misurato dal vivo (vedi measureModelBox).
  const { scene: modelScene } = useGLTF(modelUrl, DRACO_PATH)
  const rigRef = useRef()
  // Box misurato (target) e box smorzato (quello effettivamente usato per
  // posizionare luci e superfici).
  const boxTargetRef = useRef(null)
  const animBoxRef = useRef(null)
  const boxFrameRef = useRef(0)

  // Editor luci esclusivo: interattivo solo con ?debug ED editMode === 'lights'
  // (vedi Scene.jsx). Prima di questo switch gli helper qui sotto restavano
  // cliccabili ogni volta che showHelpers/showSurfaces era acceso, anche
  // mentre si usava l'editor mesh — dato che onPointerDown (mesh) e onClick
  // (luci) sono raycast R3F indipendenti, stopPropagation sull'uno non
  // fermava l'altro, e lo stesso click selezionava sia una mesh sia una luce
  // sottostante. `editModeRef` rispecchia la prop dentro la closure di lunga
  // durata di useFrame, come già fa currentControlsRef.
  const lightsInteractive = DEBUG && editMode === 'lights'
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode

  const configsRef = useRef({})

  const prevPoseRef = useRef(null) 
  const activePoseRef = useRef(null) 
  
  const [activePose, setActivePose] = useState(null) 
  const [selectedLight, setSelectedLight] = useState(null) 
  const [lightEditor, setLightEditor] = useState({ intensity: 0, color: '#ffffff', decay: 2 })

  // Ref aggiuntivi per i Gruppi (utilizzati per animare dinamicamente il volume)
  const animatedMargin = useRef(1.0)
  
  const topGroups = useRef([]); const topLights = useRef([]); const topHelpers = useRef([])
  const midGroups = useRef([]); const midLights = useRef([]); const midHelpers = useRef([])
  const botGroups = useRef([]); const botLights = useRef([]); const botHelpers = useRef([])

  // Unica descrizione delle tre fasce della griglia: la consumano il JSX della
  // griglia, il loop di aggiornamento per-frame, gli <optgroup> del selettore
  // e activeLightsList — prima erano quattro copie testuali da tenere
  // allineate a mano.
  //
  // ATTENZIONE: `prefix` e l'indice dentro `layers[prefix]` compongono le
  // chiavi del JSON di configurazione (`top_0_intensity`, `mid_3_color`, …).
  // Non rinominare i prefissi e non toccare l'ordine con cui il useMemo
  // `layers` più sotto riempie gli array: cambiarli rimappa in silenzio ogni
  // configurazione già salvata su luci diverse.
  const gridLayers = useMemo(() => [
    { prefix: 'top', label: 'Top', groups: topGroups, lights: topLights, helpers: topHelpers },
    { prefix: 'mid', label: 'Mid', groups: midGroups, lights: midLights, helpers: midHelpers },
    { prefix: 'bot', label: 'Bot', groups: botGroups, lights: botLights, helpers: botHelpers },
  ], [])


  const surfGroups = useRef({})
  const surfLights = useRef({})
  const surfHelpers = useRef({})
  
  const labelRef = useRef(null)

  const prevCamRef = useRef({ pitch: 0, yaw: 0, initialized: false })
  const transitionRef = useRef({ totalDist: 0, progress: 1 })

  const schema = useMemo(() => {
    return {
      showHelpers: { value: false, label: 'Mostra Punti' },
      showSurfaces: { value: false, label: 'Mostra Superfici' },
      // Max alzato da 3 a 12: con la scatola adattiva (che segue le mesh
      // traslate dall'editor) serve poter allontanare le luci molto più del
      // vecchio modello statico senza rimanere incastrati nel modello.
      margin: { value: 1.0, min: 0, max: 12, step: 0.1, label: 'Margine Scatola' },
      
      // Controlli per i Damping esposti per il Tuning
      animMarginDamp: { value: 0.25, min: 0.01, max: 1, step: 0.01, label: 'Velocità Margine' },
      animLightOnDamp: { value: 0.08, min: 0.01, max: 1, step: 0.01, label: 'Velocità Accensione' },
      animLightOffDamp: { value: 0.25, min: 0.01, max: 1, step: 0.01, label: 'Velocità Spegnimento' },
      animColorDamp: { value: 0.35, min: 0.01, max: 1, step: 0.01, label: 'Velocità Colore' },

      'Resetta Vista': button(() => {
        if (window.confirm(`Vuoi azzerare le luci per la vista ${activePoseRef.current}?`)) {
          const def = generateDefaultConfig()
          def.showHelpers = currentControlsRef.current.showHelpers
          def.showSurfaces = currentControlsRef.current.showSurfaces
          configsRef.current[activePoseRef.current] = def
          setControls({ margin: def.margin })
          setSelectedLight(null)
        }
      })
    }
  }, [])

  const [controls, setControls] = useControls('Impostazioni Globali Vista', () => schema, {
    collapsed: true,
    render: (get) => get('⚙️ Editor · Modalità.editMode') === 'lights',
  })
  const currentControlsRef = useRef(controls)
  currentControlsRef.current = controls

  // --- INIZIO IMPLEMENTAZIONE UNDO ---
  const historyRef = useRef([])

  // Salva una copia profonda (via JSON) prima di una modifica
  const saveToHistory = () => {
    const snapshot = JSON.stringify(configsRef.current)
    const last = historyRef.current[historyRef.current.length - 1]
    if (last !== snapshot) {
      historyRef.current.push(snapshot)
      // Limitiamo la history a 50 step per evitare memory leak
      if (historyRef.current.length > 50) historyRef.current.shift()
    }
  }

  useEffect(() => {
    const handleUndo = (e) => {
      // Intercetta Ctrl-Z (Windows/Linux) o Cmd-Z (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        
        if (historyRef.current.length > 0) {
          const prevState = historyRef.current.pop()
          configsRef.current = JSON.parse(prevState)
          
          // Forza l'aggiornamento UI per la posa attiva
          if (activePoseRef.current) {
            const restoredConf = configsRef.current[activePoseRef.current]
            if (restoredConf) {
              setControls({
                margin: restoredConf.margin,
                showHelpers: restoredConf.showHelpers,
                showSurfaces: restoredConf.showSurfaces !== undefined ? restoredConf.showSurfaces : restoredConf.showHelpers
              })
              
              // Se stiamo ispezionando una luce, ripristina i suoi slider
              if (selectedLight) {
                setLightEditor({
                  intensity: restoredConf[`${selectedLight.layer}_${selectedLight.index}_intensity`] || 0,
                  color: restoredConf[`${selectedLight.layer}_${selectedLight.index}_color`] || '#ffffff',
                  decay: restoredConf[`${selectedLight.layer}_${selectedLight.index}_decay`] || 2,
                })
              }
            }
          }
        }
      }
    }
    
    window.addEventListener('keydown', handleUndo)
    return () => window.removeEventListener('keydown', handleUndo)
  }, [selectedLight, setControls])
  // --- FINE IMPLEMENTAZIONE UNDO ---

  // Fetch automatico in produzione (fuori dal debug)
  useEffect(() => {
    // Eseguiamo il fetch solo fuori dal debug
    if (!DEBUG) {
      // Usa il nuovo nome del file che comprende tutto lo stato
      fetch('/lightconfig/app-state-config.json')
        .then((res) => {
          if (!res.ok) throw new Error('File di configurazione non trovato')
          return res.json()
        })
        .then((parsed) => {
          // Verifica se è il vecchio JSON (solo luci) o il nuovo formato globale
          const isNewFormat = !!parsed.lights
          const lightsData = isNewFormat ? parsed.lights : parsed
          
          // 1. Applica i dati alle luci volumetriche (il Rig originale)
          configsRef.current = lightsData;
          
          // Aggiorna i controlli se c'è una posa già attiva
          if (activePoseRef.current && lightsData[activePoseRef.current]) {
            const newConfig = { ...generateDefaultConfig(), ...lightsData[activePoseRef.current] };
            setControls({ 
              margin: newConfig.margin, 
              showHelpers: newConfig.showHelpers,
              showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers 
            });
          }

          // 2. Lancia gli eventi globali per aggiornare Materiali, Rotazioni e Ombre
          if (isNewFormat) {
            if (parsed.materials) window.dispatchEvent(new CustomEvent('app-load-materials', { detail: parsed.materials }))
            if (parsed.rotation) window.dispatchEvent(new CustomEvent('app-load-rotation', { detail: parsed.rotation }))
            if (parsed.keylight) window.dispatchEvent(new CustomEvent('app-load-keylight', { detail: parsed.keylight }))
            if (parsed.spotlight) window.dispatchEvent(new CustomEvent('app-load-spotlight', { detail: parsed.spotlight }))
            if (parsed.focus) window.dispatchEvent(new CustomEvent('app-load-focus', { detail: parsed.focus }))
            if (parsed.animations) window.dispatchEvent(new CustomEvent('app-load-animations', { detail: parsed.animations }))
            if (parsed.variants) window.dispatchEvent(new CustomEvent('app-load-variants', { detail: parsed.variants }))
          }
        })
        .catch((err) => {
          console.warn('Nessun JSON personalizzato trovato, applico i default di sistema:', err.message)
        })
    }
  }, [setControls])

  useEffect(() => {
    if (activePoseRef.current && configsRef.current[activePoseRef.current]) {
      configsRef.current[activePoseRef.current].margin = controls.margin
      configsRef.current[activePoseRef.current].showHelpers = controls.showHelpers
      configsRef.current[activePoseRef.current].showSurfaces = controls.showSurfaces
    }
  }, [controls.margin, controls.showHelpers, controls.showSurfaces])

  useEffect(() => {
    if (!activePose) return
    if (!configsRef.current[activePose]) {
      configsRef.current[activePose] = generateDefaultConfig()
    }
    const newConfig = configsRef.current[activePose]
    setControls({ 
      margin: newConfig.margin, 
      showHelpers: newConfig.showHelpers,
      showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers
    })
    setSelectedLight(null) 
  }, [activePose, setControls])

  useEffect(() => {
    if (selectedLight && activePoseRef.current) {
      const conf = configsRef.current[activePoseRef.current]
      if (conf) {
        setLightEditor({
          intensity: conf[`${selectedLight.layer}_${selectedLight.index}_intensity`] || 0,
          color: conf[`${selectedLight.layer}_${selectedLight.index}_color`] || '#ffffff',
          decay: conf[`${selectedLight.layer}_${selectedLight.index}_decay`] || 2,
        })
      }
    }
  }, [selectedLight, activePose])

  // Uscendo dalla modalità Luci si deseleziona: evita un pannello luce
  // "fantasma" ancora aperto mentre si è passati all'editor mesh.
  useEffect(() => {
    if (editMode !== 'lights') setSelectedLight(null)
  }, [editMode])

  const updateLightValue = (key, val) => {
    setLightEditor(prev => ({ ...prev, [key]: val }))
    if (activePoseRef.current && selectedLight) {
      configsRef.current[activePoseRef.current][`${selectedLight.layer}_${selectedLight.index}_${key}`] = val
    }
  }

  // La topologia di base viene memorizzata ignorando il margine variabile, così
  // l'array React non causa re-render indesiderati e distruttivi al cambio del margine.
  const layers = useMemo(() => {
    if (!modelSize) return { top: [], mid: [], bot: [] }
    const top = [], mid = [], bot = []
    
    for (let y of [1, 0, -1]) {
      for (let z of [-1, 0, 1]) {
        for (let x of [-1, 0, 1]) {
          if (y === 0 && x === 0 && z === 0) continue
          if (y === 1) top.push({ x, y, z })
          else if (y === -1) bot.push({ x, y, z })
          else mid.push({ x, y, z })
        }
      }
    }
    return { top, mid, bot }
  }, [modelSize])

  const faces = useMemo(() => {
    if (!modelSize) return []
    return [
      { id: 'surf_top', layer: 'surf', index: 'top', rot: [-Math.PI/2, 0, 0] },
      { id: 'surf_bot', layer: 'surf', index: 'bot', rot: [Math.PI/2, 0, 0] },
      { id: 'surf_left', layer: 'surf', index: 'left', rot: [0, -Math.PI/2, 0] },
      { id: 'surf_right', layer: 'surf', index: 'right', rot: [0, Math.PI/2, 0] },
      { id: 'surf_front', layer: 'surf', index: 'front', rot: [0, 0, 0] },
      { id: 'surf_back', layer: 'surf', index: 'back', rot: [0, Math.PI, 0] },
    ]
  }, [modelSize])

  // --- INIZIO LISTA LUCI ATTIVE ---
  const activeLightsList = useMemo(() => {
    if (!activePose || !configsRef.current[activePose]) return []
    const conf = configsRef.current[activePose]
    const active = []
    
    const checkLight = (layer, idx, name) => {
      const intensity = conf[`${layer}_${idx}_intensity`] || 0
      if (intensity > 0) {
        active.push({
          value: `${layer}_${idx}`,
          label: `${name} (Int: ${intensity.toFixed(1)})`
        })
      }
    }

    faces.forEach(f => checkLight('surf', f.index, `Superficie ${f.index.toUpperCase()}`))
    gridLayers.forEach(L => (layers[L.prefix] ?? []).forEach((_, i) => checkLight(L.prefix, i, `${L.label} ${i}`)))

    return active
  }, [activePose, lightEditor.intensity, faces, layers, gridLayers])
  // --- FINE LISTA LUCI ATTIVE ---

  useFrame((state, delta) => {
    if (!modelSize) return

    const poseKey = apiRef?.current?.currentPoseKey?.()
    
    if (poseKey && poseKey !== activePoseRef.current) {
      const targetCoord = POSE_COORD[poseKey]
      const prevCoord = POSE_COORD[activePoseRef.current] || targetCoord
      if (targetCoord && prevCoord) {
        const totalDist = Math.hypot(
          wrapYaw(targetCoord.yaw - prevCoord.yaw),
          targetCoord.pitch - prevCoord.pitch
        )
        transitionRef.current.totalDist = totalDist
        transitionRef.current.progress = totalDist > 0.001 ? 0 : 1
      }
      prevPoseRef.current = activePoseRef.current
      activePoseRef.current = poseKey
      setActivePose(poseKey)
    }

    if (labelRef.current) {
      const expectedText = activePoseRef.current ? `Vista attiva: ${activePoseRef.current}` : 'Caricamento Vista...'
      if (labelRef.current.innerText !== expectedText) {
        labelRef.current.innerText = expectedText
      }
    }

    const camEuler = new THREE.Euler().setFromQuaternion(state.camera.quaternion, 'YXZ')
    const currentPitch = -camEuler.x
    const currentYaw = -camEuler.y
    
    if (!prevCamRef.current.initialized) {
      prevCamRef.current.pitch = currentPitch
      prevCamRef.current.yaw = currentYaw
      prevCamRef.current.initialized = true
    }
    
    const deltaPitch = currentPitch - prevCamRef.current.pitch
    const deltaYaw = wrapYaw(currentYaw - prevCamRef.current.yaw)
    const moveDist = Math.hypot(deltaPitch, deltaYaw)
    
    prevCamRef.current.pitch = currentPitch
    prevCamRef.current.yaw = currentYaw

    if (transitionRef.current.progress < 1 && transitionRef.current.totalDist > 0.001) {
      transitionRef.current.progress += moveDist / transitionRef.current.totalDist
      if (transitionRef.current.progress > 1) transitionRef.current.progress = 1
    }

    const p = transitionRef.current.progress
    const targetC = configsRef.current[activePoseRef.current] || generateDefaultConfig()
    const prevC = configsRef.current[prevPoseRef.current] || targetC

    const lerpVal = (key, defaultVal) => {
      const v1 = prevC[key] ?? defaultVal
      const v2 = targetC[key] ?? defaultVal
      return v1 + (v2 - v1) * p
    }

    const currentCtrl = currentControlsRef.current
    
    // 1. ANIMA IL MARGINE
    easing.damp(animatedMargin, 'current', currentCtrl.margin, currentCtrl.animMarginDamp, delta)
    const m = animatedMargin.current

    // 1b. MISURA (throttled) E SMORZA LA SCATOLA
    // Il target è la bounding box REALE del modello nello spazio del rig:
    // qualunque mesh/gruppo spostato dall'editor la fa crescere/traslare, e
    // le facce qui sotto restano ancorate ai suoi estremi ± margine.
    if (boxFrameRef.current % BOX_REFRESH_FRAMES === 0) {
      const measured = measureModelBox(modelScene, rigRef.current)
      if (measured) boxTargetRef.current = measured
    }
    boxFrameRef.current++
    const boxTarget = boxTargetRef.current ?? boxFromModelSize(modelSize)
    if (!animBoxRef.current) {
      animBoxRef.current = { ...boxTarget }
    } else {
      for (const k of BOX_KEYS) {
        easing.damp(animBoxRef.current, k, boxTarget[k], currentCtrl.animMarginDamp, delta)
      }
    }
    const b = animBoxRef.current
    // Centro e semi-estensioni della scatola CORRENTE (non più il centro
    // modello: se una mesh sale, il centro sale con lei).
    const boxCenter = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 }
    // Coordinata della griglia (-1/0/+1) → posizione sull'asse: gli estremi
    // sono agganciati alla faccia corrispondente del box + margine, il centro
    // al centro del box. È qui che avviene lo "stretch": i due estremi di un
    // asse si muovono in modo indipendente l'uno dall'altro.
    const axisPos = (sign, min, max, center) =>
      sign === 0 ? center : sign > 0 ? max + m : min - m

    const lightsActiveNow = DEBUG && editModeRef.current === 'lights'
    const isVisiblePoints = lightsActiveNow && currentCtrl.showHelpers
    const isVisibleSurfaces = lightsActiveNow && currentCtrl.showSurfaces

    const updateLightGroup = (layer, gridItems) => {
      const prefix = layer.prefix
      gridItems.forEach((gridItem, i) => {
        const light = layer.lights.current[i]
        const helper = layer.helpers.current[i]
        const group = layer.groups.current[i]
        if (!light) return

        // 2. MUOVI IL GRUPPO FLUIDAMENTE IN BASE AL MARGINE E ALLA SCATOLA
        //    ADATTIVA (b): ogni luce resta a `m` dalla faccia del box che le
        //    compete, quindi segue le mesh spostate dall'editor.
        if (group) {
            const px = axisPos(gridItem.x, b.minX, b.maxX, boxCenter.x)
            const py = axisPos(gridItem.y, b.minY, b.maxY, boxCenter.y)
            const pz = axisPos(gridItem.z, b.minZ, b.maxZ, boxCenter.z)
            group.position.set(px, py, pz)
        }

        const targetIntensity = lerpVal(`${prefix}_${i}_intensity`, 0)
        const targetDecay = lerpVal(`${prefix}_${i}_decay`, 2)
        const targetColor = targetC[`${prefix}_${i}_color`] || '#ffffff'
        
        // 3. DAMPING ASIMMETRICO (Più reattivo in salita o discesa a seconda delle tue impostazioni Leva)
        const isTurningOn = targetIntensity > light.intensity
        const dynamicDamp = isTurningOn ? currentCtrl.animLightOnDamp : currentCtrl.animLightOffDamp
        
        easing.damp(light, 'intensity', targetIntensity, dynamicDamp, delta)
        easing.damp(light, 'decay', targetDecay, dynamicDamp, delta)
        
        // 4. EVITA TRANSIZIONE AL BIANCO
        if (targetIntensity > 0.05) {
            easing.dampC(light.color, targetColor, currentCtrl.animColorDamp, delta)
        }

        if (helper) {
          helper.visible = isVisiblePoints
          if (isVisiblePoints) {
            const isSelected = selectedLight?.layer === prefix && selectedLight?.index === i
            if (isSelected) {
              easing.damp(helper.scale, 'x', 1.2, dynamicDamp, delta)
              easing.damp(helper.scale, 'y', 1.2, dynamicDamp, delta)
              easing.damp(helper.scale, 'z', 1.2, dynamicDamp, delta)
              easing.dampC(helper.material.color, '#00ff44', dynamicDamp, delta) 
              helper.material.opacity = 1.0
            } else {
              const targetScale = 0.5 + (targetIntensity / 50) * 1.5 
              easing.damp(helper.scale, 'x', targetScale, dynamicDamp, delta)
              easing.damp(helper.scale, 'y', targetScale, dynamicDamp, delta)
              easing.damp(helper.scale, 'z', targetScale, dynamicDamp, delta)
              if (targetIntensity > 0.05) {
                  easing.dampC(helper.material.color, targetColor, currentCtrl.animColorDamp, delta)
              }
              helper.material.opacity = Math.max(0.1, targetIntensity / 50)
            }
          }
        }
      })
    }

    const updateSurfGroup = () => {
      // Dimensioni e posizioni derivate dalla scatola adattiva: ogni faccia è
      // ancorata al proprio estremo (max.y + m per il top, min.y - m per il
      // bottom, …) invece che a ±metà di una dimensione simmetrica. È questo
      // che fa "allungare" il light box quando una mesh trasla: la faccia dal
      // lato in cui si è mossa si allontana, l'opposta resta ferma.
      const w = (b.maxX - b.minX) + m * 2
      const h = (b.maxY - b.minY) + m * 2
      const d = (b.maxZ - b.minZ) + m * 2
      const { x: cx, y: cy, z: cz } = boxCenter

      const dynamicFaces = {
        top: { pos: [cx, b.maxY + m, cz], args: [w, d] },
        bot: { pos: [cx, b.minY - m, cz], args: [w, d] },
        left: { pos: [b.minX - m, cy, cz], args: [d, h] },
        right: { pos: [b.maxX + m, cy, cz], args: [d, h] },
        front: { pos: [cx, cy, b.maxZ + m], args: [w, h] },
        back: { pos: [cx, cy, b.minZ - m], args: [w, h] }
      }

      faces.forEach((face) => {
        const s = face.index
        const light = surfLights.current[s]
        const helper = surfHelpers.current[s]
        const group = surfGroups.current[s]
        if (!light) return
        
        const { pos, args } = dynamicFaces[s]
        if (group) group.position.set(...pos)
        
        // Adattamento dimensioni RectAreaLight
        easing.damp(light, 'width', args[0], currentCtrl.animMarginDamp, delta)
        easing.damp(light, 'height', args[1], currentCtrl.animMarginDamp, delta)

        const targetIntensity = lerpVal(`surf_${s}_intensity`, 0)
        const targetColor = targetC[`surf_${s}_color`] || '#ffffff'
        
        const isTurningOn = targetIntensity > light.intensity
        const dynamicDamp = isTurningOn ? currentCtrl.animLightOnDamp : currentCtrl.animLightOffDamp

        easing.damp(light, 'intensity', targetIntensity, dynamicDamp, delta)
        
        if (targetIntensity > 0.05) {
            easing.dampC(light.color, targetColor, currentCtrl.animColorDamp, delta)
        }

        if (helper) {
          helper.visible = isVisibleSurfaces
          if (isVisibleSurfaces) {
            // Adattamento scala mesh Helper in base all'animazione
            easing.damp(helper.scale, 'x', args[0], currentCtrl.animMarginDamp, delta)
            easing.damp(helper.scale, 'y', args[1], currentCtrl.animMarginDamp, delta)

            const isSelected = selectedLight?.layer === 'surf' && selectedLight?.index === s
            if (isSelected) {
              easing.dampC(helper.material.color, '#00ff44', dynamicDamp, delta) 
              helper.material.opacity = 0.6
            } else {
              if (targetIntensity > 0.05) {
                  easing.dampC(helper.material.color, targetColor, currentCtrl.animColorDamp, delta)
              }
              helper.material.opacity = Math.max(0.05, targetIntensity / 1500) 
            }
          }
        }
      })
    }

    gridLayers.forEach((layer) => updateLightGroup(layer, layers[layer.prefix]))
    updateSurfGroup()
  })

  // Handler condiviso dai due <select> dell'editor (elenco completo ed elenco
  // delle sole luci accese nella vista): il valore dell'option è sempre
  // `${layer}_${index}`. L'indice delle facce è una stringa ('top', 'left'…),
  // quello della griglia un numero — da qui il parseInt condizionale.
  const onSelectLight = (e) => {
    if (!e.target.value) { setSelectedLight(null); return }
    const [layer, idx] = e.target.value.split('_')
    setSelectedLight({ layer, index: layer === 'surf' ? idx : parseInt(idx, 10) })
  }

  const handleEntityClick = (e, layerPrefix, i) => {
    if (!lightsInteractive) return
    e.stopPropagation()
    setSelectedLight({ layer: layerPrefix, index: i })
  }

  const handlePointerOver = (e) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = (e) => {
    e.stopPropagation()
    document.body.style.cursor = 'grab'
  }

  const fixedDistance = 6
  const isSurfSelected = selectedLight?.layer === 'surf'

  const handleSaveJSON = () => {
    if (activePoseRef.current && currentControlsRef.current) {
      configsRef.current[activePoseRef.current].margin = currentControlsRef.current.margin
      configsRef.current[activePoseRef.current].showHelpers = currentControlsRef.current.showHelpers
      configsRef.current[activePoseRef.current].showSurfaces = currentControlsRef.current.showSurfaces
    }
    
    const fullData = {
      lights: configsRef.current,
      materials: window.__STATE_MATERIALS || {},
      rotation: window.__STATE_ROTATION || {},
      keylight: window.__STATE_KEYLIGHT || {},
      spotlight: window.__STATE_SPOTLIGHT || {},
      // Inquadrature autorate dello zoom sui gruppi (FocusTuner in Scene.jsx).
      // Non c'entra con le luci: sta qui perché questo è l'unico punto di
      // salvataggio/caricamento di TUTTO lo stato tunabile dell'app.
      focus: window.__STATE_FOCUS || {},
      // Animazioni autorate (AnimationEditor, stato in KeyboardComposer.jsx).
      // Stessa ragione del `focus` qui sopra: non c'entrano con le luci, ma
      // questo è l'unico punto di salvataggio/caricamento globale.
      animations: window.__STATE_ANIMATIONS || { version: 1, items: [] },
      // Varianti di modello: la selezione ATTIVA al momento del salvataggio
      // diventa il default di produzione, più i binding variante→animazione di
      // swap. Vedi materials/meshVariants.js.
      variants: window.__STATE_VARIANTS || {}
    }

    const json = JSON.stringify(fullData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'app-state-config.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleLoadJSON = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result)
          
          const isNewFormat = !!parsed.lights
          const lightsData = isNewFormat ? parsed.lights : parsed

          configsRef.current = lightsData
          let alertMsg = "Configurazione Globale caricata con successo!"
          
          const currentPose = activePoseRef.current
          if (currentPose && lightsData[currentPose]) {
            const newConfig = { ...generateDefaultConfig(), ...lightsData[currentPose] }
            setControls({ 
              margin: newConfig.margin, 
              showHelpers: newConfig.showHelpers, 
              showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers 
            })
          }
          
          if (isNewFormat) {
            if (parsed.materials) window.dispatchEvent(new CustomEvent('app-load-materials', { detail: parsed.materials }))
            if (parsed.rotation) window.dispatchEvent(new CustomEvent('app-load-rotation', { detail: parsed.rotation }))
            if (parsed.keylight) window.dispatchEvent(new CustomEvent('app-load-keylight', { detail: parsed.keylight }))
            if (parsed.spotlight) window.dispatchEvent(new CustomEvent('app-load-spotlight', { detail: parsed.spotlight }))
            if (parsed.focus) window.dispatchEvent(new CustomEvent('app-load-focus', { detail: parsed.focus }))
            if (parsed.animations) window.dispatchEvent(new CustomEvent('app-load-animations', { detail: parsed.animations }))
            if (parsed.variants) window.dispatchEvent(new CustomEvent('app-load-variants', { detail: parsed.variants }))
          }

          setSelectedLight(null)
          alert(alertMsg)
        } catch (err) {
          alert("Errore: Il JSON fornito non è valido.")
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <group position={RIG_POSITION} ref={rigRef}>

      {/* NUOVE LUCI CON GIZMO 3D */}
      <ShadowKeyLight debug={DEBUG} lightsActive={editMode === 'lights'} />
      <ShadowSpotLight debug={DEBUG} lightsActive={editMode === 'lights'} />

      {/* PANNELLO DI SALVATAGGIO/CARICAMENTO (In alto a sinistra) */}
      {DEBUG && (
        <Html fullscreen style={{ pointerEvents: 'none', zIndex: 10000 }}>
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            pointerEvents: 'auto',
            display: 'flex',
            gap: '10px'
          }}>
            <button
              onClick={handleSaveJSON}
              style={{ ...PANEL_BTN_STYLE, background: 'rgba(20, 100, 200, 0.8)', border: '1px solid rgba(100, 180, 255, 0.5)' }}
            >
              Salva Configurazione
            </button>
            <button onClick={handleLoadJSON} style={PANEL_BTN_STYLE}>
              Carica JSON
            </button>
          </div>
        </Html>
      )}

      {lightsInteractive && (controls.showHelpers || controls.showSurfaces) && (
        <Html fullscreen style={{ pointerEvents: 'none', zIndex: 9999 }}>
          
          <div
            ref={labelRef}
            style={{
              position: 'absolute',
              bottom: '30px',
              left: '30px',
              background: 'rgba(20, 20, 20, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#4dabf7',
              padding: '10px 20px',
              borderRadius: '16px',
              fontFamily: 'monospace',
              fontSize: '15px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              backdropFilter: 'blur(4px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}
          />

          {/* --- INIZIO PUNTO 3A: CONTENITORE DEI DUE SELETTORI --- */}
          <div style={{
            position: 'absolute',
            bottom: '85px',
            left: '30px',
            pointerEvents: 'auto',
            display: 'flex',        // Trasformato in flexbox per impilare i selettori
            flexDirection: 'column', 
            gap: '12px'             // Spazio tra il selettore globale e quello attivo
          }}>
            
            {/* 1. SELETTORE ORIGINALE (Globale) */}
            <select
              value={selectedLight ? `${selectedLight.layer}_${selectedLight.index}` : ''}
              onChange={onSelectLight}
              style={SELECT_STYLE}
            >
              <option value="">-- Seleziona Luce GLOBALE --</option>
              <optgroup label="Facce (Superfici)">
                {faces.map(f => <option key={`surf_${f.index}`} value={`surf_${f.index}`}>Superficie {f.index.toUpperCase()}</option>)}
              </optgroup>
              {gridLayers.map(L => (
                <optgroup key={L.prefix} label={`Griglia ${L.label}`}>
                  {layers[L.prefix].map((_, i) => (
                    <option key={`${L.prefix}_${i}`} value={`${L.prefix}_${i}`}>{L.label} {i}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* 2. NUOVO SELETTORE (Solo Luci Attive in questa vista) */}
            <select
              value={selectedLight ? `${selectedLight.layer}_${selectedLight.index}` : ''}
              onChange={onSelectLight}
              // Sfondo blu per distinguerlo dal selettore globale qui sopra.
              style={{ ...SELECT_STYLE, background: 'rgba(20, 50, 80, 0.85)', border: '1px solid rgba(100, 180, 255, 0.4)' }}
            >
              <option value="">-- Luci ATTIVE --</option>
              {activeLightsList.length === 0 && <option value="" disabled>Nessuna luce attiva in questa vista</option>}
              {activeLightsList.map(l => (
                <option key={`active_${l.value}`} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          {/* --- FINE PUNTO 3A --- */}

          {selectedLight && (
            <div
              style={{
                position: 'absolute',
                right: '30px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '260px',
                background: 'rgba(20, 20, 20, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '16px',
                padding: '20px',
                color: '#fff',
                fontFamily: 'sans-serif',
                pointerEvents: 'auto', 
                backdropFilter: 'blur(8px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#4dabf7', textTransform: 'uppercase' }}>
                  LUCE {selectedLight.layer} {selectedLight.index}
                </h3>
                <button 
                  onClick={() => setSelectedLight(null)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                >✕</button>
              </div>

              {/* --- INIZIO PUNTO 3B: AGGIUNTA onPointerDown={saveToHistory} AGLI INPUT --- */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600' }}>
                  Intensità: {lightEditor.intensity.toFixed(1)}
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max={isSurfSelected ? 100 : 50} 
                  step={isSurfSelected ? 0.2 : 0.1} 
                  value={lightEditor.intensity} 
                  onPointerDown={saveToHistory} // SALVA STATO PRIMA DI TRASCINARE
                  onChange={(e) => updateLightValue('intensity', parseFloat(e.target.value))}
                  style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600' }}>Colore:</label>
                <input 
                  type="color" 
                  value={lightEditor.color} 
                  onPointerDown={saveToHistory} // SALVA STATO PRIMA DI CLICCARE IL COLORE
                  onChange={(e) => updateLightValue('color', e.target.value)}
                  style={{ width: '100%', height: '32px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>

              {!isSurfSelected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600' }}>
                    Decadimento: {lightEditor.decay.toFixed(1)}
                  </label>
                  <input 
                    type="range" min="0" max="5" step="0.1" 
                    value={lightEditor.decay} 
                    onPointerDown={saveToHistory} // SALVA STATO PRIMA DI TRASCINARE
                    onChange={(e) => updateLightValue('decay', parseFloat(e.target.value))}
                    style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
                  />
                </div>
              )}
              {/* --- FINE PUNTO 3B --- */}
            </div>
          )}
        </Html>
      )}

      {faces.map((face) => (
        <group key={face.id} ref={el => { if (el) surfGroups.current[face.index] = el }} rotation={face.rot}>
          <rectAreaLight 
            intensity={0}
            width={1} // Base dimension pre-animation 
            height={1}
            ref={el => { if (el) surfLights.current[face.index] = el }} 
          />
          <mesh
            ref={el => { if (el) surfHelpers.current[face.index] = el }}
            onClick={(e) => handleEntityClick(e, 'surf', face.index)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={998}
            raycast={lightsInteractive ? THREE.Mesh.prototype.raycast : () => null}
          >
            {/* args statici a 1x1, si scala il nodo nel loop piuttosto che ricreare la geometria costantemente */}
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* Le tre fasce della griglia (9 top + 8 mid + 9 bot): un solo blocco
          guidato da `gridLayers`. L'indice `i` all'interno di `layers[prefix]`
          è la chiave del JSON di configurazione — vedi la nota su gridLayers. */}
      {gridLayers.map((L) => layers[L.prefix].map((gridItem, i) => (
        <group key={`${L.prefix}-${i}`} ref={el => { if (el) L.groups.current[i] = el }}>
          <pointLight intensity={0} ref={el => { if (el) L.lights.current[i] = el }} distance={fixedDistance} />
          <mesh
            ref={el => { if (el) L.helpers.current[i] = el }}
            onClick={(e) => handleEntityClick(e, L.prefix, i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
            raycast={lightsInteractive ? THREE.Mesh.prototype.raycast : () => null}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      )))}

    </group>
  )
}