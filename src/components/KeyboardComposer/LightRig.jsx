import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'

/**
 * Rig luci solidale alla camera — impianto DIAGONALE avvolgente (round 8,
 * sketch cliente su vista top). Il group è ancorato al pivot del modello e
 * ogni frame copia l'orientamento della camera: le luci restano fisse
 * rispetto al frame mentre il prodotto ruota dentro lo studio.
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro):
 *  - keyMain: sorgente DOMINANTE da alto-sinistra, radente — rastrella di
 *             taglio la faccia visibile facendo "rotolare" la luce sui
 *             keycaps (è ciò che genera la FORMA). Unico shadow caster.
 *  - keyFill: seconda sorgente all'angolo OPPOSTO basso-destra, debole —
 *             risale a sollevare il lato in ombra senza pareggiare il
 *             gradiente (la diagonale key→fill è ciò che evita il "piatto").
 *
 * NB round 8: rimosso il point light frontale del round 7 — riempiva ogni
 * faccia in modo uniforme e appiattiva le pose inclinate (il 45 laterale su
 * tutte). La leggibilità delle pose scure resta garantita dalla cupola
 * diffusa (Environment) e dalla luce orbitale sotto (KeyboardModel.jsx).
 *
 * Il "filo di luce" continuo che avvolge i bordi (top → angolo alto-destra →
 * lato destro → basso-destra) vive nell'Environment (Scene.jsx): sono
 * riflessi speculari, non luci dirette.
 *
 * Tutti i valori sono regolabili dal vivo con `?debug`: i default qui sotto
 * SONO i valori di produzione (vedi GUIDA-TUNING.md).
 */

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

export default function LightRig() {
  const camera = useThree((s) => s.camera)
  const rigRef = useRef()
  const keyMainRef = useRef()
  const keyFillRef = useRef()
  const targetRef = useRef()

  const keyMain = useControls('Luci · key principale (alto-sx)', {
    intensity: { value: 16, min: 0, max: 200, step: 1 },
    position: { value: [-3.2, 3.2, 2.2] },
    angle: { value: 0.6, min: 0.1, max: 1.2 },
    penumbra: { value: 0.9, min: 0, max: 1 },
  })
  const keyFill = useControls('Luci · fill (basso-dx)', {
    intensity: { value: 6, min: 0, max: 200, step: 1 },
    position: { value: [3, -2.2, 2.2] },
    angle: { value: 0.7, min: 0.1, max: 1.2 },
    penumbra: { value: 1, min: 0, max: 1 },
  })

  // I target sono figli del rig (matrixWorld aggiornata dal grafo scena) e
  // vanno assegnati imperativamente.
  useLayoutEffect(() => {
    keyMainRef.current.target = targetRef.current
    keyFillRef.current.target = targetRef.current
  }, [])

  // Le luci seguono la camera: oggi la camera non ruota (solo dolly), ma se
  // in futuro orbiterà il rig la seguirà da solo.
  useFrame(() => {
    rigRef.current.quaternion.copy(camera.quaternion)
  })

  return (
    <group ref={rigRef} position={RIG_POSITION}>
      <spotLight
        ref={keyMainRef}
        castShadow
        position={keyMain.position}
        intensity={keyMain.intensity}
        angle={keyMain.angle}
        penumbra={keyMain.penumbra}
        decay={1.4}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <spotLight
        ref={keyFillRef}
        position={keyFill.position}
        intensity={keyFill.intensity}
        angle={keyFill.angle}
        penumbra={keyFill.penumbra}
        decay={1.4}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
    </group>
  )
}
