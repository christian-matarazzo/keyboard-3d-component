import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'
import * as THREE from 'three'
import { Html, useGLTF } from '@react-three/drei'
// Inizializzazione GLOBALE: deve avvenire prima che i materiali PBR
// vengano compilati, altrimenti le RectAreaLight vengono ignorate.
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

import { wrapYaw } from './poseGraph'
import { getDracoPath } from './KeyboardModel'
import { DEFAULT_VIEW_SETTINGS } from './state/defaults'
import { applyConfig } from './runtime/productConfig'
import { ShadowKeyLight, ShadowSpotLight } from './runtime/ShadowLights'
import { isDebug } from './state/debug'
import { useComposerSection } from './state/useComposerSection'

const RIG_POSITION = [0, 0.1, 0]

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

/**
 * Valori PER VISTA della cartella "Impostazioni Globali Vista". I default
 * abitano in state/defaults.js insieme a tutti gli altri; da lì leggono sia lo
 * schema Leva sia `generateDefaultConfig`, così un default cambiato in un punto
 * non può divergere dall'altro (prima erano due elenchi paralleli da tenere
 * allineati a mano, ed è il modo in cui un valore smette silenziosamente di
 * combaciare con quello scritto nei JSON già salvati).
 *
 * ⚠️ Queste chiavi finiscono nel JSON dentro `lights[posa]`, accanto a
 * `top_0_intensity` & co. Vale la stessa regola dei prefissi delle luci:
 * rinominarne una rimappa in silenzio ogni configurazione già salvata.
 */
const VIEW_SETTING_KEYS = Object.keys(DEFAULT_VIEW_SETTINGS)

/** Legge le impostazioni per vista da una config di posa, con i default per le chiavi assenti. */
const readViewSettings = (config) => {
  const out = {}
  for (const k of VIEW_SETTING_KEYS) out[k] = config?.[k] ?? DEFAULT_VIEW_SETTINGS[k]
  return out
}

const generateDefaultConfig = () => {
  const def = { ...DEFAULT_VIEW_SETTINGS, showHelpers: true, showSurfaces: true }
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

export default function LightRig({
  modelSize,
  apiRef,
  store,
  editMode = 'none',
  product,
  // Creati da Scene e condivisi con l'authoring, che ci aggancia gizmo e
  // helper senza possedere le luci.
  keyLightRef,
  spotLightRef,
} = {}) {
  // GLB, grafo delle pose e percorso del JSON autorato vengono tutti dal
  // prodotto attivo: le luci sono indicizzate PER CHIAVE DI POSA, quindi un
  // file di configurazione ha senso solo insieme al grafo che lo indicizza
  // (vedi products/productSchema.js).
  const { modelUrl, poseGraph, configUrl } = product
  // Stessa cache di drei condivisa con KeyboardModel/MeshController/
  // MaterialTuner: nessun fetch aggiuntivo, è la STESSA istanza di scena su
  // cui l'editor mesh applica le sue trasformate — che è esattamente ciò che
  // qui va misurato dal vivo (vedi measureModelBox).
  const { scene: modelScene } = useGLTF(modelUrl, getDracoPath())
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
  //
  // ⚠️ `isDebug()` qui e non una costante di modulo: leggere `window` all'import
  // rendeva il pacchetto non importabile sotto SSR (vedi state/debug.js). Il
  // valore è costante per sessione, quindi la closure di useFrame — ricreata a
  // ogni render — legge sempre quello giusto.
  const DEBUG = isDebug()
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

  // Impostazioni della vista corrente. Non è più una `useControls`: il rig le
  // legge dallo store, e il pannello che le muove vive in
  // authoring/ViewSettingsTuner.jsx. È l'ultimo pezzo che teneva `leva` sul
  // percorso di produzione.
  const controls = useComposerSection(store, 'view')
  const setControls = useCallback((patch) => store.set('view', patch), [store])
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

  // Le luci per posa arrivano dallo store, non più da un fetch fatto qui
  // dentro: chi scarica il file è runtime/ConfigLoader.jsx, chi lo applica è
  // `applyConfig`. Questo componente è tornato a essere solo il rig.
  //
  // Due ingressi, una funzione sola: la configurazione può già essere nello
  // store quando montiamo (è il caso normale — il fetch parte prima) oppure
  // arrivare dopo ("Carica JSON" dal pannello). Prima erano due blocchi
  // identici riga per riga, uno nel fetch e uno in handleLoadJSON, ed è
  // esattamente il tipo di duplicazione che diverge alla prima modifica.
  //
  // ⚠️ `configsRef` non diventa stato React: l'editor la muta IN LOCO e il
  // useFrame la legge a ogni frame. Lo store la semina e la ripubblica, ma la
  // proprietà resta qui.
  useEffect(() => {
    if (!store) return

    const applyLights = (lights) => {
      if (!lights || !Object.keys(lights).length) return
      configsRef.current = lights

      const pose = activePoseRef.current
      if (!pose || !lights[pose]) return
      // Lo spread sui default copre i JSON precedenti, che non hanno le chiavi
      // delle velocità: restano validi e prendono i default.
      const newConfig = { ...generateDefaultConfig(), ...lights[pose] }
      setControls({
        ...readViewSettings(newConfig),
        showHelpers: newConfig.showHelpers,
        showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers,
      })
    }

    applyLights(store.get('lights'))
    return store.subscribe('lights', applyLights)
  }, [store, setControls])

  // Slider → config della posa attiva. Il runtime legge questi valori da Leva
  // (currentControlsRef), quindi questo effetto è ciò che li rende persistenti:
  // senza, una velocità appena regolata si perderebbe al primo cambio vista.
  useEffect(() => {
    const conf = configsRef.current[activePoseRef.current]
    if (!activePoseRef.current || !conf) return
    for (const k of VIEW_SETTING_KEYS) conf[k] = controls[k]
    conf.showHelpers = controls.showHelpers
    conf.showSurfaces = controls.showSurfaces
  }, [
    controls.margin,
    controls.animMarginDamp,
    controls.animLightOnDamp,
    controls.animLightOffDamp,
    controls.animColorDamp,
    controls.showHelpers,
    controls.showSurfaces,
  ])

  useEffect(() => {
    if (!activePose) return
    if (!configsRef.current[activePose]) {
      configsRef.current[activePose] = generateDefaultConfig()
    }
    const newConfig = configsRef.current[activePose]
    // Config della posa → slider. È il percorso con cui un valore per vista
    // arriva davvero al runtime, che legge da Leva e non dalla config: il
    // cambio avviene all'inizio della transizione, quindi è la vista IN
    // ENTRATA a governare la propria transizione. Per una velocità (un rateo,
    // non un valore visibile) non ha senso interpolarla come le intensità.
    setControls({
      ...readViewSettings(newConfig),
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
      const targetCoord = poseGraph.poses[poseKey]
      const prevCoord = poseGraph.poses[activePoseRef.current] || targetCoord
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
    // La posa attiva potrebbe avere modifiche non ancora rientrate nella
    // config (l'effetto di mirroring gira dopo il commit React): si allinea
    // qui, subito prima di serializzare.
    if (activePoseRef.current && currentControlsRef.current && configsRef.current[activePoseRef.current]) {
      const conf = configsRef.current[activePoseRef.current]
      for (const k of VIEW_SETTING_KEYS) conf[k] = currentControlsRef.current[k]
      conf.showHelpers = currentControlsRef.current.showHelpers
      conf.showSurfaces = currentControlsRef.current.showSurfaces
    }
    
    // Ogni vista esce dal salvataggio COMPLETA delle proprie impostazioni.
    // Senza questo passaggio le chiavi comparirebbero solo nelle pose che
    // l'autore ha effettivamente attraversato durante la sessione (è l'effetto
    // di mirroring a scriverle, e lavora solo sulla posa attiva), producendo un
    // file popolato a macchia di leopardo a seconda di come si è navigato.
    // Il caricamento se la caverebbe comunque — le chiavi assenti cadono sui
    // default — ma un file che descrive tutte le viste allo stesso modo è
    // ispezionabile e diffabile, e questo è il file che va in produzione.
    for (const conf of Object.values(configsRef.current)) {
      if (!conf) continue
      for (const k of VIEW_SETTING_KEYS) if (conf[k] === undefined) conf[k] = DEFAULT_VIEW_SETTINGS[k]
    }

    // Le luci rientrano nello store prima di serializzare: `configsRef` è
    // mutata in loco dall'editor, quindi lo store va riallineato o il prossimo
    // che lo legge vedrebbe la versione caricata, non quella autorata.
    store?.replace('lights', configsRef.current)

    // ⚠️ `store.toJSON()`, MAI di nuovo un elenco di sezioni scritto a mano qui.
    // Fino a poco fa questa era la lista letterale delle otto sezioni note al
    // momento in cui fu scritta — un residuo dei tempi in cui i valori vivevano
    // nei globali `window.__STATE_*` e non nello store. Il difetto di quella
    // forma non è la verbosità: è che una sezione NUOVA (`postfx`, aggiunta col
    // post-processing) non compare nel file salvato e nessuno se ne accorge —
    // il JSON resta valido, si ricarica senza errori, e la sezione mancante
    // ricade sui default (vedi `hydrate`, che salta le sezioni assenti). Cioè
    // esattamente una regressione silenziosa: si autora, si salva, e la
    // taratura sparisce al reload.
    //
    // `toJSON` itera COMPOSER_SECTIONS, che è già la definizione della forma del
    // file: aggiungere una sezione allo store la fa entrare nel salvataggio
    // senza toccare questo punto. Le due direzioni (`hydrate` e `toJSON`) sono
    // l'una l'inversa dell'altra perché leggono lo stesso elenco.
    //
    // Cosa resta fuori, per scelta e non per dimenticanza: `ui` (stato
    // dell'editor) e `view` (impostazioni PER POSA, già specchiate dentro
    // `lights` dal blocco qui sopra). E dentro `variants` c'è il solo binding
    // variante→animazione di swap: la selezione è stato dell'utente, vive in
    // sessionStorage e viene scartata in ingresso da `normalizeConfig`.
    const json = JSON.stringify(store.toJSON(), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Stesso nome del file che il prodotto si aspetta di trovare servito: si
    // scarica e si ricopia in `public/` al percorso di `configUrl`, senza
    // rinominarlo a mano.
    a.download = configUrl.split('/').pop() || 'app-state-config.json'
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
          // Stessa via del fetch di produzione: applyConfig idrata lo store e
          // avvisa i consumatori. Le luci rientrano dalla sottoscrizione
          // dell'effetto qui sopra, non da questo handler.
          applyConfig(store, JSON.parse(ev.target.result))
          setSelectedLight(null)
          alert('Configurazione Globale caricata con successo!')
        } catch {
          alert('Errore: Il JSON fornito non è valido.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // I due comandi passano sul ponte imperativo condiviso: la pulsantiera
  // "salva/carica" non vive più qui dentro come overlay `<Html>` sul canvas,
  // ma nel DOM accanto al pannello Leva (DebugPanel, in KeyboardComposer.jsx),
  // di cui è il prolungamento visivo. Restano qui gli handler, che sono i soli
  // a vedere `configsRef` e a sapere quali sezioni serializzare.
  //
  // Wrapper sottili su un ref riaggiornato a ogni render (stesso idioma di
  // `focusImplRef` in useComposerControls.js): l'effetto di pubblicazione gira
  // una volta sola (`deps: [apiRef]`), ma le funzioni pubblicate non si
  // congelano sulla closure del primo mount. `Object.assign`, mai
  // `apiRef.current = {...}`: il ponte ha più scrittori (vedi CLAUDE.md).
  const jsonImplRef = useRef({ save: null, load: null })
  jsonImplRef.current.save = handleSaveJSON
  jsonImplRef.current.load = handleLoadJSON

  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, {
      saveConfigJSON: () => jsonImplRef.current.save?.(),
      loadConfigJSON: () => jsonImplRef.current.load?.(),
      // Azzera le luci della vista attiva. Passa dal ponte perché il pulsante
      // che lo lancia sta ora nel pannello di authoring, che non vede
      // `configsRef` — ed è giusto così: quella config appartiene al rig.
      resetActiveView: () => {
        const pose = activePoseRef.current
        if (!pose) return false
        const def = generateDefaultConfig()
        def.showHelpers = currentControlsRef.current.showHelpers
        def.showSurfaces = currentControlsRef.current.showSurfaces
        configsRef.current[pose] = def
        // Anche le velocità di transizione tornano ai default: fanno parte
        // della vista, quindi "resetta vista" le comprende.
        setControls(readViewSettings(def))
        setSelectedLight(null)
        return pose
      },
    })
    return () => {
      delete apiRef.current.saveConfigJSON
      delete apiRef.current.loadConfigJSON
      delete apiRef.current.resetActiveView
    }
  }, [apiRef])

  return (
    <group position={RIG_POSITION} ref={rigRef}>

      {/* NUOVE LUCI CON GIZMO 3D */}
      {/* Le due luci-ombra. I loro slider e i gizmo di trascinamento vivono in
          authoring/LightGizmos.jsx e si agganciano a questi stessi ref, che
          Scene crea e passa a entrambi: la luce è produzione, la manopola no. */}
      <ShadowKeyLight store={store} lightRef={keyLightRef} />
      <ShadowSpotLight store={store} lightRef={spotLightRef} />

      {/* La pulsantiera di salvataggio/caricamento sta in KeyboardComposer.jsx
          (DebugPanel), agganciata al pannello Leva: qui sopra ne pubblichiamo
          solo i due comandi sul ponte imperativo. */}

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
            // Impalcatura dell'editor, non geometria di prodotto: senza il tag
            // `collectMeshGroups` la classifica nel gruppo di fallback (`body`
            // su questo modello) e da lì entra in ogni selettore delle
            // animazioni. Sono 32 mesh — 6 facce + 26 sferette — che un
            // `setOpacity` metteva sotto override e che un `transformOffset` su
            // `body` reparenterebbe nei pivot, contendendo il nodo al useFrame
            // del rig che ne riscrive posizione e scala ogni frame.
            userData={{ __editorHelper: true }}
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
            userData={{ __editorHelper: true }} // vedi la nota sulle facce sopra
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