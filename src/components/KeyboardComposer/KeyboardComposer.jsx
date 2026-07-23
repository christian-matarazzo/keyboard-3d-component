import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { Leva } from 'leva'
import styles from './KeyboardComposer.module.css'
import Scene from './Scene'
import Hud from './Hud'
import { DEFAULT_MODEL_URL } from './KeyboardModel'
import { finishes as defaultFinishes, getFinish } from './materials/registry'

// Pannello di tuning (luci, materiali, resa) visibile solo con `?debug`
// nell'URL: in produzione il canvas resta pulito, a tutto schermo.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Larghezza del pannello Leva: default della libreria e limiti del resize a
// trascinamento (vedi DebugPanel). Il tool di debug ha pose con label lunghe,
// allargarlo aiuta a leggerle senza troncamenti.
const PANEL_WIDTH_DEFAULT = 280
const PANEL_WIDTH_MIN = 240
const PANEL_WIDTH_MAX = 640

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

/**
 * Pannello Leva con bordo sinistro trascinabile per allargarlo/stringerlo.
 * Il pannello è ancorato in alto a destra: trascinando l'handle verso sinistra
 * cresce. La larghezza è controllata via `theme.sizes.rootWidth` (Leva 0.10),
 * l'handle è un grip fisso allineato al bordo sinistro (offset = width + 10px
 * di margine del pannello).
 *
 * `<Leva>` va SEMPRE montato (anche fuori da `?debug`): Leva crea comunque un
 * pannello di default appena una `useControls` è in uso (LightRig, i controlli,
 * ecc.), e `hidden={!DEBUG}` è l'unico modo per nasconderlo in produzione. Solo
 * l'handle di resize è condizionato a DEBUG.
 */
function DebugPanel() {
  const [width, setWidth] = useState(PANEL_WIDTH_DEFAULT)
  const dragRef = useRef({ pointerId: null, startX: 0, startW: 0 })

  const onPointerDown = (e) => {
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: width }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (d.pointerId !== e.pointerId) return
    // Trascinare a sinistra (clientX cala) allarga: startX - clientX > 0.
    setWidth(clamp(d.startW + (d.startX - e.clientX), PANEL_WIDTH_MIN, PANEL_WIDTH_MAX))
  }
  const onPointerUp = (e) => {
    const d = dragRef.current
    if (d.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = { pointerId: null, startX: 0, startW: 0 }
  }

  return (
    <>
      <Leva hidden={!DEBUG} collapsed theme={{ sizes: { rootWidth: `${width}px` } }} />
      {DEBUG && (
        <div
          className={styles.debugResize}
          style={{ right: `${width + 10}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona pannello debug"
        />
      )}
    </>
  )
}

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
  // viene popolato da useComposerControls con `{ goTo(poseKey), currentPoseKey() }`.
  const poseApi = useRef(null)

  // Tema HUD/sfondo: 'dark' (default, attuale look nero) o 'light' (sfondo
  // bianco, HUD invertito). Guida anche quale JSON di luci carica il LightRig.
  const [theme, setTheme] = useState('dark')

  return (
    <section className={styles.section} data-theme={theme}>
      <DebugPanel />
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene modelUrl={modelUrl} finish={finish} apiRef={poseApi} theme={theme} />
        <Hud
          poseApi={poseApi}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />
      </div>
    </section>
  )
}
