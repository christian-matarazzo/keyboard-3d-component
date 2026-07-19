import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './KeyboardComposer.module.css'

/**
 * Pannello di CATTURA luci per-vista — strumento di autoring per l'art
 * director (Jacopino), visibile SOLO con `?debug`. Vive nel DOM sopra il
 * canvas (come ViewPad): non richiede la console del browser, così funziona
 * anche sul sito in produzione aperto con `?debug`.
 *
 * Flusso: naviga a una vista → regola gli slider "Luci ·" del pannello Leva →
 * "Cattura vista" (o tasto `C`) accumula il set di quella posa → "Esporta"
 * assembla il blocco pronto da incollare in `LIGHTING_PER_POSE` (LightRig.jsx)
 * e lo copia negli appunti. Le catture sopravvivono a un refresh
 * (localStorage), così una sessione di tuning lunga non si perde.
 *
 * Legge la posa corrente da `poseApi.currentPoseKey()` (useComposerControls) e
 * i valori luce live da `lightsApi.readLights()` (LightRig): entrambi vivono
 * dentro il Canvas, il ponte è imperativo via ref come per ViewPad.
 */

// Chiave localStorage: versionata così un cambio di formato non rilegge dati
// vecchi incompatibili.
const LS_KEY = 'kb_lights_capture_v1'

const loadStore = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {}
  } catch {
    return {}
  }
}
const saveStore = (s) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch {
    // storage pieno/negato: la cattura vive comunque in memoria per la sessione
  }
}

// Serializza un set nel formato di LIGHTING_PER_POSE: chiavi senza virgolette,
// una sorgente per riga. `fmt` toglie le virgolette alle chiavi di oggetto ma
// le lascia ai valori stringa (il color hex resta quotato, com'è giusto).
const fmt = (o) => JSON.stringify(o).replace(/"([a-zA-Z]+)":/g, '$1: ')
const formatEntry = (key, set) =>
  `  ${key}: {\n` +
  `    keyMain: ${fmt(set.keyMain)},\n` +
  `    keyFill: ${fmt(set.keyFill)},\n` +
  `    rake: ${fmt(set.rake)},\n` +
  `    rim: ${fmt(set.rim)},\n` +
  `    accent: ${fmt(set.accent)},\n` +
  `    accent2: ${fmt(set.accent2)},\n` +
  `    accent3: ${fmt(set.accent3)},\n` +
  `  },`
const formatBlock = (store) =>
  Object.keys(store)
    .map((k) => formatEntry(k, store[k]))
    .join('\n')

export default function LightCapturePanel({ poseApi, lightsApi, previewRef }) {
  const [store, setStore] = useState(loadStore)
  const [current, setCurrent] = useState(null)
  const [exportText, setExportText] = useState(null)
  const [toast, setToast] = useState('')
  const [preview, setPreview] = useState(false)
  const toastTimer = useRef(null)
  const exportRef = useRef(null)

  // Sincronizza lo stato dell'anteprima verso il LightRig (letto ogni frame):
  // on = riproduci i set catturati con crossfade; off = tuning live. Lo store
  // passa per ref così il crossfade insegue sempre l'ultima cattura.
  useEffect(() => {
    if (previewRef) previewRef.current = { on: preview, store }
    return () => {
      if (previewRef) previewRef.current = null
    }
  }, [preview, store, previewRef])

  const flash = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }, [])

  // Posa corrente in tempo quasi-reale (poll leggero): `currentPoseKey` è una
  // funzione imperativa, non uno stato reattivo. 150ms basta per l'etichetta.
  useEffect(() => {
    const id = setInterval(() => {
      const k = poseApi.current?.currentPoseKey?.() ?? null
      setCurrent((prev) => (prev === k ? prev : k))
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  const capture = useCallback(() => {
    const key = poseApi.current?.currentPoseKey?.()
    const set = lightsApi.current?.readLights?.()
    if (!key || !set) {
      flash('Nessuna vista riconosciuta')
      return
    }
    setStore((prev) => {
      const next = { ...prev, [key]: set }
      saveStore(next)
      return next
    })
    flash(`Vista ${key} salvata ✓`)
  }, [poseApi, lightsApi, flash])

  const remove = useCallback((key) => {
    setStore((prev) => {
      const next = { ...prev }
      delete next[key]
      saveStore(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setStore({})
    saveStore({})
    setExportText(null)
  }, [])

  const doExport = useCallback(() => {
    const block = formatBlock(store)
    if (!block) {
      setExportText('// nessuna vista catturata')
      return
    }
    // Durata di transizione scelta (globale): la si riporta come commento in
    // testa, così Christian sa a quanto impostare LIGHT_FADE / lo slider.
    const d = lightsApi.current?.getTransition?.()
    const head = d != null ? `  // durata transizione A→B: ${d}s\n` : ''
    const text = head + block
    setExportText(text)
    navigator.clipboard?.writeText(text).then(
      () => flash('Copiato negli appunti ✓'),
      () => flash('Copia manuale (Ctrl+C)'),
    )
  }, [store, lightsApi, flash])

  // Scorciatoia `C` = cattura vista corrente. Ignorata mentre si digita in un
  // campo (slider Leva in edit, textarea di export).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'c' && e.key !== 'C') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return
      capture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [capture])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const savedKeys = Object.keys(store)

  return (
    <div className={styles.capturePanel} role="group" aria-label="Cattura luci per-vista">
      <div className={styles.captureHead}>
        <span className={styles.captureTitle}>Cattura luci</span>
        <span className={styles.capturePose}>{current ? current : '— fra due viste —'}</span>
      </div>

      <label className={styles.captureToggle}>
        <input
          type="checkbox"
          checked={preview}
          onChange={(e) => setPreview(e.target.checked)}
        />
        <span>
          Anteprima transizioni
          <small>
            {preview
              ? ' — riproduce i set salvati (regola “durata” in Luci · transizione)'
              : ' — off: gli slider pilotano le luci'}
          </small>
        </span>
      </label>

      <div className={styles.captureRow}>
        <button
          type="button"
          className={styles.captureBtn}
          onClick={capture}
          title="Salva l'illuminazione corrente per questa vista (tasto C)"
        >
          Cattura vista <kbd className={styles.captureKbd}>C</kbd>
        </button>
        <button
          type="button"
          className={styles.captureBtn}
          onClick={doExport}
          disabled={!savedKeys.length}
          title="Assembla il blocco LIGHTING_PER_POSE e copialo"
        >
          Esporta ({savedKeys.length})
        </button>
      </div>

      {savedKeys.length > 0 && (
        <ul className={styles.captureList}>
          {savedKeys.map((k) => (
            <li key={k} className={styles.captureItem}>
              <span>{k}</span>
              <button
                type="button"
                className={styles.captureDel}
                onClick={() => remove(k)}
                aria-label={`Rimuovi ${k}`}
                title={`Rimuovi ${k}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {savedKeys.length > 0 && (
        <button type="button" className={styles.captureClear} onClick={clearAll}>
          Svuota tutto
        </button>
      )}

      {exportText != null && (
        <textarea
          ref={exportRef}
          className={styles.captureExport}
          value={exportText}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.target.select()}
        />
      )}

      {toast && <div className={styles.captureToast}>{toast}</div>}
    </div>
  )
}
