import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'

/**
 * Rig luci da studio fotografico, solidale alla camera.
 *
 * Il group è ancorato al pivot del modello e ogni frame copia l'orientamento
 * della camera: le luci ruotano con il punto di vista (come uno studio che si
 * muove col fotografo) ma restano a distanza costante dal soggetto.
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro):
 *  - main:   dall'alto, leggermente angolata a destra/avanti (unico shadow caster)
 *  - fill:   due laterali morbide, sinistra appena più intensa e fredda
 *  - front:  point light debole vicino camera — riempie OGNI orientamento
 *            (a differenza di una direzionale, non "perde" le facce girate)
 *            evitando che le pose inclinate cadano nel nero
 *  - rim:    da dietro il soggetto, fredda — taglio di luce sulla silhouette
 *
 * Tutti i valori sono regolabili dal vivo aprendo il sito con `?debug`:
 * i default qui sotto SONO i valori di produzione (vedi GUIDA-TUNING.md).
 */

const RIG_POSITION = [0, 0.1, 0] // pivot del modello
const RIM_TARGET = [0, 0.3, 0] // mira leggermente alta: bordo più marcato sopra

export default function LightRig() {
  const camera = useThree((s) => s.camera)
  const rigRef = useRef()
  const mainRef = useRef()
  const fillLeftRef = useRef()
  const fillRightRef = useRef()
  const frontRef = useRef()
  const rimRef = useRef()
  const targetRef = useRef()
  const rimTargetRef = useRef()

  const main = useControls('Luci · principale', {
    intensity: { value: 20, min: 0, max: 200, step: 1 },
    position: { value: [0.9, 4.2, 2.2] },
    angle: { value: 0.5, min: 0.1, max: 1.2 },
    penumbra: { value: 0.9, min: 0, max: 1 },
  })
  const fill = useControls('Luci · fill laterali', {
    leftIntensity: { value: 1.2, min: 0, max: 4, step: 0.05 },
    leftColor: '#e8ecff',
    rightIntensity: { value: 0.8, min: 0, max: 4, step: 0.05 },
    rightColor: '#ffffff',
  })
  const front = useControls('Luci · frontale', {
    intensity: { value: 5, min: 0, max: 10, step: 0.25 },
    color: '#ffffff',
  })
  const rim = useControls('Luci · rim (retro)', {
    intensity: { value: 6, min: 0, max: 200, step: 1 },
    position: { value: [0, 2.2, -4.5] },
    color: '#fdf8f88b',
  })

  // I target sono figli del rig (quindi nel grafo scena: matrixWorld
  // aggiornata automaticamente) e vanno assegnati imperativamente.
  useLayoutEffect(() => {
    mainRef.current.target = targetRef.current
    fillLeftRef.current.target = targetRef.current
    fillRightRef.current.target = targetRef.current
    rimRef.current.target = rimTargetRef.current
    // frontRef è un pointLight: onnidirezionale, nessun target da assegnare.
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
        position={main.position}
        intensity={main.intensity}
        angle={main.angle}
        penumbra={main.penumbra}
        decay={1.4}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <directionalLight
        ref={fillLeftRef}
        position={[-3.5, 0.8, 3.0]}
        intensity={fill.leftIntensity}
        color={fill.leftColor}
      />
      <directionalLight
        ref={fillRightRef}
        position={[3.5, 0.8, 3.0]}
        intensity={fill.rightIntensity}
        color={fill.rightColor}
      />
      <pointLight
        ref={frontRef}
        position={[0, 0.6, 5]}
        intensity={front.intensity}
        decay={1.2}
        color={front.color}
      />
      <spotLight
        ref={rimRef}
        position={rim.position}
        intensity={rim.intensity}
        angle={0.6}
        penumbra={1}
        decay={1.5}
        color={rim.color}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
      <object3D ref={rimTargetRef} position={RIM_TARGET} />
    </group>
  )
}
