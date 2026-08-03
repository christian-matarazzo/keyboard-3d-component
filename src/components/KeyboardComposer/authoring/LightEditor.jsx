import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { generateDefaultConfig, readViewSettings, VIEW_SETTING_KEYS } from '../lightConfig'
import { applyConfig } from '../runtime/productConfig'
import { DEFAULT_VIEW_SETTINGS } from '../state/defaults'
import { useComposerSection } from '../state/useComposerSection'

/**
 * L'EDITOR DELLE LUCI — il pannello `<Html>`, la cronologia di undo e il
 * salva/carica della configurazione, cioè tutto ciò che in LightRig.jsx non
 * serviva a renderizzare una luce.
 *
 * Stava dentro il rig, che è codice di PRODUZIONE montato incondizionatamente da
 * Scene.jsx: circa 350 righe — un pannello DOM con gli stili inline, uno stack
 * di undo da 50 passi e la serializzazione dell'intero store — viaggiavano nel
 * chunk che scarica chiunque installi il pacchetto, per un'interfaccia
 * raggiungibile solo con `?debug`. Misurato prima dello spostamento: le stringhe
 * «Seleziona Luce GLOBALE», «Luci ATTIVE» e «Decadimento» erano nel chunk di
 * produzione.
 *
 * Il precedente esatto è ShadowLights.jsx (produzione, rende la luce) /
 * LightGizmos.jsx (authoring, la muove senza possederla): **la produzione rende,
 * l'authoring manipola**. Qui vale lo stesso, con due canali:
 *
 * 1. `rigRef` — riempito da LightRig, creato da Scene (l'antenato comune),
 *    stessa forma di `keyLightRef`/`spotLightRef`. Porta le cose che il rig
 *    POSSIEDE e che l'editor deve poter mutare: `configsRef` (il dizionario per
 *    posa, mutato in loco e letto ogni frame) e la posa attiva.
 *    ⚠️ Non è una prop perché non è un valore: è proprietà mutabile condivisa.
 *    Passarla come stato React significherebbe un re-render per slider mosso, e
 *    il dizionario è letto dentro useFrame.
 *
 * 2. `store.ui.selectedLight` — la SELEZIONE, che i due lati si scambiano.
 *    Sta nello store e non in un ref perché la leggono entrambi in due regimi
 *    diversi: l'editor reattivamente (deve ridisegnare il pannello), il rig
 *    dentro useFrame in modo NON reattivo (`store.get`), per evidenziare
 *    l'helper giusto. È lo stesso schema già usato da `editMode` (scritto da
 *    ModeTuner, letto dalla produzione) e per la stessa ragione: `ui` non viene
 *    mai serializzata, quindi non sporca il JSON di prodotto.
 *
 * ⚠️ La selezione è una STRINGA `${layer}_${index}`, non `{layer, index}`.
 * È già il formato del `value` dei due <select>, ed è anche il prefisso letterale
 * delle chiavi di configurazione (`top_3` → `top_3_intensity`), quindi non va
 * mai né composta né riparsata. La ragione vera però è un'altra: `store.set`
 * confronta le sezioni con `shallowEqual`, cioè `Object.is` sui valori — un
 * oggetto nuovo a ogni click sarebbe SEMPRE diverso da sé stesso e produrrebbe
 * uno snapshot nuovo (e un re-render) anche riselezionando la stessa luce.
 */

// --- Stili degli overlay di debug ----------------------------------------
// Erano oggetti inline ripetuti quasi identici (i due <select>): qui una sola
// volta, con le sole differenze come override sul posto. Sono overlay
// dell'editor `?debug`, non UI di prodotto — per quella valgono i CSS module.
const SELECT_STYLE = {
  background: 'rgba(20, 20, 20, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: '12px',
  fontFamily: 'sans-serif',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  outline: 'none',
  appearance: 'auto',
}

const PANEL_STYLE = {
  position: 'absolute',
  right: '30px',
  top: '50%',
  transform: 'translateY(-50%)',
  width: '260px',
  background: 'rgba(20, 20, 20, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '16px',
  padding: '20px',
  color: '#fff',
  fontFamily: 'sans-serif',
  pointerEvents: 'auto',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
}

const FIELD_STYLE = { display: 'flex', flexDirection: 'column', gap: '5px' }
const LABEL_STYLE = { fontSize: '12px', fontWeight: '600' }

/**
 * Endpoint del dev server che sovrascrive il file dentro `public/`.
 *
 * ⚠️ La stringa è DUPLICATA da `scripts/vite-plugin-author-save.mjs`, che ne è
 * l'altra metà, e la duplicazione è voluta: quel modulo importa `node:fs`, e
 * importarlo da qui — anche solo per una costante — lo trascinerebbe nel grafo
 * del componente, cioè in un pacchetto che deve poter essere importato dentro
 * un browser e su Node in SSR. Se cambia qui va cambiata anche là.
 */
const SAVE_ENDPOINT = '/__author/save-config'

/**
 * Ripiego storico: il file finisce in Download e va ricopiato a mano in
 * `public/` al percorso di `configUrl`. È ciò che succede quando l'endpoint non
 * c'è — cioè fuori dal dev server di questo repo, dove il componente è una
 * dipendenza installata e nessuno gli ha messo accanto un plugin che scriva su
 * disco. Non è un errore, è l'unico salvataggio possibile lì.
 */
const downloadJSON = (json, filename) => {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function LightEditor({ store, apiRef, product, rigRef, editMode = 'none' }) {
  const { configUrl } = product
  const controls = useComposerSection(store, 'view')
  const setControls = useCallback((patch) => store.set('view', patch), [store])
  // `selectedLight` e `activePose` viaggiano entrambe da `ui`: la prima la
  // scrive questo componente e la legge il useFrame del rig, la seconda il
  // contrario. Vedi il blocco in testa al file.
  const { selectedLight, activePose } = useComposerSection(store, 'ui')
  const setSelected = useCallback((key) => store.set('ui', { selectedLight: key ?? null }), [store])

  // Valori DRAFT degli slider. Stato puramente dell'editor: la verità resta
  // dentro `configsRef` del rig, qui c'è solo ciò che l'input mostra.
  const [draft, setDraft] = useState({ intensity: 0, color: '#ffffff', decay: 2 })

  const rig = () => rigRef?.current ?? null
  const configs = () => rig()?.getConfigs?.() ?? {}
  const pose = () => rig()?.getActivePose?.() ?? null

  const isSurfSelected = !!selectedLight && selectedLight.startsWith('surf_')

  // --- UNDO ---------------------------------------------------------------
  // Copia profonda (via JSON) dell'INTERO dizionario per posa prima di ogni
  // modifica: le luci si autorano trascinando, e uno snapshot per valore
  // intermedio riempirebbe la cronologia in un gesto solo — da qui il
  // `onPointerDown` sugli input invece di un `onChange`.
  const historyRef = useRef([])

  const saveToHistory = useCallback(() => {
    const snapshot = JSON.stringify(configs())
    const last = historyRef.current[historyRef.current.length - 1]
    if (last !== snapshot) {
      historyRef.current.push(snapshot)
      // Cronologia limitata a 50 passi: ogni voce è l'intera configurazione di
      // TUTTE le pose, non un delta.
      if (historyRef.current.length > 50) historyRef.current.shift()
    }
  }, [rigRef])

  useEffect(() => {
    const handleUndo = (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) return
      e.preventDefault()
      if (!historyRef.current.length) return

      const restored = JSON.parse(historyRef.current.pop())
      rig()?.setConfigs?.(restored)

      const p = pose()
      const conf = p ? restored[p] : null
      if (!conf) return

      setControls({
        margin: conf.margin,
        showHelpers: conf.showHelpers,
        showSurfaces: conf.showSurfaces !== undefined ? conf.showSurfaces : conf.showHelpers,
      })
      // Se una luce è in ispezione, i suoi slider tornano indietro con lei.
      if (selectedLight) {
        setDraft({
          intensity: conf[`${selectedLight}_intensity`] || 0,
          color: conf[`${selectedLight}_color`] || '#ffffff',
          decay: conf[`${selectedLight}_decay`] || 2,
        })
      }
    }

    window.addEventListener('keydown', handleUndo)
    return () => window.removeEventListener('keydown', handleUndo)
  }, [selectedLight, setControls, rigRef])

  // Selezione (o cambio posa) → valori degli slider.
  useEffect(() => {
    if (!selectedLight) return
    const conf = configs()[pose()]
    if (!conf) return
    setDraft({
      intensity: conf[`${selectedLight}_intensity`] || 0,
      color: conf[`${selectedLight}_color`] || '#ffffff',
      decay: conf[`${selectedLight}_decay`] || 2,
    })
  }, [selectedLight, activePose, rigRef])

  // Slider → configurazione della posa attiva, mutata IN LOCO: è la stessa
  // struttura che il useFrame del rig legge ogni frame, quindi la luce si
  // muove mentre si trascina senza passare da un re-render.
  const updateLightValue = (key, val) => {
    setDraft((prev) => ({ ...prev, [key]: val }))
    const p = pose()
    const conf = p ? configs()[p] : null
    if (conf && selectedLight) conf[`${selectedLight}_${key}`] = val
  }

  const onSelectLight = (e) => setSelected(e.target.value || null)

  // Elenco delle sole luci ACCESE nella vista corrente: con 32 sorgenti il
  // selettore globale è ingestibile, e quasi sempre si vuole ritoccare una di
  // quelle che si stanno già vedendo.
  const activeLightsList = useMemo(() => {
    const conf = configs()[activePose]
    if (!conf) return []
    const active = []
    const checkLight = (layer, idx, name) => {
      const intensity = conf[`${layer}_${idx}_intensity`] || 0
      if (intensity > 0) active.push({ value: `${layer}_${idx}`, label: `${name} (Int: ${intensity.toFixed(1)})` })
    }
    const { faces = [], layers = {}, gridLayers = [] } = rig() ?? {}
    faces.forEach((f) => checkLight('surf', f.index, `Superficie ${f.index.toUpperCase()}`))
    gridLayers.forEach((L) => (layers[L.prefix] ?? []).forEach((_, i) => checkLight(L.prefix, i, `${L.label} ${i}`)))
    return active
  }, [activePose, draft.intensity, rigRef])

  // --- Salva / carica / resetta -------------------------------------------
  /**
   * Serializza tutto lo stato autorato e SOVRASCRIVE il file servito
   * (`product.configUrl` dentro `public/`) passando dall'endpoint del dev
   * server. Restituisce un esito — `{ ok, path }` oppure
   * `{ ok: false, fallback: 'download', error }` — perché il pulsante che lo
   * invoca sta in un altro componente (DebugPanel) e deve poter dire cosa è
   * successo senza un `alert` a ogni salvataggio, in un flusso dove si salva
   * decine di volte per sessione.
   */
  const handleSaveJSON = async () => {
    const p = pose()
    const view = rig()?.getViewControls?.()
    // La posa attiva potrebbe avere modifiche non ancora rientrate nella
    // config (l'effetto di mirroring gira dopo il commit React): si allinea
    // qui, subito prima di serializzare.
    if (p && view && configs()[p]) {
      const conf = configs()[p]
      for (const k of VIEW_SETTING_KEYS) conf[k] = view[k]
      conf.showHelpers = view.showHelpers
      conf.showSurfaces = view.showSurfaces
    }

    // Ogni vista esce dal salvataggio COMPLETA delle proprie impostazioni.
    // Senza questo passaggio le chiavi comparirebbero solo nelle pose che
    // l'autore ha effettivamente attraversato durante la sessione (è l'effetto
    // di mirroring a scriverle, e lavora solo sulla posa attiva), producendo un
    // file popolato a macchia di leopardo a seconda di come si è navigato.
    // Il caricamento se la caverebbe comunque — le chiavi assenti cadono sui
    // default — ma un file che descrive tutte le viste allo stesso modo è
    // ispezionabile e diffabile, e questo è il file che va in produzione.
    for (const conf of Object.values(configs())) {
      if (!conf) continue
      for (const k of VIEW_SETTING_KEYS) if (conf[k] === undefined) conf[k] = DEFAULT_VIEW_SETTINGS[k]
    }

    // Le luci rientrano nello store prima di serializzare: `configsRef` è
    // mutata in loco dall'editor, quindi lo store va riallineato o il prossimo
    // che lo legge vedrebbe la versione caricata, non quella autorata.
    store?.replace('lights', configs())

    // ⚠️ `store.toJSON()`, MAI di nuovo un elenco di sezioni scritto a mano qui.
    // Fino a poco fa questa era la lista letterale delle otto sezioni note al
    // momento in cui fu scritta — un residuo dei tempi in cui i valori vivevano
    // nei globali `window.__STATE_*`. Il difetto di quella forma non è la
    // verbosità: è che una sezione NUOVA (`postfx`, aggiunta col
    // post-processing) non compare nel file salvato e nessuno se ne accorge —
    // il JSON resta valido, si ricarica senza errori, e la sezione mancante
    // ricade sui default (vedi `hydrate`, che salta le sezioni assenti). Cioè
    // esattamente una regressione silenziosa: si autora, si salva, e la
    // taratura sparisce al reload.
    //
    // `toJSON` itera COMPOSER_SECTIONS, che è già la definizione della forma del
    // file: aggiungere una sezione allo store la fa entrare nel salvataggio
    // senza toccare questo punto.
    //
    // Cosa resta fuori, per scelta e non per dimenticanza: `ui` (stato
    // dell'editor — e da questo refactor ci vive anche `selectedLight`) e
    // `view` (impostazioni PER POSA, già specchiate dentro `lights` dal blocco
    // qui sopra).
    const json = JSON.stringify(store.toJSON(), null, 2)

    // ⚠️ Si scrive ESATTAMENTE il percorso da cui il prodotto legge
    // (`product.configUrl`, lo stesso che `ConfigLoader` fetcha): il file
    // salvato e il file caricato non possono divergere perché sono lo stesso.
    // Era proprio quello il difetto del download — il salvataggio riusciva, la
    // copia in `public/` no, e si ricaricava la versione vecchia credendo di
    // guardare la nuova.
    try {
      const res = await fetch(SAVE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: configUrl, json }),
      })
      // Un dev server senza il plugin risponde 404 con una pagina HTML: non
      // basta guardare se il fetch ha risolto.
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      return { ok: true, path: configUrl }
    } catch (err) {
      // Nessun endpoint (pacchetto installato altrove, anteprima statica) o
      // scrittura rifiutata: si torna al download, che è pur sempre un
      // salvataggio. L'esito lo dice, così il pulsante non finge un successo.
      console.warn(`[LightEditor] salvataggio su ${configUrl} non riuscito, ripiego sul download:`, err)
      downloadJSON(json, configUrl.split('/').pop() || 'app-state-config.json')
      return { ok: false, fallback: 'download', error: String(err?.message ?? err) }
    }
  }

  const handleLoadJSON = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          // Stessa via del fetch di produzione: applyConfig idrata lo store e
          // avvisa i consumatori. Le luci rientrano dalla sottoscrizione del
          // rig, non da questo handler.
          applyConfig(store, JSON.parse(ev.target.result))
          setSelected(null)
          alert('Configurazione Globale caricata con successo!')
        } catch {
          alert('Errore: Il JSON fornito non è valido.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Wrapper sottili su un ref riaggiornato a ogni render (stesso idioma di
  // `focusImplRef` in useComposerControls.js): l'effetto di pubblicazione gira
  // una volta sola (`deps: [apiRef]`), ma le funzioni pubblicate non si
  // congelano sulla closure del primo mount. `Object.assign`, mai
  // `apiRef.current = {...}`: il ponte ha più scrittori (vedi CLAUDE.md).
  //
  // ⚠️ I tre comandi sono pubblicati da QUI e non più dal rig, ed è corretto:
  // tutti e tre i chiamanti stanno in authoring/ (DebugPanel per salva/carica,
  // ViewSettingsTuner per "Resetta Vista"). In produzione non esistevano
  // comunque — semplicemente ci arrivavano dentro.
  const implRef = useRef({})
  implRef.current.save = handleSaveJSON
  implRef.current.load = handleLoadJSON

  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, {
      // Restituisce la PROMESSA dell'esito (vedi handleSaveJSON): chi lo chiama
      // può dire se il file servito è stato sovrascritto o se si è ripiegato
      // sul download.
      saveConfigJSON: () => implRef.current.save?.(),
      loadConfigJSON: () => implRef.current.load?.(),
      // Azzera le luci della vista attiva.
      resetActiveView: () => {
        const p = rigRef?.current?.getActivePose?.()
        if (!p) return false
        const view = rigRef?.current?.getViewControls?.()
        const def = generateDefaultConfig()
        def.showHelpers = view?.showHelpers
        def.showSurfaces = view?.showSurfaces
        rigRef.current.getConfigs()[p] = def
        // Anche le velocità di transizione tornano ai default: fanno parte
        // della vista, quindi "resetta vista" le comprende.
        setControls(readViewSettings(def))
        store.set('ui', { selectedLight: null })
        return p
      },
    })
    return () => {
      delete apiRef.current.saveConfigJSON
      delete apiRef.current.loadConfigJSON
      delete apiRef.current.resetActiveView
    }
  }, [apiRef, rigRef, setControls, store])

  // Il pannello segue gli stessi helper che commenta: se non se ne vede
  // nessuno, non c'è niente da selezionare.
  if (editMode !== 'lights' || !(controls.showHelpers || controls.showSurfaces)) return null

  const { faces = [], layers = {}, gridLayers = [] } = rig() ?? {}

  return (
    <Html fullscreen style={{ pointerEvents: 'none', zIndex: 9999 }}>
      {/* Etichetta della vista attiva. Il rig scriveva questo testo a mano
          dentro il proprio useFrame (`labelRef.current.innerText`), cioè un
          nodo DOM dell'authoring mutato da codice di produzione a 60 Hz: ora
          la posa passa da `store.ui` e questo è un normale render React. */}
      <div
        style={{
          position: 'absolute',
          bottom: '30px',
          left: '30px',
          background: 'rgba(20, 20, 20, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: '#4dabf7',
          padding: '10px 20px',
          borderRadius: '16px',
          fontFamily: 'monospace',
          fontSize: '15px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}
      >
        {activePose ? `Vista attiva: ${activePose}` : 'Caricamento Vista...'}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '85px',
          left: '30px',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* 1. Selettore GLOBALE (tutte le 32 sorgenti) */}
        <select value={selectedLight ?? ''} onChange={onSelectLight} style={SELECT_STYLE}>
          <option value="">-- Seleziona Luce GLOBALE --</option>
          <optgroup label="Facce (Superfici)">
            {faces.map((f) => (
              <option key={`surf_${f.index}`} value={`surf_${f.index}`}>Superficie {f.index.toUpperCase()}</option>
            ))}
          </optgroup>
          {gridLayers.map((L) => (
            <optgroup key={L.prefix} label={`Griglia ${L.label}`}>
              {(layers[L.prefix] ?? []).map((_, i) => (
                <option key={`${L.prefix}_${i}`} value={`${L.prefix}_${i}`}>{L.label} {i}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* 2. Selettore delle sole luci ATTIVE in questa vista */}
        <select
          value={selectedLight ?? ''}
          onChange={onSelectLight}
          // Sfondo blu per distinguerlo dal selettore globale qui sopra.
          style={{ ...SELECT_STYLE, background: 'rgba(20, 50, 80, 0.85)', border: '1px solid rgba(100, 180, 255, 0.4)' }}
        >
          <option value="">-- Luci ATTIVE --</option>
          {activeLightsList.length === 0 && <option value="" disabled>Nessuna luce attiva in questa vista</option>}
          {activeLightsList.map((l) => (
            <option key={`active_${l.value}`} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      {selectedLight && (
        <div style={PANEL_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#4dabf7', textTransform: 'uppercase' }}>
              LUCE {selectedLight}
            </h3>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
            >✕</button>
          </div>

          {/* ⚠️ `onPointerDown={saveToHistory}` e non `onChange`: uno snapshot per
              valore intermedio riempirebbe la cronologia in un solo trascinamento.
              Si registra lo stato PRIMA del gesto. */}
          <div style={FIELD_STYLE}>
            <label style={LABEL_STYLE}>Intensità: {draft.intensity.toFixed(1)}</label>
            <input
              type="range"
              min="0"
              max={isSurfSelected ? 100 : 50}
              step={isSurfSelected ? 0.2 : 0.1}
              value={draft.intensity}
              onPointerDown={saveToHistory}
              onChange={(e) => updateLightValue('intensity', parseFloat(e.target.value))}
              style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
            />
          </div>

          <div style={FIELD_STYLE}>
            <label style={LABEL_STYLE}>Colore:</label>
            <input
              type="color"
              value={draft.color}
              onPointerDown={saveToHistory}
              onChange={(e) => updateLightValue('color', e.target.value)}
              style={{ width: '100%', height: '32px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
            />
          </div>

          {/* Le rectAreaLight non hanno decadimento: il campo esiste solo per la griglia. */}
          {!isSurfSelected && (
            <div style={FIELD_STYLE}>
              <label style={LABEL_STYLE}>Decadimento: {draft.decay.toFixed(1)}</label>
              <input
                type="range" min="0" max="5" step="0.1"
                value={draft.decay}
                onPointerDown={saveToHistory}
                onChange={(e) => updateLightValue('decay', parseFloat(e.target.value))}
                style={{ accentColor: '#4dabf7', cursor: 'ew-resize' }}
              />
            </div>
          )}
        </div>
      )}
    </Html>
  )
}
