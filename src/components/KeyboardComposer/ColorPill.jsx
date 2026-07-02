import styles from './KeyboardComposer.module.css'

export default function ColorPill({ finishes, selectedId, onSelect }) {
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = finishes.findIndex((f) => f.id === selectedId)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = finishes[(index + step + finishes.length) % finishes.length]
    onSelect(next.id)
  }

  return (
    <div className={styles.colorPill}>
      Colori
      <span
        className={styles.swatches}
        role="radiogroup"
        aria-label="Colori disponibili"
        onKeyDown={onKeyDown}
      >
        {finishes.map((finish) => {
          const selected = finish.id === selectedId
          return (
            <button
              key={finish.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={finish.label}
              title={finish.label}
              tabIndex={selected ? 0 : -1}
              className={`${styles.swatch} ${selected ? styles.swatchSelected : ''}`}
              style={{ background: finish.swatch }}
              onClick={() => onSelect(finish.id)}
            />
          )
        })}
      </span>
    </div>
  )
}
