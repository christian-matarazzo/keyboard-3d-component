import styles from './KeyboardComposer.module.css'

export default function FeaturePill({ label, onClick }) {
  return (
    <button type="button" className={styles.pill} onClick={onClick}>
      <span className={styles.plusIcon} aria-hidden="true">
        +
      </span>
      {label}
    </button>
  )
}
