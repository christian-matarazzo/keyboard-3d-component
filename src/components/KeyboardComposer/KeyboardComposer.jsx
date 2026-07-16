import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { Leva } from 'leva'
import styles from './KeyboardComposer.module.css'
import Scene from './Scene'
import ViewPad from './ViewPad'
import { DEFAULT_MODEL_URL } from './KeyboardModel'
import { finishes as defaultFinishes, getFinish } from './materials/registry'

// Pannello di tuning (luci, materiali, resa) visibile solo con `?debug`
// nell'URL: in produzione il canvas resta pulito, a tutto schermo.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

/**
 * Vetrina 3D della tastiera a piena vista: nessun pannello di configurazione,
 * solo il modello. Trascina in verticale per il flusso front/retro a step di
 * 45°; in vista frontale trascina in orizzontale per i ±45° laterali.
 */
export default function KeyboardComposer({
  modelUrl = DEFAULT_MODEL_URL,
  finishes = defaultFinishes,
  finishId,
}) {
  const finish = getFinish(finishes, finishId)
  const { progress } = useProgress()
  // Stato (non derivato al volo da `progress`): con l'asset già in cache
  // (visita successiva, mobile o desktop) `progress` può essere 100 già al
  // primissimo render, prima che il browser abbia dipinto lo stato opacity:0
  // di partenza — la transizione CSS del fade non avrebbe nulla da cui
  // animare e sparirebbe. Il giro di rAF garantisce che il primo paint
  // avvenga sempre a opacità 0, così il fade-in resta visibile in ogni caso.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (progress !== 100) return
    const raf = requestAnimationFrame(() => setLoaded(true))
    return () => cancelAnimationFrame(raf)
  }, [progress])

  // Ponte fra la pulsantiera (DOM) e i controlli (dentro il Canvas): il ref
  // viene popolato da useComposerControls con `{ goTo(poseKey) }`.
  const poseApi = useRef(null)

  return (
    <section className={styles.section}>
      <Leva hidden={!DEBUG} collapsed />
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene modelUrl={modelUrl} finish={finish} apiRef={poseApi} />
        <ViewPad apiRef={poseApi} />
      </div>
    </section>
  )
}
