import { useEffect, useState } from 'react'
import styles from './Timeline.module.css'

// DEBUG ricalcolato localmente (non condiviso via prop/contesto), stesso
// pattern di Hud.jsx/KeyboardComposer.jsx/KeyboardModel.jsx/LightRig.jsx.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

/**
 * Prima passata della timeline stile Maya (editMode 'timeline', ?debug):
 * DOM overlay fuori dal Canvas, stesso ponte imperativo a poll di Hud.jsx
 * (150ms). Legge `editMode` dallo stesso `poseApi.current` che Scene.jsx
 * pubblica per Hud.jsx (vedi Scene.jsx §apiRef bridge), e le azioni/campi
 * della timeline vera e propria da `timelineApiRef.current`, popolato da
 * MeshController.jsx (che possiede selezione/pivot/posX..rotZ — un keyframe
 * è solo uno snapshot di quei valori).
 *
 * Solo dati + UI minima per questa prima passata: aggiungi/rimuovi keyframe,
 * scrub con interpolazione lineare fra i due più vicini. Niente Play/Pause
 * automatico, niente salvataggio/caricamento JSON (deferred).
 */
export default function Timeline({ poseApi, timelineApiRef }) {
  const [editMode, setEditMode] = useState(null)
  const [snap, setSnap] = useState({ selectionLabel: null, keyframes: [], playhead: 0, duration: 5 })

  useEffect(() => {
    const id = setInterval(() => {
      const mode = poseApi.current?.editMode ?? null
      setEditMode((prev) => (prev === mode ? prev : mode))

      const api = timelineApiRef.current
      if (!api) return
      setSnap((prev) => {
        const next = {
          selectionLabel: api.selectionLabel ?? null,
          keyframes: api.keyframes ?? [],
          playhead: api.playhead ?? 0,
          duration: api.duration ?? 5,
        }
        const same =
          prev.selectionLabel === next.selectionLabel &&
          prev.playhead === next.playhead &&
          prev.duration === next.duration &&
          prev.keyframes === next.keyframes
        return same ? prev : next
      })
    }, 150)
    return () => clearInterval(id)
  }, [poseApi, timelineApiRef])

  if (!DEBUG || editMode !== 'timeline') return null

  const pct = (t) => `${(t / snap.duration) * 100}%`

  const onTrackPointerDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const scrub = (clientX) => {
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      timelineApiRef.current?.setPlayhead(f * snap.duration)
    }
    scrub(e.clientX)
    const onMove = (ev) => scrub(ev.clientX)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className={styles.timeline}>
      <div className={styles.header}>
        <span className={styles.selection}>{snap.selectionLabel ?? '— nessuna selezione —'}</span>
        <button
          type="button"
          className={styles.addButton}
          disabled={!snap.selectionLabel}
          onClick={() => timelineApiRef.current?.addKeyframe()}
        >
          + Keyframe @ {snap.playhead.toFixed(2)}s
        </button>
      </div>
      <div className={styles.track} onPointerDown={onTrackPointerDown}>
        {snap.keyframes.map((kf) => (
          <div key={kf.id} className={styles.marker} style={{ left: pct(kf.time) }}>
            <button
              type="button"
              className={styles.markerDot}
              aria-label={`Vai al keyframe a ${kf.time.toFixed(2)}s`}
              onClick={(e) => { e.stopPropagation(); timelineApiRef.current?.jumpToKeyframe(kf.id) }}
            />
            <button
              type="button"
              className={styles.markerRemove}
              aria-label="Rimuovi keyframe"
              onClick={(e) => { e.stopPropagation(); timelineApiRef.current?.removeKeyframe(kf.id) }}
            >
              ×
            </button>
          </div>
        ))}
        <div className={styles.playhead} style={{ left: pct(snap.playhead) }} />
      </div>
    </div>
  )
}
