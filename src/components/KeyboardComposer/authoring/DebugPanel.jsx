import { useEffect, useRef, useState } from 'react'
import { Leva } from 'leva'
import styles from '../KeyboardComposer.module.css'

/*
 * Il pannello di authoring: la finestra Leva ridimensionabile e la pulsantiera
 * salva/carica agganciata sotto.
 *
 * Stava dentro KeyboardComposer.jsx, ed era l'ultimo motivo per cui la shell di
 * PRODUZIONE importava `leva`. Da qui in poi vive dietro il confine lazy: chi
 * non apre l'editor non scarica né questo file né la libreria.
 *
 * ⚠️ Cade anche la vecchia regola "<Leva> va SEMPRE montato". Valeva finché
 * delle `useControls` giravano in produzione (Leva creava comunque un pannello
 * di default, e `hidden` era l'unico modo di nasconderlo). Ora nessuna
 * `useControls` vive fuori da authoring/, quindi non montare nulla è
 * sufficiente — ed è meglio, perché non montato significa non scaricato.
 */

// Larghezza del pannello Leva: default della libreria e limiti del resize a
// trascinamento (vedi DebugPanel). Il tool di debug ha pose con label lunghe,
// allargarlo aiuta a leggerle senza troncamenti.
const PANEL_WIDTH_DEFAULT = 280
const PANEL_WIDTH_MIN = 240
const PANEL_WIDTH_MAX = 640

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

// Altezza della pulsantiera JSON agganciata sotto Leva (padding + titolo +
// una riga di pulsanti, vedi `.jsonDock` nel CSS module). Costante e non
// misurata: il riquadro ha contenuto fisso, e serve solo a tenerlo dentro il
// viewport quando il pannello Leva è più alto della finestra.
const JSON_DOCK_H = 60

// Classi dell'esito del salvataggio. Mappa esplicita e non
// `styles['jsonStatus_' + tone]`: le chiavi di un CSS module dipendono da
// `css.modules.localsConvention`, e comporle a stringa significa che cambiando
// quell'impostazione la riga resta senza colore in silenzio.
const STATUS_CLASS = {
  ok: styles.jsonStatusOk,
  err: styles.jsonStatusErr,
  wait: styles.jsonStatusWait,
}

/**
 * Pannello Leva con bordo sinistro trascinabile per allargarlo/stringerlo, più
 * la pulsantiera "salva/carica configurazione" agganciata sotto di esso.
 * Il pannello è ancorato in alto a destra: trascinando l'handle verso sinistra
 * cresce. La larghezza è controllata via `theme.sizes.rootWidth` (Leva 0.10),
 * l'handle è un grip fisso allineato al bordo sinistro (offset = width + 10px
 * di margine del pannello).
 *
 * ⚠️ Il `<div style={{display:'contents'}}>` attorno a `<Leva>` NON è
 * decorativo: serve a poter misurare il pannello (`firstElementChild` è il suo
 * root, reso in loco — Leva 0.10 non usa portali quando `<Leva>` è montato
 * esplicitamente) per agganciarci sotto la pulsantiera. `display: contents`
 * toglie del tutto la scatola del wrapper, quindi non diventa un item della
 * flexbox di `.section` e non altera nulla del layout.
 */
export default function DebugPanel({ poseApi }) {
  const [width, setWidth] = useState(PANEL_WIDTH_DEFAULT)
  const dragRef = useRef({ pointerId: null, startX: 0, startW: 0 })
  const levaHostRef = useRef(null)
  // Esito dell'ultimo salvataggio, `{ text, tone }`. Da quando "Salva"
  // sovrascrive il file servito invece di scaricarlo, l'azione non ha più un
  // segnale suo: nessuna barra dei download che lampeggia, nessuna finestra di
  // sistema. Un `alert` per conferma sarebbe insopportabile in un flusso dove
  // si salva decine di volte per sessione, quindi il riscontro va qui — e
  // prende il POSTO del titolo invece di aggiungersi ad esso, così l'altezza
  // del riquadro resta quella di JSON_DOCK_H.
  const [saveStatus, setSaveStatus] = useState(null)
  const statusTimer = useRef(null)
  // Quota a cui agganciare la pulsantiera: bordo inferiore + bordi laterali
  // del pannello Leva, in coordinate di viewport (il pannello è `fixed`).
  const [dock, setDock] = useState(null)

  // Il pannello Leva si collassa, si espande folder per folder, si trascina e
  // lo si ridimensiona: invece di indovinarne l'ingombro lo si MISURA. Poll
  // leggero (200ms, stesso idioma dell'HUD e dell'editor animazioni) e non un
  // ResizeObserver, perché deve reagire anche allo SPOSTAMENTO del pannello —
  // un drag per la barra del titolo non cambia le dimensioni e un
  // ResizeObserver non lo vedrebbe.
  useEffect(() => {
    const read = () => {
      const el = levaHostRef.current?.firstElementChild
      const r = el?.getBoundingClientRect()
      // width 0 = pannello nascosto (Leva mette display:none quando non ci
      // sono controlli visibili): niente da agganciare.
      if (!r || !r.width) return setDock((prev) => (prev === null ? prev : null))
      // Con abbastanza folder aperte il pannello Leva supera l'altezza della
      // finestra: agganciata rigidamente sotto, la pulsantiera finirebbe fuori
      // schermo e irraggiungibile. Si tiene dentro il viewport — nel caso
      // limite copre l'ultima riga del pannello (stesso z-index, vince l'ordine
      // nel DOM), che è il male minore.
      const top = Math.min(r.bottom + 8, window.innerHeight - JSON_DOCK_H - 10)
      const next = {
        top: Math.round(Math.max(10, top)),
        right: Math.round(window.innerWidth - r.right),
        width: Math.round(r.width),
      }
      setDock((prev) =>
        prev && prev.top === next.top && prev.right === next.right && prev.width === next.width
          ? prev
          : next,
      )
    }
    read()
    const id = setInterval(read, 200)
    return () => clearInterval(id)
  }, [])

  // Il timer va spento allo smontaggio: `editMode` può cambiare mentre un esito
  // è ancora a schermo.
  useEffect(() => () => clearTimeout(statusTimer.current), [])

  const flashStatus = (text, tone) => {
    clearTimeout(statusTimer.current)
    setSaveStatus({ text, tone })
    // L'errore resta più a lungo: è l'unico posto in cui viene detto (il
    // dettaglio completo va in console).
    statusTimer.current = setTimeout(() => setSaveStatus(null), tone === 'err' ? 6000 : 2500)
  }

  const onSave = async () => {
    const save = poseApi?.current?.saveConfigJSON
    if (!save) return flashStatus('editor non pronto', 'err')
    flashStatus('salvataggio…', 'wait')
    const res = await save()
    if (res?.ok) return flashStatus(`salvato · ${res.path.split('/').pop()}`, 'ok')
    // Ripiego riuscito: il file è stato scaricato, non sovrascritto. Va detto,
    // o si crede di aver aggiornato `public/` e non è vero — che è esattamente
    // il difetto che questo cambiamento è venuto a togliere.
    flashStatus('scaricato (dev server assente)', 'err')
  }

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
      <div ref={levaHostRef} style={{ display: 'contents' }}>
        <Leva hidden={false} collapsed theme={{ sizes: { rootWidth: `${width}px` } }} />
      </div>
      {(
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

      {/* ── Stato tunabile: salva / carica ────────────────────────────────
          Vive qui e non più come overlay `<Html>` sul canvas (dov'era, in alto
          a sinistra, sopra il lockup del cliente): i due pulsanti sono la
          scrittura e la lettura di TUTTO ciò che si autora dai pannelli Leva,
          quindi stanno attaccati a quelli — stessa larghezza, stesso margine
          destro, stessa palette. Gli handler vivono in authoring/LightEditor.jsx
          (è il solo a vedere `configsRef`) e arrivano qui dal ponte imperativo.
          ⚠️ "Salva" SOVRASCRIVE il file servito, non lo scarica: la riga del
          titolo qui sotto è l'unico riscontro che l'operazione dà. */}
      {dock && (
        <div
          className={styles.jsonDock}
          style={{ top: `${dock.top}px`, right: `${dock.right}px`, width: `${dock.width}px` }}
        >
          <div
            className={`${styles.jsonTitle} ${(saveStatus && STATUS_CLASS[saveStatus.tone]) || ''}`}
            title={saveStatus?.text}
          >
            {saveStatus ? saveStatus.text : 'Stato · configurazione'}
          </div>
          <div className={styles.jsonRow}>
            <button
              type="button"
              className={`${styles.jsonBtn} ${styles.jsonBtnPrimary}`}
              onClick={onSave}
              title="Sovrascrive il file servito (public/…/app-state-config.json) con tutto lo stato autorato"
            >
              Salva
            </button>
            <button
              type="button"
              className={styles.jsonBtn}
              onClick={() => poseApi?.current?.loadConfigJSON?.()}
              title="Carica un app-state-config.json e applicalo alla scena"
            >
              Carica
            </button>
          </div>
        </div>
      )}
    </>
  )
}

