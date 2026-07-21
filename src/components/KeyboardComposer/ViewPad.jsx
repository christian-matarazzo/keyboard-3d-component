import styles from './KeyboardComposer.module.css'
import { VIEW_SHORTCUTS } from './poseGraph'

// Le 4 viste richieste mappate sullo stile Sci-Fi
const SCIFI_POSES = [
  { id: 'up', label: 'POSA_01' },
  { id: 'left', label: 'POSA_02' },
  { id: 'right', label: 'POSA_03' },
  { id: 'down', label: 'POSA_04' },
]

export default function ViewPad({ apiRef }) {
  const go = (dir) => () => apiRef.current?.goTo(VIEW_SHORTCUTS[dir])

  return (
    <div className={styles.sciFiSidebar} role="group" aria-label="Selettore Viste">
      <div className={styles.sciFiSidebarTitle}>// SEQUENCE_INIT</div>
      {SCIFI_POSES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={styles.sciFiBtn}
          onClick={go(id)}
        >
          <span className={styles.sciFiPrefix}>&gt;</span> {label}
        </button>
      ))}
    </div>
  )
}