import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { easing } from 'maath'
import { Html } from '@react-three/drei' // NUOVO IMPORT PER LA LABEL HTML

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

const TOP_POSES = ['TBACK', 'TOP', 'CFT', 'TL', 'TR', 'TBR', 'TBL']
const MID_POSES = ['FRONT', 'CFL', 'CFR', 'CBL', 'CBR', 'BACK']
const BOT_POSES = ['BOTTOM', 'BBACK', 'BFL', 'BFR', 'BBL', 'BBR', 'BBE', 'CFB']

export default function LightRig({ modelSize, apiRef } = {}) {
  const volumetric = useControls('Luci - Matrice Volumetrica (26 pti)', {
    intensity: { value: 2.0, min: 0, max: 50, step: 0.1 },
    color: '#ffffff',
    distance: { value: 6, min: 0, max: 30, step: 0.1 },
    decay: { value: 2, min: 0, max: 5, step: 0.1 },
    margin: { value: 1.0, min: 0, max: 3, step: 0.1 },
    showHelpers: { value: false, label: 'mostra punti' },
  })

  const topLights = useRef([])
  const midLights = useRef([])
  const botLights = useRef([])
  
  // Nuove ref per nascondere/mostrare le sferette wireframe
  const topHelpers = useRef([])
  const midHelpers = useRef([])
  const botHelpers = useRef([])
  
  // Ref per l'etichetta HTML
  const labelRef = useRef(null)

  const intensities = useRef({ top: 0, mid: 0, bot: 0 })

  topLights.current = []
  midLights.current = []
  botLights.current = []
  topHelpers.current = []
  midHelpers.current = []
  botHelpers.current = []

  const layers = useMemo(() => {
    if (!modelSize) return { top: [], mid: [], bot: [] }
    const m = volumetric.margin
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
  }, [modelSize, volumetric.margin])

  useFrame((state, delta) => {
    const currentPose = apiRef?.current?.currentPoseKey?.()
    
    let targetTop = 0
    let targetMid = 0
    let targetBot = 0

    let showTop = false
    let showMid = false
    let showBot = false

    if (currentPose) {
      // Posa raggiunta: illumina e mostra solo il layer specifico
      if (TOP_POSES.includes(currentPose)) { targetTop = volumetric.intensity; showTop = true; }
      if (MID_POSES.includes(currentPose)) { targetMid = volumetric.intensity; showMid = true; }
      if (BOT_POSES.includes(currentPose)) { targetBot = volumetric.intensity; showBot = true; }
      
      // Aggiorna l'etichetta UI
      if (labelRef.current) labelRef.current.innerText = `Vista attiva: ${currentPose}`
    } else {
      // In transizione: accende tutto per mostrare il movimento in modo spettacolare
      targetTop = targetMid = targetBot = volumetric.intensity
      showTop = showMid = showBot = true
      
      // Aggiorna l'etichetta UI
      if (labelRef.current) labelRef.current.innerText = `Transizione in corso...`
    }

    easing.damp(intensities.current, 'top', targetTop, 0.35, delta)
    easing.damp(intensities.current, 'mid', targetMid, 0.35, delta)
    easing.damp(intensities.current, 'bot', targetBot, 0.35, delta)

    topLights.current.forEach(l => { if (l) l.intensity = intensities.current.top })
    midLights.current.forEach(l => { if (l) l.intensity = intensities.current.mid })
    botLights.current.forEach(l => { if (l) l.intensity = intensities.current.bot })

    // Gestione visibilità delle sferette wireframe (senza ricaricare React)
    topHelpers.current.forEach(h => { if (h) h.visible = showTop })
    midHelpers.current.forEach(h => { if (h) h.visible = showMid })
    botHelpers.current.forEach(h => { if (h) h.visible = showBot })
  })

  return (
    <group position={RIG_POSITION}>
      
      {/* ETICHETTA HTML IN SOVRIMPRESSIONE */}
      {volumetric.showHelpers && (
        <Html center> {/* AGGIUNTA LA PROP "center" */}
          <div
            ref={labelRef}
            style={{
              transform: 'translateY(140px)', // La spinge in basso rispetto al centro del modello
              background: 'rgba(20, 20, 20, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#4dabf7', // Azzurro tecnico
              padding: '10px 20px',
              borderRadius: '24px',
              fontFamily: 'monospace',
              fontSize: '15px',
              fontWeight: 'bold',
              pointerEvents: 'none', // Evita che blocchi i click o il drag
              whiteSpace: 'nowrap',
              zIndex: 9999,
              backdropFilter: 'blur(4px)'
            }}
          >
            Caricamento...
          </div>
        </Html>
      )}

      {/* LAYER ALTO (9 luci) */}
      {layers.top.map((pos, i) => (
        <group key={`top-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => el && topLights.current.push(el)} color={volumetric.color} distance={volumetric.distance} decay={volumetric.decay} />
          {volumetric.showHelpers && <mesh ref={el => el && topHelpers.current.push(el)}><sphereGeometry args={[0.05, 16, 16]} /><meshBasicMaterial color={volumetric.color} wireframe /></mesh>}
        </group>
      ))}

      {/* LAYER MEDIO (8 luci) */}
      {layers.mid.map((pos, i) => (
        <group key={`mid-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => el && midLights.current.push(el)} color={volumetric.color} distance={volumetric.distance} decay={volumetric.decay} />
          {volumetric.showHelpers && <mesh ref={el => el && midHelpers.current.push(el)}><sphereGeometry args={[0.05, 16, 16]} /><meshBasicMaterial color={volumetric.color} wireframe /></mesh>}
        </group>
      ))}

      {/* LAYER BASSO (9 luci) */}
      {layers.bot.map((pos, i) => (
        <group key={`bot-${i}`} position={pos}>
          <pointLight intensity={0} ref={el => el && botLights.current.push(el)} color={volumetric.color} distance={volumetric.distance} decay={volumetric.decay} />
          {volumetric.showHelpers && <mesh ref={el => el && botHelpers.current.push(el)}><sphereGeometry args={[0.05, 16, 16]} /><meshBasicMaterial color={volumetric.color} wireframe /></mesh>}
        </group>
      ))}
    </group>
  )
}