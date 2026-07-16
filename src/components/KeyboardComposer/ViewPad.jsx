import styles from './KeyboardComposer.module.css'
import { VIEW_SHORTCUTS } from './poseGraph'

// Le quattro freccette, disegnate come glifi puri (niente font/icone esterne):
// un triangolo che punta nella direzione del tasto.
const GLYPH = {
  up: 'M12 7 L18 16 L6 16 Z',
  down: 'M12 17 L6 8 L18 8 Z',
  left: 'M7 12 L16 6 L16 18 Z',
  right: 'M17 12 L8 18 L8 6 Z',
}

const LABEL = {
  up: 'Vista dall’alto',
  left: 'Vista 3/4 sinistra',
  right: 'Vista 3/4 destra',
  down: 'Vista dal sotto',
}

/**
 * Pulsantiera delle viste: quattro freccette che saltano alle pose richieste
 * dal cliente (VIEW_SHORTCUTS in poseGraph.js — su = top, sinistra/destra =
 * i due 3/4, giù = sottoscocca). Vive nel DOM sopra il canvas, non dentro il
 * Canvas: pilota la posa via l'API imperativa esposta da useComposerControls
 * (`apiRef.current.goTo`), così il salto usa la stessa molla del resto.
 *
 * `type="button"` esplicito e niente focus rubato al canvas: le frecce da
 * tastiera continuano a funzionare sul modello come prima.
 */
export default function ViewPad({ apiRef }) {
  const go = (dir) => () => apiRef.current?.goTo(VIEW_SHORTCUTS[dir])

  return (
    <div className={styles.viewPad} role="group" aria-label="Viste rapide">
      {['up', 'left', 'right', 'down'].map((dir) => (
        <button
          key={dir}
          type="button"
          className={`${styles.viewBtn} ${styles[dir]}`}
          onClick={go(dir)}
          aria-label={LABEL[dir]}
          title={LABEL[dir]}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={GLYPH[dir]} fill="currentColor" />
          </svg>
        </button>
      ))}
    </div>
  )
}
