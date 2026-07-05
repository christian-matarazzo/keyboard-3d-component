import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'

/**
 * Rig luci solidale alla camera — impianto DIAGONALE avvolgente (round 8,
 * sketch cliente su vista top) + rake laterale e rim di profondità (round 9).
 * Il group è ancorato al pivot del modello e ogni frame copia l'orientamento
 * della camera: le luci restano fisse rispetto al frame mentre il prodotto
 * ruota dentro lo studio.
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro):
 *  - keyMain: sorgente DOMINANTE da alto-sinistra, radente — rastrella di
 *             taglio la faccia visibile facendo "rotolare" la luce sui
 *             keycaps (è ciò che genera la FORMA). Unico shadow caster.
 *  - keyFill: seconda sorgente all'angolo OPPOSTO basso-destra, debole —
 *             risale a sollevare il lato in ombra senza pareggiare il
 *             gradiente (la diagonale key→fill evita il "piatto").
 *  - rake:    luce RADENTE dal lato, quasi orizzontale — spazzola le facce
 *             rivolte alla camera nelle elevazioni a pitch 0 (front/back/
 *             laterali), dove la key colpisce solo i top e le facce frontali
 *             resterebbero al buio. Rivela il rilievo come filo di luce sui
 *             bordi, NON come fill piatto (round 9).
 *  - rim:     kicker da dietro-alto — accende il bordo lontano della sagoma
 *             così il prodotto si stacca dal fondo nero: è il principale
 *             segnale di PROFONDITÀ su set nero (round 9).
 *
 * NB (round 8): nessun point light frontale — riempiva ogni faccia in modo
 * uniforme e appiattiva le pose inclinate. La leggibilità delle pose scure
 * resta garantita dalla cupola diffusa (Environment) e dall'orbitale sotto
 * (KeyboardModel.jsx). Il dettaglio delle facce frontali lo dà il RAKE, non
 * un frontale.
 *
 * Il "filo di luce" continuo che avvolge i bordi vive nell'Environment
 * (Scene.jsx): sono riflessi speculari, non luci dirette.
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
  const rakeRef = useRef()
  const rimRef = useRef()
  const targetRef = useRef()
  const rimTargetRef = useRef()

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
  // Rake radente: basso e molto laterale, appena avanzato verso camera così
  // sfiora di taglio le facce frontali (rivela il rilievo). Freddo per un
  // tocco premium; intensità contenuta per non bruciare i bordi.
  const rake = useControls('Luci · rake laterale', {
    intensity: { value: 12, min: 0, max: 60, step: 0.5 },
    position: { value: [-5, 0.7, 2.2] },
    color: '#d8e2ff',
    angle: { value: 0.85, min: 0.1, max: 1.4 },
    penumbra: { value: 1, min: 0, max: 1 },
  })
  // Rim di separazione: dietro-alto, mira leggermente alta così accende il
  // bordo superiore lontano e stacca la sagoma dal nero.
  const rim = useControls('Luci · rim (profondità)', {
    intensity: { value: 14, min: 0, max: 200, step: 1 },
    position: { value: [2.4, 3.2, -3.4] },
    color: '#e6eeff',
    angle: { value: 0.6, min: 0.1, max: 1.2 },
    penumbra: { value: 1, min: 0, max: 1 },
  })

  // I target sono figli del rig (matrixWorld aggiornata dal grafo scena) e
  // vanno assegnati imperativamente.
  useLayoutEffect(() => {
    keyMainRef.current.target = targetRef.current
    keyFillRef.current.target = targetRef.current
    rakeRef.current.target = targetRef.current
    rimRef.current.target = rimTargetRef.current
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
      <spotLight
        ref={rakeRef}
        position={rake.position}
        intensity={rake.intensity}
        angle={rake.angle}
        penumbra={rake.penumbra}
        color={rake.color}
        decay={1.3}
      />
      <spotLight
        ref={rimRef}
        position={rim.position}
        intensity={rim.intensity}
        angle={rim.angle}
        penumbra={rim.penumbra}
        color={rim.color}
        decay={1.2}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
      <object3D ref={rimTargetRef} position={[0, 0.4, 0]} />
    </group>
  )
}
