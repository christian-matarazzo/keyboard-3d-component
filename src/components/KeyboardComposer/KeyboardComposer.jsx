import { useState } from 'react'
import { useProgress } from '@react-three/drei'
import styles from './KeyboardComposer.module.css'
import ComposerPanel from './ComposerPanel'
import Scene from './Scene'
import { DEFAULT_MODEL_URL } from './KeyboardModel'
import { finishes as defaultFinishes, getFinish } from './materials/registry'

const DEFAULT_FEATURES = [
  'Switch magnetici',
  'Struttura in alluminio',
  'Piastre intercambiabili',
  'Smorzamento acustico',
  'Layout ISO italiano',
]

/**
 * Configuratore 3D della tastiera — sezione autonoma stile "Guardalo da
 * vicino": pannello pillole a sinistra, canvas Three.js a destra.
 * Trascina per ruotare (snap a 45°), swatch per cambiare finitura live.
 */
export default function KeyboardComposer({
  modelUrl = DEFAULT_MODEL_URL,
  finishes = defaultFinishes,
  features = DEFAULT_FEATURES,
  onFinishChange,
  onFeatureClick,
}) {
  const [selectedFinishId, setSelectedFinishId] = useState(finishes[0]?.id)
  const finish = getFinish(finishes, selectedFinishId)
  const { progress } = useProgress()
  const loaded = progress === 100

  const selectFinish = (id) => {
    setSelectedFinishId(id)
    onFinishChange?.(id)
  }

  return (
    <section className={styles.section}>
      <ComposerPanel
        finishes={finishes}
        selectedFinishId={selectedFinishId}
        onSelectFinish={selectFinish}
        features={features}
        onFeatureClick={onFeatureClick}
      />
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene modelUrl={modelUrl} finish={finish} />
      </div>
    </section>
  )
}
