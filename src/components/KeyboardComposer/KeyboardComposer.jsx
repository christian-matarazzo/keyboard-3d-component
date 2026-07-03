import { useProgress } from '@react-three/drei'
import { Leva } from 'leva'
import styles from './KeyboardComposer.module.css'
import Scene from './Scene'
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
  const loaded = progress === 100

  return (
    <section className={styles.section}>
      <Leva hidden={!DEBUG} collapsed />
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene modelUrl={modelUrl} finish={finish} />
      </div>
    </section>
  )
}
