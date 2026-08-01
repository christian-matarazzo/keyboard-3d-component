import { useEffect, useMemo } from 'react'
import { useControls } from 'leva'
import { shallowEqual } from '../state/composerStore'

/**
 * L'UNICO ponte fra i pannelli Leva e lo store.
 *
 * Prima ogni sezione di stato ripeteva lo stesso giro in casa propria, sparso
 * su cinque file: una `useControls`, un effetto che pubblicava il valore su un
 * globale `window.__STATE_*`, un secondo effetto che ascoltava un
 * `app-load-*` per riportarlo dentro. Tre pezzi × cinque sezioni, tutti uguali
 * e tutti da tenere allineati a mano.
 *
 * Qui il giro è scritto una volta. Il contratto è una direzione sola:
 *
 *   il runtime LEGGE dallo store · l'authoring SCRIVE nello store
 *
 * Nessun file di runtime importa `leva`. È questa regola — non il flag
 * `?debug` — a rendere l'authoring separabile dal bundle di produzione.
 *
 * ⚠️ NON SERVE UNA GUARDIA ANTI-ECO, e vale la pena sapere perché. Il giro
 * store → Leva → store si chiude da solo: `setValues` fa cambiare `values`,
 * l'effetto riscrive nello store, e lì il confronto shallow di `set` trova gli
 * stessi valori e NON notifica. Il ciclo muore al secondo passaggio, senza
 * flag. Se un giorno `composerStore.set` smettesse di garantire l'identità
 * stabile, questo hook diventerebbe un ciclo infinito — è lo stesso vincolo su
 * cui poggia `useComposerSection`.
 */

/**
 * @param {Object} store lo store del componente
 * @param {string} section nome di sezione (vedi COMPOSER_SECTIONS)
 * @param {Object} schema schema Leva: estremi, passi ed etichette degli slider.
 *   ⚠️ I VALORI di partenza non si leggono da qui ma dallo store — vedi `seed`.
 * @param {{ folder?: string, collapsed?: boolean, render?: Function, groupId?: string }} [options]
 *   `render` è il callback di visibilità di Leva — vedi LEVA_MODE_PATH.
 *   `groupId` seleziona una SOTTOCHIAVE della sezione: `materials` e `focus`
 *   non sono dizionari di scalari ma dizionari PER GRUPPO DI MESH, e ogni
 *   pannello possiede una sola voce.
 */
export function useLevaSection(store, section, schema, options = {}) {
  const { folder, collapsed = true, render, groupId } = options

  // Lettura e scrittura passano di qui, così il caso piatto e quello per gruppo
  // divergono in due punti soli invece che in tutto l'hook.
  const readOwn = () => {
    const current = store.get(section)
    return groupId ? current?.[groupId] : current
  }

  // ⚠️ Nel caso per gruppo il confronto va fatto QUI, prima di scrivere. `set`
  // confronta la sezione a un livello, e `{...materials, keycaps: {…}}` produce
  // sempre un sotto-oggetto nuovo: lo vedrebbe come cambiato, notificherebbe,
  // il pannello riscriverebbe, e il giro non si chiuderebbe mai. Con questa
  // guardia il ciclo muore come nel caso piatto.
  const writeOwn = (next) => {
    if (!groupId) return store.set(section, next)
    const current = store.get(section)
    if (shallowEqual(current?.[groupId], next)) return
    store.set(section, { ...current, [groupId]: next })
  }

  // Seed una volta sola, al mount, DALLO STORE: se la configurazione è già
  // stata caricata il pannello nasce sui valori autorati, non sui default.
  // Prima questo non era possibile — i default erano dentro lo schema — ed è il
  // motivo per cui le cartelle si nascondevano con `render` invece di essere
  // smontate: un rimount le avrebbe riportate ai default. Ora un rimount è
  // innocuo.
  const seed = useMemo(() => {
    const current = readOwn()
    const out = {}
    for (const [key, spec] of Object.entries(schema)) {
      const value = current?.[key]
      if (value === undefined) out[key] = spec
      else if (spec && typeof spec === 'object' && !Array.isArray(spec)) out[key] = { ...spec, value }
      else out[key] = value
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [values, setValues] = useControls(folder, () => seed, { collapsed, render })

  // Leva → store
  useEffect(() => {
    writeOwn(values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, store, section, groupId])

  // store → Leva (caricamento di un JSON, o un gizmo 3D che muove uno slider).
  // Si filtra sulle chiavi dello schema: una sezione può contenere campi che
  // questo pannello non espone, e Leva non sa cosa farsene.
  useEffect(() => {
    const keys = Object.keys(schema)
    return store.subscribe(section, () => {
      const own = readOwn()
      if (!own) return
      const patch = {}
      for (const key of keys) if (own[key] !== undefined) patch[key] = own[key]
      if (Object.keys(patch).length) setValues(patch)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, section, groupId, setValues])

  return values
}

/**
 * Il percorso Leva del selettore di modalità, citato dal `render` delle cartelle
 * che devono comparire solo in una certa modalità di authoring.
 *
 * ⚠️ MISURATO, non supposto: `render` NON si può scrivere come una closure su un
 * booleano esterno. Leva rivaluta un `render` solo quando cambia uno dei valori
 * che quel callback ha letto **tramite `get`** — è così che si iscrive alle
 * dipendenze. Un callback che non chiama `get` non ha dipendenze, quindi viene
 * valutato una volta e mai più: le cartelle restano com'erano al mount. È stato
 * provato passando `editMode` come prop booleana, e le cartelle luce non
 * comparivano più entrando in modalità Luci.
 *
 * Resta quindi il percorso testuale, ma il suo significato è cambiato e in
 * meglio: prima era l'unico posto dove viveva `editMode`, e quindi un pezzo di
 * comportamento di PRODUZIONE (`controlsDisabled`) appeso a una stringa dentro
 * un pannello di debug. Adesso il valore autorevole è `store.ui.editMode`, e
 * questa stringa è un fatto interno fra pannelli di authoring — che in fase 6
 * finiranno tutti nella stessa cartella, e a quel punto potranno essere montati
 * e smontati invece che nascosti (cosa oggi impossibile per le due luci-ombra,
 * che oltre al pannello rendono luci vere).
 *
 * Il rimontaggio, quando arriverà, sarà innocuo: i valori vivono nello store, e
 * `useLevaSection` ci si riseeda sopra.
 */
export const LEVA_MODE_FOLDER = '⚙️ Editor · Modalità'
export const LEVA_MODE_PATH = `${LEVA_MODE_FOLDER}.editMode`

/** `render` per una cartella visibile solo in una data modalità di authoring. */
export const renderInMode = (mode) => (get) => get(LEVA_MODE_PATH) === mode
