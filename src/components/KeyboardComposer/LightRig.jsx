import { useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls, button } from 'leva'
import { easing } from 'maath'
import * as THREE from 'three'
import { Html, useHelper, TransformControls } from '@react-three/drei'
// Inizializzazione GLOBALE: deve avvenire prima che i materiali PBR 
// vengano compilati, altrimenti le RectAreaLight vengono ignorate.
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
RectAreaLightUniformsLib.init()

import { POSE_COORD, wrapYaw } from './poseGraph'

const RIG_POSITION = [0, 0.1, 0]
const DEBUG = new URLSearchParams(window.location.search).has('debug')

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
function ShadowKeyLight({ debug }) {
  const lightRef = useRef()
  
  // 1. Aggiungiamo 'setControls' come secondo parametro estratto da useControls
  const [{ enabled, showGizmo, intensity, posX, posY, posZ, bias, normalBias }, setControls] = useControls('Ombra: Directional (Keylight)', () => ({
    enabled: { value: true, label: 'Accesa' },
    showGizmo: { value: false, label: 'Mostra Gizmo 3D' },
    intensity: { value: 0.5, min: 0, max: 2, step: 0.05 },
    posX: { value: 0, min: -10, max: 10 },
    posY: { value: 5, min: -10, max: 10 },
    posZ: { value: 2, min: -10, max: 10 },
    bias: { value: -0.0005, min: -0.005, max: 0.005, step: 0.0001 },
    normalBias: { value: 0.02, min: -0.1, max: 0.1, step: 0.001 },
  }), { collapsed: true })

  useHelper(debug && showGizmo && lightRef, THREE.DirectionalLightHelper, 1, '#00ffcc')

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
      
      {debug && showGizmo && (
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
function ShadowSpotLight({ debug }) {
  const lightRef = useRef()
  
  // 1. Estraiamo setControls anche qui
  const [{ enabled, showGizmo, intensity, angle, penumbra, distance, posX, posY, posZ, bias, normalBias }, setControls] = useControls('Ombra: Spotlight', () => ({
    enabled: { value: false, label: 'Accesa' }, 
    showGizmo: { value: false, label: 'Mostra Gizmo 3D' },
    intensity: { value: 1.0, min: 0, max: 10, step: 0.1 },
    angle: { value: 0.6, min: 0.1, max: Math.PI / 2, step: 0.01 },
    penumbra: { value: 0.5, min: 0, max: 1, step: 0.01 },
    distance: { value: 15, min: 1, max: 50, step: 0.5 },
    posX: { value: -3, min: -10, max: 10 },
    posY: { value: 4, min: -10, max: 10 },
    posZ: { value: 3, min: -10, max: 10 },
    bias: { value: -0.0005, min: -0.005, max: 0.005, step: 0.0001 },
    normalBias: { value: 0.02, min: -0.1, max: 0.1, step: 0.001 },
  }), { collapsed: true })

  useHelper(debug && showGizmo && lightRef, THREE.SpotLightHelper, '#ff00cc')

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
      
      {debug && showGizmo && (
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

export default function LightRig({ modelSize, apiRef } = {}) {
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
      margin: { value: 1.0, min: 0, max: 3, step: 0.1, label: 'Margine Scatola' },
      
      // Controlli per i Damping esposti per il Tuning
      animMarginDamp: { value: 0.25, min: 0.01, max: 1, step: 0.01, label: 'Velocità Margine' },
      animLightOnDamp: { value: 0.08, min: 0.01, max: 1, step: 0.01, label: 'Velocità Accensione' },
      animLightOffDamp: { value: 0.25, min: 0.01, max: 1, step: 0.01, label: 'Velocità Spegnimento' },
      animColorDamp: { value: 0.35, min: 0.01, max: 1, step: 0.01, label: 'Velocità Colore' },

      'Scarica JSON': button(() => {
        if (activePoseRef.current && currentControlsRef.current) {
          configsRef.current[activePoseRef.current].margin = currentControlsRef.current.margin
          configsRef.current[activePoseRef.current].showHelpers = currentControlsRef.current.showHelpers
          configsRef.current[activePoseRef.current].showSurfaces = currentControlsRef.current.showSurfaces
        }
        const json = JSON.stringify(configsRef.current, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'light-rig-config.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }),
      
      'Carica da JSON': button(() => {
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
              configsRef.current = parsed
              let alertMsg = "Configurazione caricata con successo!"
              const currentPose = activePoseRef.current
              if (currentPose) {
                if (parsed[currentPose]) {
                  const newConfig = { ...generateDefaultConfig(), ...parsed[currentPose] }
                  setControls({ 
                    margin: newConfig.margin, 
                    showHelpers: newConfig.showHelpers,
                    showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers 
                  })
                } else {
                  alertMsg += `\n\nAttenzione: Nessuna impostazione per la vista attuale (${currentPose}). Rimarrà ai default.`
                  const def = generateDefaultConfig()
                  setControls({ margin: def.margin, showHelpers: def.showHelpers, showSurfaces: def.showSurfaces })
                }
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
      }),

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

  const [controls, setControls] = useControls('Impostazioni Globali Vista', () => schema, { collapsed: true })
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

  useEffect(() => {
    // Eseguiamo il fetch solo fuori dal debug
    if (!DEBUG) {
      // Assicurati che il nome del file generato combaci con quello esportato
      fetch('/lightconfig/light-rig-config.json')
        .then((res) => {
          if (!res.ok) throw new Error('File di configurazione non trovato');
          return res.json();
        })
        .then((data) => {
          // Aggiorna le configurazioni con i dati scaricati
          configsRef.current = data;
          
          // Se c'è già una vista attiva caricata, forza l'aggiornamento dei valori
          if (activePoseRef.current && data[activePoseRef.current]) {
            const newConfig = { ...generateDefaultConfig(), ...data[activePoseRef.current] };
            setControls({ 
              margin: newConfig.margin, 
              showHelpers: newConfig.showHelpers,
              showSurfaces: newConfig.showSurfaces !== undefined ? newConfig.showSurfaces : newConfig.showHelpers 
            });
          }
        })
        .catch((err) => {
          console.warn('Impossibile caricare il JSON delle luci, applico i default:', err.message);
        });
    }
  }, [setControls]);

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
    if (layers.top) layers.top.forEach((_, i) => checkLight('top', i, `Top ${i}`))
    if (layers.mid) layers.mid.forEach((_, i) => checkLight('mid', i, `Mid ${i}`))
    if (layers.bot) layers.bot.forEach((_, i) => checkLight('bot', i, `Bot ${i}`))

    return active
  }, [activePose, lightEditor.intensity, faces, layers])
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

    const isVisiblePoints = DEBUG && currentCtrl.showHelpers
    const isVisibleSurfaces = DEBUG && currentCtrl.showSurfaces

    const updateLightGroup = (lightsArray, helpersArray, groupsArray, prefix, gridItems) => {
      gridItems.forEach((gridItem, i) => {
        const light = lightsArray.current[i]
        const helper = helpersArray.current[i]
        const group = groupsArray.current[i]
        if (!light) return

        // 2. MUOVI IL GRUPPO FLUIDAMENTE IN BASE AL MARGINE
        if (group) {
            const px = gridItem.x === 0 ? 0 : (modelSize.x / 2 + m) * gridItem.x
            const py = gridItem.y === 0 ? 0 : (modelSize.y / 2 + m) * gridItem.y
            const pz = gridItem.z === 0 ? 0 : (modelSize.z / 2 + m) * gridItem.z
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
      const w = modelSize.x + m * 2
      const h = modelSize.y + m * 2
      const d = modelSize.z + m * 2
  
      const dynamicFaces = {
        top: { pos: [0, h/2, 0], args: [w, d] },
        bot: { pos: [0, -h/2, 0], args: [w, d] },
        left: { pos: [-w/2, 0, 0], args: [d, h] },
        right: { pos: [w/2, 0, 0], args: [d, h] },
        front: { pos: [0, 0, d/2], args: [w, h] },
        back: { pos: [0, 0, -d/2], args: [w, h] }
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

    updateLightGroup(topLights, topHelpers, topGroups, 'top', layers.top)
    updateLightGroup(midLights, midHelpers, midGroups, 'mid', layers.mid)
    updateLightGroup(botLights, botHelpers, botGroups, 'bot', layers.bot)
    updateSurfGroup()
  })

  const handleEntityClick = (e, layerPrefix, i) => {
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

  return (
    <group position={RIG_POSITION}>
      
      {/* NUOVE LUCI CON GIZMO 3D */}
      <ShadowKeyLight debug={DEBUG} />
      <ShadowSpotLight debug={DEBUG} />

      {DEBUG && (controls.showHelpers || controls.showSurfaces) && (
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
              onChange={(e) => {
                if (!e.target.value) { setSelectedLight(null); return; }
                const [layer, idx] = e.target.value.split('_');
                setSelectedLight({ layer, index: layer === 'surf' ? idx : parseInt(idx, 10) });
              }}
              style={{
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
                appearance: 'auto'
              }}
            >
              <option value="">-- Seleziona Luce GLOBALE --</option>
              <optgroup label="Facce (Superfici)">
                {faces.map(f => <option key={`surf_${f.index}`} value={`surf_${f.index}`}>Superficie {f.index.toUpperCase()}</option>)}
              </optgroup>
              <optgroup label="Griglia Top">
                {layers.top.map((_, i) => <option key={`top_${i}`} value={`top_${i}`}>Top {i}</option>)}
              </optgroup>
              <optgroup label="Griglia Mid">
                {layers.mid.map((_, i) => <option key={`mid_${i}`} value={`mid_${i}`}>Mid {i}</option>)}
              </optgroup>
              <optgroup label="Griglia Bot">
                {layers.bot.map((_, i) => <option key={`bot_${i}`} value={`bot_${i}`}>Bot {i}</option>)}
              </optgroup>
            </select>

            {/* 2. NUOVO SELETTORE (Solo Luci Attive in questa vista) */}
            <select
              value={selectedLight ? `${selectedLight.layer}_${selectedLight.index}` : ''}
              onChange={(e) => {
                if (!e.target.value) { setSelectedLight(null); return; }
                const [layer, idx] = e.target.value.split('_');
                setSelectedLight({ layer, index: layer === 'surf' ? idx : parseInt(idx, 10) });
              }}
              style={{
                background: 'rgba(20, 50, 80, 0.85)', // Sfondo leggermente blu/diverso per distinguerlo
                border: '1px solid rgba(100, 180, 255, 0.4)',
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
                appearance: 'auto'
              }}
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
          >
            {/* args statici a 1x1, si scala il nodo nel loop piuttosto che ricreare la geometria costantemente */}
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {layers.top.map((gridItem, i) => (
        <group key={`top-${i}`} ref={el => { if (el) topGroups.current[i] = el }}>
          <pointLight intensity={0} ref={el => { if (el) topLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) topHelpers.current[i] = el }}
            onClick={(e) => handleEntityClick(e, 'top', i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      ))}

      {layers.mid.map((gridItem, i) => (
        <group key={`mid-${i}`} ref={el => { if (el) midGroups.current[i] = el }}>
          <pointLight intensity={0} ref={el => { if (el) midLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) midHelpers.current[i] = el }}
            onClick={(e) => handleEntityClick(e, 'mid', i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      ))}

      {layers.bot.map((gridItem, i) => (
        <group key={`bot-${i}`} ref={el => { if (el) botGroups.current[i] = el }}>
          <pointLight intensity={0} ref={el => { if (el) botLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) botHelpers.current[i] = el }}
            onClick={(e) => handleEntityClick(e, 'bot', i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      ))}

    </group>
  )
}