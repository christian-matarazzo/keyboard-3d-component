import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

/**
 * Rig luci da studio fotografico, solidale alla camera.
 *
 * Il group è ancorato al pivot del modello e ogni frame copia l'orientamento
 * della camera: le luci ruotano con il punto di vista (come uno studio che si
 * muove col fotografo) ma restano a distanza costante dal soggetto, quindi
 * intensità e ombre non cambiano con lo zoom (la camera fa solo dolly).
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro):
 *  - main:  dall'alto, leggermente angolata a destra/avanti (unico shadow caster)
 *  - fill:  due laterali morbide, sinistra appena più intensa e fredda
 *  - rim:   da dietro il soggetto, fredda — taglio di luce sulla silhouette
 */

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

const MAIN = { position: [0.9, 4.2, 2.2], intensity: 90, angle: 0.5, penumbra: 0.85, decay: 1.4 }
const FILL_LEFT = { position: [-3.5, 0.8, 1.8], intensity: 0.6, color: '#e8ecff' }
const FILL_RIGHT = { position: [3.5, 0.8, 1.8], intensity: 0.45, color: '#ffffff' }
const RIM = { position: [0, 2.2, -4.5], intensity: 70, angle: 0.6, penumbra: 1, decay: 1.5, color: '#a9c1ff' }
const RIM_TARGET = [0, 0.3, 0] // mira leggermente alta: bordo più marcato sul profilo superiore

export default function LightRig() {
  const camera = useThree((s) => s.camera)
  const rigRef = useRef()
  const mainRef = useRef()
  const fillLeftRef = useRef()
  const fillRightRef = useRef()
  const rimRef = useRef()
  const targetRef = useRef()
  const rimTargetRef = useRef()

  // I target sono figli del rig (quindi nel grafo scena: matrixWorld
  // aggiornata automaticamente) e vanno assegnati imperativamente.
  useLayoutEffect(() => {
    mainRef.current.target = targetRef.current
    fillLeftRef.current.target = targetRef.current
    fillRightRef.current.target = targetRef.current
    rimRef.current.target = rimTargetRef.current
  }, [])

  // Il contratto "le luci seguono la camera": oggi la camera non ruota
  // (solo dolly), ma se in futuro orbiterà il rig la seguirà da solo.
  useFrame(() => {
    rigRef.current.quaternion.copy(camera.quaternion)
  })

  return (
    <group ref={rigRef} position={RIG_POSITION}>
      <spotLight
        ref={mainRef}
        castShadow
        position={MAIN.position}
        intensity={MAIN.intensity}
        angle={MAIN.angle}
        penumbra={MAIN.penumbra}
        decay={MAIN.decay}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <directionalLight
        ref={fillLeftRef}
        position={FILL_LEFT.position}
        intensity={FILL_LEFT.intensity}
        color={FILL_LEFT.color}
      />
      <directionalLight
        ref={fillRightRef}
        position={FILL_RIGHT.position}
        intensity={FILL_RIGHT.intensity}
        color={FILL_RIGHT.color}
      />
      <spotLight
        ref={rimRef}
        position={RIM.position}
        intensity={RIM.intensity}
        angle={RIM.angle}
        penumbra={RIM.penumbra}
        decay={RIM.decay}
        color={RIM.color}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
      <object3D ref={rimTargetRef} position={RIM_TARGET} />
    </group>
  )
}
