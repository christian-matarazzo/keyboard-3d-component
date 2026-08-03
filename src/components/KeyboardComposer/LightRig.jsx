import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
// Inizializzazione GLOBALE: deve avvenire prima che i materiali PBR
// vengano compilati, altrimenti le RectAreaLight vengono ignorate.
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

import { wrapYaw } from './poseGraph'
import { generateDefaultConfig, readViewSettings, VIEW_SETTING_KEYS } from './lightConfig'
import { ShadowKeyLight, ShadowSpotLight } from './runtime/ShadowLights'
import { isDebug } from './state/debug'
import { useComposerSection } from './state/useComposerSection'

const RIG_POSITION = [0, 0.1, 0]

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
  // Riempito qui, letto da authoring/LightEditor.jsx: la maniglia con cui
  // l'editor raggiunge ciò che il rig POSSIEDE (il dizionario per posa, mutato
  // in loco e riletto ogni frame) senza che quella proprietà cambi lato.
  // Stessa forma di keyLightRef/spotLightRef — vedi il blocco in testa a
  // LightEditor.jsx. In produzione resta `undefined` e nessuno lo guarda.
  // ⚠️ NON chiamarlo `rigRef`: quello è già il ref del <group> del rig, qui
  // sotto, e sarebbe una ridichiarazione nello stesso scope.
  editorRef,
} = {}) {
  // GLB, grafo delle pose e percorso del JSON autorato vengono tutti dal
  // prodotto attivo: le luci sono indicizzate PER CHIAVE DI POSA, quindi un
  // file di configurazione ha senso solo insieme al grafo che lo indicizza
  // (vedi products/productSchema.js).
  const { modelUrl, dracoPath, poseGraph } = product
  // Stessa cache di drei condivisa con KeyboardModel/MeshController/
  // MaterialTuner: nessun fetch aggiuntivo, è la STESSA istanza di scena su
  // cui l'editor mesh applica le sue trasformate — che è esattamente ciò che
  // qui va misurato dal vivo (vedi measureModelBox).
  const { scene: modelScene } = useGLTF(modelUrl, dracoPath)
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

  // La SELEZIONE dell'editor luci non vive più qui: sta in `store.ui`, la
  // scrive authoring/LightEditor.jsx e questo componente la rilegge dentro
  // useFrame in modo NON reattivo (`store.get`), per evidenziare l'helper
  // giusto. È una stringa `${layer}_${index}`, mai un oggetto — vedi il blocco
  // in testa a LightEditor.jsx per il perché di entrambe le scelte.
  const clearSelection = useCallback(() => store.set('ui', { selectedLight: null }), [store])

  // Ref aggiuntivi per i Gruppi (utilizzati per animare dinamicamente il volume)
  const animatedMargin = useRef(1.0)
  
  const topGroups = useRef([]); const topLights = useRef([]); const topHelpers = useRef([])
  const midGroups = useRef([]); const midLights = useRef([]); const midHelpers = useRef([])
  const botGroups = useRef([]); const botLights = useRef([]); const botHelpers = useRef([])

  // Unica descrizione delle tre fasce della griglia: la consumano il JSX della
  // griglia e il loop di aggiornamento per-frame qui, più gli <optgroup> del
  // selettore e l'elenco delle luci accese in authoring/LightEditor.jsx, che la
  // riceve attraverso `editorRef` — prima erano quattro copie testuali da
  // tenere allineate a mano, e restano una sola anche ora che i consumatori
  // stanno in due file.
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

  // La cronologia di undo (Ctrl+Z sulle configurazioni di luce) è uscita di qui
  // insieme al resto dell'editor: sta in authoring/LightEditor.jsx e raggiunge
  // `configsRef` attraverso `rigRef`, più sotto.

  // Le luci per posa arrivano dallo store, non più da un fetch fatto qui
  // dentro: chi scarica il file è runtime/ConfigLoader.jsx, chi lo applica è
  // `applyConfig`. Questo componente è tornato a essere solo il rig.
  //
  // Due ingressi, una funzione sola: la configurazione può già essere nello
  // store quando montiamo (è il caso normale — il fetch parte prima) oppure
  // arrivare dopo ("Carica JSON" dal pannello). Prima erano due blocchi
  // identici riga per riga, uno nel fetch e uno nel «Carica JSON», ed è
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
    // Cambiando posa la luce selezionata non ha più senso: le configurazioni
    // sono per posa, e il pannello mostrerebbe i valori di un'altra vista.
    clearSelection()
    // La posa attiva risale a `ui` per l'editor, che la usa per l'etichetta e
    // per l'elenco delle luci accese. Sezione mai serializzata, quindi non
    // entra nel JSON di prodotto.
    store.set('ui', { activePose })
  }, [activePose, setControls, clearSelection, store])

  // Uscendo dalla modalità Luci si deseleziona: evita un pannello luce
  // "fantasma" ancora aperto mentre si è passati all'editor mesh.
  useEffect(() => {
    if (editMode !== 'lights') clearSelection()
  }, [editMode, clearSelection])

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

  // LA MANIGLIA PER L'EDITOR. Riempita a ogni render (non in un effetto: chi la
  // legge è un componente fratello che può montare prima o dopo di questo, e un
  // ref pieno è l'unico stato che non ha un ordine da rispettare).
  // Espone solo ciò che il rig possiede davvero — il dizionario per posa, la
  // posa attiva, le impostazioni di vista — più la topologia che serve a
  // costruire i selettori. Niente di tutto questo è authoring: è il rig visto
  // da fuori. Vedi authoring/LightEditor.jsx.
  if (editorRef) {
    editorRef.current = {
      getConfigs: () => configsRef.current,
      setConfigs: (next) => { configsRef.current = next },
      getActivePose: () => activePoseRef.current,
      getViewControls: () => currentControlsRef.current,
      setViewControls: setControls,
      layers,
      faces,
      gridLayers,
    }
  }

  useFrame((state, delta) => {
    if (!modelSize) return

    // Selezione corrente, letta NON reattivamente: cambia per click dell'utente,
    // non per frame, e leggerla via useComposerSection ri-renderizzerebbe tutto
    // il rig a ogni selezione. È la stessa coppia get/useComposerSection
    // documentata in state/useComposerSection.js.
    const selKey = store.get('ui').selectedLight ?? null

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

    // (L'etichetta "Vista attiva: …" veniva scritta qui a mano dentro un nodo
    // DOM dell'authoring, 60 volte al secondo. Ora la posa passa da `store.ui`
    // e l'etichetta è un normale render di LightEditor.jsx.)

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
            const isSelected = selKey === `${prefix}_${i}`
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

            const isSelected = selKey === `surf_${s}`
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

  const handlePointerOver = (e) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = (e) => {
    e.stopPropagation()
    document.body.style.cursor = 'grab'
  }

  // Click su un helper: scrive la selezione dove la leggono entrambi i lati.
  // Il rig la consuma nel proprio useFrame per evidenziare la sferetta giusta,
  // il pannello di authoring per sapere quale luce sta editando.
  const handleEntityClick = (e, layerPrefix, i) => {
    if (!lightsInteractive) return
    e.stopPropagation()
    store.set('ui', { selectedLight: `${layerPrefix}_${i}` })
  }

  const fixedDistance = 6

  // Salvataggio/caricamento del JSON e "Resetta Vista" NON vivono più qui:
  // stanno in authoring/LightEditor.jsx, che li pubblica sul ponte imperativo
  // (`saveConfigJSON`/`loadConfigJSON`/`resetActiveView`) esattamente come
  // faceva questo file. Tutti e tre i chiamanti erano già in authoring/
  // (DebugPanel, ViewSettingsTuner), quindi la produzione non li perde: non li
  // ha mai usati, se li portava dietro e basta.

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

      {/* Il pannello dell'editor luci (selettori, slider, undo) è uscito di
          qui: sta in authoring/LightEditor.jsx, montato da AuthoringScene.
          Erano ~150 righe di <Html> con stili inline dentro un componente che
          la produzione monta sempre. */}


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