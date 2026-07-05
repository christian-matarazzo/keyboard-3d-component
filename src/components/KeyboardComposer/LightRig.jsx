import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'

/**
 * Rig luci solidale alla camera — 1:1 con `rig set/light disposition .jpeg`.
 *
 * Il group è ancorato al pivot del modello e ogni frame copia l'orientamento
 * della camera: le luci ruotano con il punto di vista (come uno studio che si
 * muove col fotografo) ma restano a distanza costante dal soggetto.
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro).
 * Le due FRECCE VERDI del riferimento = due luci chiave che entrano in
 * diagonale dagli angoli alto-sinistra e alto-destra, puntate al prodotto:
 *  - keyLeft:  spot alto-sinistra (unico shadow caster) — il lato sinistro
 *              del riferimento è il più acceso
 *  - keyRight: spot alto-destra, gemella più debole
 *  - front:    point light debole vicino camera — riempie OGNI orientamento
 *              senza appiattire il falloff verso il nero del riferimento
 * Le strip verdi lungo i bordi (sinistra piena, destra parziale, top) vivono
 * nell'Environment (Scene.jsx): sono riflessi speculari, non luci dirette.
 *
 * Tutti i valori sono regolabili dal vivo aprendo il sito con `?debug`:
 * i default qui sotto SONO i valori di produzione (vedi GUIDA-TUNING.md).
 */

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

export default function LightRig() {
  const camera = useThree((s) => s.camera)
  const rigRef = useRef()
  const keyLeftRef = useRef()
  const keyRightRef = useRef()
  const frontRef = useRef()
  const targetRef = useRef()

  const keyLeft = useControls('Luci · key sx (freccia)', {
    intensity: { value: 14, min: 0, max: 200, step: 1 },
    position: { value: [-3, 4, 2.2] },
    angle: { value: 0.55, min: 0.1, max: 1.2 },
    penumbra: { value: 0.9, min: 0, max: 1 },
  })
  const keyRight = useControls('Luci · key dx (freccia)', {
    intensity: { value: 8, min: 0, max: 200, step: 1 },
    position: { value: [3, 4, 2.2] },
    angle: { value: 0.55, min: 0.1, max: 1.2 },
    penumbra: { value: 0.9, min: 0, max: 1 },
  })
  const front = useControls('Luci · frontale', {
    intensity: { value: 3, min: 0, max: 10, step: 0.25 },
    color: '#ffffff',
  })

  // I target sono figli del rig (quindi nel grafo scena: matrixWorld
  // aggiornata automaticamente) e vanno assegnati imperativamente.
  useLayoutEffect(() => {
    keyLeftRef.current.target = targetRef.current
    keyRightRef.current.target = targetRef.current
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
        ref={keyLeftRef}
        castShadow
        position={keyLeft.position}
        intensity={keyLeft.intensity}
        angle={keyLeft.angle}
        penumbra={keyLeft.penumbra}
        decay={1.4}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <spotLight
        ref={keyRightRef}
        position={keyRight.position}
        intensity={keyRight.intensity}
        angle={keyRight.angle}
        penumbra={keyRight.penumbra}
        decay={1.4}
      />
      <pointLight
        ref={frontRef}
        position={[0, 0.6, 5]}
        intensity={front.intensity}
        decay={1.2}
        color={front.color}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
    </group>
  )
}
