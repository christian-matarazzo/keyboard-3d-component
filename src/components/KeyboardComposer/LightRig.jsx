import { useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls, button } from 'leva'
import { easing } from 'maath'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { POSE_COORD, wrapYaw } from './poseGraph'

const RIG_POSITION = [0, 0.1, 0]

// Rileva se siamo in modalità debug
const DEBUG = new URLSearchParams(window.location.search).has('debug')

const generateDefaultConfig = () => {
  const def = { margin: 1.0, showHelpers: true } 
  for (let i = 0; i < 9; i++) { def[`top_${i}_intensity`] = 0; def[`top_${i}_color`] = '#ffffff'; def[`top_${i}_decay`] = 2; }
  for (let i = 0; i < 8; i++) { def[`mid_${i}_intensity`] = 0; def[`mid_${i}_color`] = '#ffffff'; def[`mid_${i}_decay`] = 2; }
  for (let i = 0; i < 9; i++) { def[`bot_${i}_intensity`] = 0; def[`bot_${i}_color`] = '#ffffff'; def[`bot_${i}_decay`] = 2; }
  return def
}

export default function LightRig({ modelSize, apiRef } = {}) {
  const configsRef = useRef({}) 
  const prevPoseRef = useRef(null) 
  const activePoseRef = useRef(null) 
  
  const [activePose, setActivePose] = useState(null) 
  const [selectedLight, setSelectedLight] = useState(null) 
  const [lightEditor, setLightEditor] = useState({ intensity: 0, color: '#ffffff', decay: 2 })

  const topLights = useRef([]); const topHelpers = useRef([])
  const midLights = useRef([]); const midHelpers = useRef([])
  const botLights = useRef([]); const botHelpers = useRef([])
  const labelRef = useRef(null)

  // Nuovi ref per gestire la transizione organica
  const prevCamRef = useRef({ pitch: 0, yaw: 0, initialized: false })
  const transitionRef = useRef({ totalDist: 0, progress: 1 })

  // --- 1. COSTRUZIONE DELLO SCHEMA DI LEVA (Sempre montato per gestire lo stato, nascosto dal CSS in prod) ---
  const schema = useMemo(() => {
    return {
      showHelpers: { value: false, label: 'Mostra Punti' },
      margin: { value: 1.0, min: 0, max: 3, step: 0.1, label: 'Margine Array' },
      
      'Scarica JSON': button(() => {
        if (activePoseRef.current && currentControlsRef.current) {
          configsRef.current[activePoseRef.current].margin = currentControlsRef.current.margin
          configsRef.current[activePoseRef.current].showHelpers = currentControlsRef.current.showHelpers
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
                  setControls({ margin: newConfig.margin, showHelpers: newConfig.showHelpers })
                } else {
                  alertMsg += `\n\nAttenzione: Nessuna impostazione per la vista attuale (${currentPose}). Rimarrà ai valori di default.`
                  const def = generateDefaultConfig()
                  setControls({ margin: def.margin, showHelpers: def.showHelpers })
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
          configsRef.current[activePoseRef.current] = def
          setControls({ margin: def.margin })
          setSelectedLight(null)
        }
      })
    }
  }, [])

  const [controls, setControls] = useControls('Impostazioni Globali Vista', () => schema)
  const currentControlsRef = useRef(controls)
  currentControlsRef.current = controls

  useEffect(() => {
    if (activePoseRef.current && configsRef.current[activePoseRef.current]) {
      configsRef.current[activePoseRef.current].margin = controls.margin
      configsRef.current[activePoseRef.current].showHelpers = controls.showHelpers
    }
  }, [controls.margin, controls.showHelpers])

  // --- 2. GESTIONE CAMBIO VISTA (AUTO-SAVE / LOAD) ---
  useEffect(() => {
    if (!activePose) return

    if (!configsRef.current[activePose]) {
      configsRef.current[activePose] = generateDefaultConfig()
    }

    const newConfig = configsRef.current[activePose]
    
    setControls({ margin: newConfig.margin, showHelpers: newConfig.showHelpers })
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

  // --- 3. COSTRUZIONE MATRICE 3D FISICA ---
  const layers = useMemo(() => {
    if (!modelSize) return { top: [], mid: [], bot: [] }
    const m = controls.margin || 1.0
    const xs = [-modelSize.x / 2 - m, 0, modelSize.x / 2 + m]
    const ys = [modelSize.y / 2 + m, 0, -modelSize.y / 2 - m]
    const zs = [-modelSize.z / 2 - m, 0, modelSize.z / 2 + m]
    
    const top = [], mid = [], bot = []
    
    for (let y of ys) {
      for (let z of zs) {
        for (let x of xs) {
          if (Math.abs(y) < 0.001 && Math.abs(x) < 0.001 && Math.abs(z) < 0.001) continue
          const pos = [x, y, z]
          if (y > 0.001) top.push(pos)
          else if (y < -0.001) bot.push(pos)
          else mid.push(pos)
        }
      }
    }
    return { top, mid, bot }
  }, [modelSize, controls.margin])

  // --- 4. RENDER LOOP ---
  useFrame((state, delta) => {
    const poseKey = apiRef?.current?.currentPoseKey?.()
    
    // 1. Rileva il cambio vista e imposta i parametri per la transizione
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

    // 2. Leggi le rotazioni assolute correnti della camera
    const camEuler = new THREE.Euler().setFromQuaternion(state.camera.quaternion, 'YXZ')
    const currentPitch = -camEuler.x
    const currentYaw = -camEuler.y
    
    if (!prevCamRef.current.initialized) {
      prevCamRef.current.pitch = currentPitch
      prevCamRef.current.yaw = currentYaw
      prevCamRef.current.initialized = true
    }
    
    // 3. Calcola quanto si è mossa la camera in questo frame
    const deltaPitch = currentPitch - prevCamRef.current.pitch
    const deltaYaw = wrapYaw(currentYaw - prevCamRef.current.yaw)
    const moveDist = Math.hypot(deltaPitch, deltaYaw)
    
    prevCamRef.current.pitch = currentPitch
    prevCamRef.current.yaw = currentYaw

    // 4. Aggiorna il progresso [0 -> 1] in base al movimento effettivo
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

    // Se stiamo animando tra viste il damp è molto reattivo per incollarsi alla camera. 
    // Quando la transizione finisce (p=1) un pochino più morbido (0.25).
    const currentDamp = p < 1 ? 0.05 : 0.25 
    const isVisible = DEBUG && controls.showHelpers

    const updateLightGroup = (lightsArray, helpersArray, prefix) => {
      lightsArray.current.forEach((light, i) => {
        if (!light) return
        
        const targetIntensity = lerpVal(`${prefix}_${i}_intensity`, 0)
        const targetDecay = lerpVal(`${prefix}_${i}_decay`, 2)
        const targetColor = targetC[`${prefix}_${i}_color`] || '#ffffff'
        
        easing.damp(light, 'intensity', targetIntensity, currentDamp, delta)
        easing.damp(light, 'decay', targetDecay, currentDamp, delta)
        easing.dampC(light.color, targetColor, 0.35, delta)

        const helper = helpersArray.current[i]
        if (helper) {
          helper.visible = isVisible
          if (isVisible) {
            const isSelected = selectedLight?.layer === prefix && selectedLight?.index === i
            
            if (isSelected) {
              easing.damp(helper.scale, 'x', 1.2, currentDamp, delta)
              easing.damp(helper.scale, 'y', 1.2, currentDamp, delta)
              easing.damp(helper.scale, 'z', 1.2, currentDamp, delta)
              easing.dampC(helper.material.color, '#00ff44', currentDamp, delta) 
              helper.material.opacity = 1.0
            } else {
              const targetScale = 0.5 + (targetIntensity / 50) * 1.5 
              easing.damp(helper.scale, 'x', targetScale, currentDamp, delta)
              easing.damp(helper.scale, 'y', targetScale, currentDamp, delta)
              easing.damp(helper.scale, 'z', targetScale, currentDamp, delta)
              easing.dampC(helper.material.color, targetColor, currentDamp, delta)
              helper.material.opacity = Math.max(0.1, targetIntensity / 50)
            }
          }
        }
      })
    }

    updateLightGroup(topLights, topHelpers, 'top')
    updateLightGroup(midLights, midHelpers, 'mid')
    updateLightGroup(botLights, botHelpers, 'bot')
  })

  const handleSphereClick = (e, layerPrefix, i) => {
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

  return (
    <group position={RIG_POSITION}>
      
      {/* HTML FULLSCREEN (Reso solo se siamo in debug e showHelpers è true) */}
      {DEBUG && controls.showHelpers && (
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
                <h3 style={{ margin: 0, fontSize: '16px', color: '#4dabf7' }}>
                  LUCE {selectedLight.layer.toUpperCase()} {selectedLight.index}
                </h3>
                <button 
                  onClick={() => setSelectedLight(null)}
                  style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
                >✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600' }}>
                  Intensità: {lightEditor.intensity.toFixed(1)}
                </label>
                <input 
                  type="range" min="0" max="50" step="0.1" 
                  value={lightEditor.intensity} 
                  onChange={(e) => updateLightValue('intensity', parseFloat(e.target.value))}
                  style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600' }}>Colore:</label>
                <input 
                  type="color" 
                  value={lightEditor.color} 
                  onChange={(e) => updateLightValue('color', e.target.value)}
                  style={{ width: '100%', height: '32px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600' }}>
                  Decadimento: {lightEditor.decay.toFixed(1)}
                </label>
                <input 
                  type="range" min="0" max="5" step="0.1" 
                  value={lightEditor.decay} 
                  onChange={(e) => updateLightValue('decay', parseFloat(e.target.value))}
                  style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
                />
              </div>
            </div>
          )}
        </Html>
      )}

      {/* RENDER FISICO DELLE LUCI */}
      {layers.top.map((pos, i) => (
        <group key={`top-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => { if (el) topLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) topHelpers.current[i] = el }}
            onClick={(e) => handleSphereClick(e, 'top', i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      ))}

      {layers.mid.map((pos, i) => (
        <group key={`mid-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => { if (el) midLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) midHelpers.current[i] = el }}
            onClick={(e) => handleSphereClick(e, 'mid', i)}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            renderOrder={999}
          >
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshBasicMaterial transparent opacity={0.1} wireframe depthTest={false} depthWrite={false} color="#ffffff" />
          </mesh>
        </group>
      ))}

      {layers.bot.map((pos, i) => (
        <group key={`bot-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => { if (el) botLights.current[i] = el }} distance={fixedDistance} />
          <mesh 
            ref={el => { if (el) botHelpers.current[i] = el }}
            onClick={(e) => handleSphereClick(e, 'bot', i)}
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