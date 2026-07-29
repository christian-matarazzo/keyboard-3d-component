import { useEffect, useState } from 'react'
import styles from './Hud.module.css'
import { HUD_VIEWS, POSE_HUD_LABEL } from './poseGraph'
import { DEFAULT_MODEL_URL } from './KeyboardModel'
import { DEFAULT_MESH_GROUPS } from './materials/meshGroups'

/**
 * HUD di prodotto — l'overlay grafico consegnato dal cliente (Dither, screen
 * `General Concept.png`). Vive nel DOM sopra il canvas, `pointer-events:none`:
 * solo la paginazione `01–05` riattiva i click. Sempre montato (non gated da
 * `?debug`): è UI di prodotto, non tuning.
 *
 * Ponti imperativi (ref popolati dentro il Canvas, come ViewPad/LightCapture):
 *  - `poseApi` → `goTo(poseKey)` per navigare + `currentPoseKey()` per la vista
 *    attiva (poll leggero, come LightCapturePanel).
 *  - stesso ponte per lo zoom di prodotto: `focusGroup(groupId)` /
 *    `clearFocus()` / `currentFocus()`. È l'UNICO zoom disponibile in
 *    produzione — la rotella è authoring e vive solo in ?debug (vedi
 *    useComposerControls.js).
 *
 * FPS = fps reali del browser, contati direttamente in `requestAnimationFrame`
 * (indipendenti dal render-loop R3F). MB = peso reale del modello caricato
 * (byte del `.glb`, da Performance Resource Timing).
 *
 * Font/colori/spaziatura arrivano dallo style guide: Suisse Int'l Mono,
 * letter-spacing −2%, sempre CAPS-LOCK (text-transform sul contenitore).
 */
export default function Hud({ poseApi, meshGroups = DEFAULT_MESH_GROUPS, animations }) {
  const [poseKey, setPoseKey] = useState(null)
  const [lockState, setLockState] = useState({ locked: false, lockedPoseKey: null })
  const [focusGroupId, setFocusGroupId] = useState(null)
  const [animState, setAnimState] = useState({ id: null, waitingTrigger: null })
  const [fps, setFps] = useState(0)
  const [modelMB, setModelMB] = useState(null)
  const [ramMB, setRamMB] = useState(null)

  // Posa attiva + stato di blocco (Mesh): poll leggero (imperativo,
  // non reattivo — stesso bridge di poseApi, popolato anche da Scene.jsx con
  // editMode/lockedPoseKey, vedi KeyboardModel.jsx/Scene.jsx).
  useEffect(() => {
    const id = setInterval(() => {
      const api = poseApi.current
      const k = api?.currentPoseKey?.() ?? null
      setPoseKey((prev) => (prev === k ? prev : k))

      const mode = api?.editMode ?? 'none'
      const lockedPoseKey = api?.lockedPoseKey ?? null
      const locked = mode === 'meshes'
      setLockState((prev) =>
        prev.locked === locked && prev.lockedPoseKey === lockedPoseKey
          ? prev
          : { locked, lockedPoseKey }
      )

      // Gruppo inquadrato: letto dallo stesso poll (la camera vive in ref
      // imperativi dentro il Canvas, non in stato React) — così l'HUD resta
      // allineato anche quando il focus viene cambiato da fuori (console di
      // debug `__focusGroup`, o l'uscita automatica entrando in modalità Mesh).
      const focus = api?.currentFocus?.() ?? null
      setFocusGroupId((prev) => (prev === focus ? prev : focus))

      // Animazione in corso + eventuale evento atteso: stessa regola dei chip
      // di focus — si deriva dalla sorgente imperativa, non da stato locale,
      // così resta onesto anche quando l'animazione viene fermata da fuori
      // (console di debug, o la guardia all'ingresso in modalità Mesh).
      const anim = api?.animationState?.() ?? null
      const nextAnim = {
        id: anim && anim.state !== 'idle' ? anim.id : null,
        waitingTrigger: anim?.waitingTrigger ?? null,
      }
      setAnimState((prev) =>
        prev.id === nextAnim.id &&
        prev.waitingTrigger?.name === nextAnim.waitingTrigger?.name
          ? prev
          : nextAnim,
      )
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  // Uscita rapida, dal più specifico al più generico: se c'è un'animazione in
  // corso la si ferma (il suo teardown ripristina anche il focus), altrimenti
  // si esce dallo zoom. Su `window` e non sul canvas: il focus si attiva
  // cliccando un chip dell'HUD, che porta via il fuoco dal canvas — un
  // listener sul canvas non riceverebbe mai il tasto subito dopo il click.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      const api = poseApi.current
      if (api?.currentAnimation?.()) api.stopAnimation?.()
      else api?.clearFocus?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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

  const animItems = (animations?.items ?? []).filter((a) => a.hidden !== true)

  // Un'animazione muove posa, focus e geometria: lasciarla correre mentre
  // l'utente cambia vista o inquadratura significherebbe due scrittori sugli
  // stessi target. Chi tocca il pager o i chip di focus la ferma prima.
  const stopIfAnimating = () => {
    const api = poseApi.current
    if (api?.currentAnimation?.()) api.stopAnimation?.()
  }

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
          // In Mesh la posa è bloccata (vedi Scene.jsx): ogni
          // pulsante diverso dalla posa bloccata è inerte — goTo() la
          // rifiuterebbe comunque (guard in useComposerControls.js), ma
          // disabilitarlo qui rende visibile perché non succede nulla.
          const disabled = lockState.locked && view !== lockState.lockedPoseKey
          return (
            <button
              key={view}
              type="button"
              className={`${styles.page} ${active ? styles.pageActive : ''} ${disabled ? styles.pageDisabled : ''}`}
              aria-current={active ? 'true' : undefined}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              aria-label={`Vista ${n} — ${POSE_HUD_LABEL[view] ?? view}`}
              onClick={() => {
                if (disabled) return
                stopIfAnimating()
                poseApi.current?.goTo(view)
              }}
            >
              {n}
            </button>
          )
        })}
      </nav>

      {/* ── Zoom sui gruppi (unico zoom di prodotto) ───────────────────────
          Un chip per gruppo logico di mesh: click = inquadra il gruppo, click
          sul gruppo già attivo = torna all'insieme (come Escape). In
          Mesh la posa è bloccata e la geometria può essere spostata
          dall'editor: focusGroup() rifiuterebbe comunque (guard in
          useComposerControls.js), i chip si disabilitano per renderlo
          visibile — stesso trattamento della pulsantiera delle viste. */}
      <nav className={styles.focusBar} aria-label="Zoom sui gruppi">
        {meshGroups.map((group) => {
          const active = group.id === focusGroupId
          const disabled = lockState.locked
          return (
            <button
              key={group.id}
              type="button"
              className={`${styles.focusChip} ${active ? styles.focusChipActive : ''} ${disabled ? styles.focusChipDisabled : ''}`}
              aria-pressed={active}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                stopIfAnimating()
                const api = poseApi.current
                if (active) api?.clearFocus?.()
                else api?.focusGroup?.(group.id)
              }}
            >
              {group.label}
            </button>
          )
        })}
      </nav>

      {/* ── Animazioni autorate ────────────────────────────────────────────
          Riga di chip ACCANTO (non al posto) di quelli di focus: un chip per
          animazione visibile, click sull'attiva = stop. Quando uno step
          `waitTrigger` blocca la sequenza compare un chip in più, che è la
          superficie di prodotto degli eventi opzionali (es. "avvia i rotori").
          Le animazioni sono autorate in ?debug e arrivano dal JSON globale. */}
      {(animItems.length > 0 || animState.waitingTrigger) && (
        <nav className={styles.animBar} aria-label="Animazioni">
          {animItems.map((anim) => {
            const active = anim.id === animState.id
            const disabled = lockState.locked
            return (
              <button
                key={anim.id}
                type="button"
                className={`${styles.animChip} ${active ? styles.animChipActive : ''} ${disabled ? styles.animChipDisabled : ''}`}
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  const api = poseApi.current
                  if (active) api?.stopAnimation?.()
                  else api?.playAnimation?.(anim.id)
                }}
              >
                {anim.label}
              </button>
            )
          })}
          {animState.waitingTrigger && (
            <button
              type="button"
              className={`${styles.animChip} ${styles.animChipTrigger}`}
              onClick={() => poseApi.current?.triggerAnimation?.(animState.waitingTrigger.name)}
            >
              {animState.waitingTrigger.label}
            </button>
          )}
        </nav>
      )}

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
