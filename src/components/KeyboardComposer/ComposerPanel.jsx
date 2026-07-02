import styles from './KeyboardComposer.module.css'
import ColorPill from './ColorPill'
import FeaturePill from './FeaturePill'

export default function ComposerPanel({
  finishes,
  selectedFinishId,
  onSelectFinish,
  features,
  onFeatureClick,
}) {
  return (
    <div className={styles.panel}>
      <ColorPill
        finishes={finishes}
        selectedId={selectedFinishId}
        onSelect={onSelectFinish}
      />
      {features.map((feature) => (
        <FeaturePill
          key={feature}
          label={feature}
          onClick={() => onFeatureClick?.(feature)}
        />
      ))}
    </div>
  )
}
