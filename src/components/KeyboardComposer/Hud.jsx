import { useEffect, useState } from 'react'
import styles from './Hud.module.css'
import { HUD_VIEWS, POSE_HUD_LABEL } from './poseGraph'
import { DEFAULT_MODEL_URL } from './KeyboardModel'

/**
 * HUD di prodotto — l'overlay grafico consegnato dal cliente (Dither, screen
 * `General Concept.png`). Vive nel DOM sopra il canvas, `pointer-events:none`:
 * solo la paginazione `01–05` riattiva i click. Sempre montato (non gated da
 * `?debug`): è UI di prodotto, non tuning.
 *
 * Ponti imperativi (ref popolati dentro il Canvas, come ViewPad/LightCapture):
 *  - `poseApi` → `goTo(poseKey)` per navigare + `currentPoseKey()` per la vista
 *    attiva (poll leggero, come LightCapturePanel).
 *
 * FPS = fps reali del browser, contati direttamente in `requestAnimationFrame`
 * (indipendenti dal render-loop R3F). MB = peso reale del modello caricato
 * (byte del `.glb`, da Performance Resource Timing).
 *
 * Font/colori/spaziatura arrivano dallo style guide: Suisse Int'l Mono,
 * letter-spacing −2%, sempre CAPS-LOCK (text-transform sul contenitore).
 */
export default function Hud({ poseApi }) {
  const [poseKey, setPoseKey] = useState(null)
  const [fps, setFps] = useState(0)
  const [modelMB, setModelMB] = useState(null)
  const [ramMB, setRamMB] = useState(null)

  // Posa attiva: poll leggero (currentPoseKey è imperativo, non reattivo).
  useEffect(() => {
    const id = setInterval(() => {
      const k = poseApi.current?.currentPoseKey?.() ?? null
      setPoseKey((prev) => (prev === k ? prev : k))
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  // FPS reali del browser: conto i frame di rAF e ricalcolo ogni ~500ms.
  // Questo è il refresh effettivo del browser (60, 120, 144, 240…), non un
  // valore derivato dal render-loop R3F.
  useEffect(() => {
    let raf
    let frames = 0
    let last = performance.now()
    const tick = () => {
      frames++
      const now = performance.now()
      const dt = now - last
      if (dt >= 500) {
        const f = Math.round((frames * 1000) / dt)
        setFps((prev) => (prev === f ? prev : f))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Peso reale del modello: byte scaricati del `.glb` dal Performance Resource
  // Timing. Il fetch (drei useGLTF) può non essere ancora finito al mount →
  // ripeto finché la voce risorsa compare, poi mi fermo.
  useEffect(() => {
    let id
    const read = () => {
      const entry = performance
        .getEntriesByType('resource')
        .find((e) => e.name.includes(DEFAULT_MODEL_URL))
      // encodedBodySize = byte del corpo (il file glb); transferSize può
      // essere 0 se servito da cache → fallback su encoded/decoded.
      const bytes =
        entry?.encodedBodySize || entry?.transferSize || entry?.decodedBodySize
      if (bytes) {
        setModelMB(bytes / (1024 * 1024))
        clearInterval(id)
      }
    }
    read()
    id = setInterval(read, 300)
    return () => clearInterval(id)
  }, [])

  // RAM usata dalla tab per far girare il modello: `performance.memory`
  // (heap JS, non VRAM) esiste solo su Chrome/Edge — su Firefox/Safari resta
  // `null` e il contatore mostra "—".
  useEffect(() => {
    if (!performance.memory) return
    const read = () => setRamMB(performance.memory.usedJSHeapSize / (1024 * 1024))
    read()
    const id = setInterval(read, 500)
    return () => clearInterval(id)
  }, [])

  const viewLabel = POSE_HUD_LABEL[poseKey] ?? '—'
  const memLabel = modelMB != null ? `${modelMB.toFixed(2)} MB` : '— MB'
  const fpsLabel = fps.toFixed(2)
  const ramLabel = ramMB != null ? `RAM ${Math.round(ramMB)} MB` : 'RAM —'

  return (
    <div className={styles.hud} aria-hidden="false">
      {/* ── Riga superiore ──────────────────────────────────────────────── */}
      <header className={styles.top}>
        <div className={styles.brand}>
          {/* Il logo è il lockup completo del cliente: "Dither" + barcode +
              "Array Keyboard Series / ® Model L". Niente testo duplicato a
              fianco — basta il solo SVG. */}
          <img
            className={styles.logo}
            src="/brand/Logo_System.svg"
            alt="Dither — Array Keyboard Series, Model L"
            draggable="false"
          />
        </div>

        <div className={styles.telemetry}>
          <span>FPS {fpsLabel}</span>
          <i className={styles.sep} />
          <span>{viewLabel}</span>
          <i className={styles.sep} />
          <span>{memLabel}</span>
          <i className={styles.sep} />
          <span>{ramLabel}</span>
        </div>

        <div className={styles.version}>V 0.2 Configurator Playground</div>
      </header>

      {/* ── Paginazione / selettore vista (sostituisce le frecce ViewPad) ── */}
      <nav className={styles.pager} aria-label="Viste">
        {HUD_VIEWS.map((view, i) => {
          const n = String(i + 1).padStart(2, '0')
          const active = view === poseKey
          return (
            <button
              key={view}
              type="button"
              className={`${styles.page} ${active ? styles.pageActive : ''}`}
              aria-current={active ? 'true' : undefined}
              aria-label={`Vista ${n} — ${POSE_HUD_LABEL[view] ?? view}`}
              onClick={() => poseApi.current?.goTo(view)}
            >
              {n}
            </button>
          )
        })}
      </nav>

      {/* ── Riga inferiore ──────────────────────────────────────────────── */}
      <footer className={styles.bottom}>
        <span>
          IT - EU <span className={styles.copyright}>©</span>
        </span>
        <span>For internal use only, do not share</span>
        <span>
          Instruments of Becoming 2026<span className={styles.copyright}>©</span>
        </span>
      </footer>
    </div>
  )
}
