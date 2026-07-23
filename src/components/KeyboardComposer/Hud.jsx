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
export default function Hud({ poseApi, theme = 'dark', onToggleTheme }) {
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
    <div className={styles.hud} data-theme={theme} aria-hidden="false">
      {/* ── Riga superiore ──────────────────────────────────────────────── */}
      <header className={styles.top}>
        <div className={styles.brand}>
          {/* Il logo è il lockup completo del cliente: "Dither" + barcode +
              "Array Keyboard Series / ® Model L". Niente testo duplicato a
              fianco — basta il solo SVG. */}
          <img
            className={`${styles.logo} ${theme === 'light' ? styles.logoInvert : ''}`}
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

      {/* ── Toggle luce/buio: sibling del pager, non ne altera il centraggio.
          Mostra l'icona della modalità verso cui si passa cliccando. ──── */}
      <button
        type="button"
        className={`${styles.themeToggle} ${theme === 'light' ? styles.themeToggleActive : ''}`}
        aria-pressed={theme === 'light'}
        aria-label={theme === 'light' ? 'Passa a modalità scura' : 'Passa a modalità chiara'}
        onClick={onToggleTheme}
      >
        {theme === 'light' ? (
          <svg viewBox="0 0 20 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M5.49992 27H14.4998M9.99984 1C5.02937 1 1 4.8802 1 9.66667C1 11.4209 1.54126 13.0535 2.47172 14.4179C3.90256 16.516 4.61735 17.5643 4.71021 17.721C5.53634 19.1148 5.38423 18.6232 5.4882 20.2249C5.49989 20.405 5.49992 20.6775 5.49992 21.2222C5.49992 22.02 6.17148 22.6667 6.9999 22.6667L12.9998 22.6667C13.8282 22.6667 14.4998 22.02 14.4998 21.2222C14.4998 20.6775 14.4998 20.405 14.5115 20.2249C14.6154 18.6232 14.4624 19.1148 15.2886 17.721C15.3814 17.5643 16.0974 16.516 17.5283 14.4179C18.4587 13.0535 19 11.4209 19 9.66667C19 4.8802 14.9703 1 9.99984 1Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M14.5 26C15.0522 26.0001 15.5 26.4478 15.5 27C15.5 27.5522 15.0522 27.9999 14.5 28H5.5C4.94772 28 4.5 27.5523 4.5 27C4.5 26.4477 4.94772 26 5.5 26H14.5ZM10 0C15.4868 8.20737e-05 20 4.29303 20 9.66699C19.9999 11.6307 19.3932 13.4583 18.3545 14.9814C17.6388 16.0309 17.1031 16.8165 16.7344 17.3594C16.55 17.6309 16.4083 17.84 16.3076 17.9902C16.2572 18.0655 16.2179 18.1244 16.1895 18.168C16.1616 18.2106 16.1499 18.2281 16.1484 18.2305C16.0421 18.41 15.9519 18.5592 15.876 18.6836C15.7983 18.8109 15.7415 18.9045 15.6943 18.9844C15.5983 19.1468 15.5867 19.1828 15.584 19.1914C15.5814 19.1999 15.5707 19.2361 15.5586 19.4199C15.5526 19.5114 15.5467 19.6191 15.5391 19.7666C15.5316 19.9108 15.5232 20.0836 15.5098 20.29C15.5008 20.4287 15.5 20.6579 15.5 21.2227C15.4998 22.6076 14.3446 23.6669 13 23.667H7C5.65533 23.667 4.50024 22.6077 4.5 21.2227C4.5 20.6581 4.49922 20.4287 4.49023 20.29C4.47683 20.0835 4.46745 19.9108 4.45996 19.7666C4.4523 19.619 4.44744 19.5113 4.44141 19.4199C4.42933 19.237 4.41771 19.201 4.41504 19.1924C4.4123 19.1836 4.40096 19.147 4.30469 18.9844C4.2574 18.9045 4.20075 18.8109 4.12305 18.6836C4.0471 18.5591 3.95601 18.41 3.84961 18.2305C3.84751 18.2271 3.8367 18.2085 3.80957 18.167C3.78114 18.1235 3.74163 18.0653 3.69141 17.9902C3.59094 17.8401 3.44979 17.6307 3.26562 17.3594C2.89726 16.8166 2.36119 16.0309 1.64551 14.9814C0.606766 13.4583 6.71761e-05 11.6307 0 9.66699C0 4.29302 4.51313 0 10 0Z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>

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
