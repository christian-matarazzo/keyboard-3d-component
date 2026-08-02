/**
 * Lo stato autorato del configuratore, in UN oggetto per ISTANZA.
 *
 * Prima di questo modulo lo stato viveva in due posti che non sono stato: i
 * pannelli Leva (che sono UI di authoring) e otto globali `window.__STATE_*`
 * letti dal salvataggio JSON, con otto `CustomEvent` su `window` a fare da
 * canale di caricamento. Tre problemi, tutti risolti dallo stesso oggetto:
 *
 * 1. ⚠️ ORDINE DI MONTAGGIO — è l'argomento decisivo, non un dettaglio.
 *    Un `CustomEvent` dispatchato prima che l'ascoltatore esista è perso PER
 *    SEMPRE: nessuno lo ripete. È il motivo per cui il fetch della
 *    configurazione era incastrato dentro il Canvas (cioè dopo il Suspense del
 *    GLB, quando tutti gli ascoltatori sono montati) invece che nel punto
 *    naturale, la shell. Uno store non ha questo problema PER COSTRUZIONE: chi
 *    monta dopo legge lo stato che trova già lì. Da qui in poi il caricamento
 *    può avvenire quando è comodo, non quando è indispensabile.
 *
 * 2. UNA PAGINA, DUE COMPONENTI. `window.__STATE_MATERIALS` è uno solo: due
 *    <KeyboardComposer> sulla stessa pagina si sovrascriverebbero i materiali a
 *    vicenda, e ognuno riceverebbe gli eventi di caricamento dell'altro. Lo
 *    store nasce in KeyboardComposer.jsx e scende come prop, quindi due istanze
 *    sono due stati.
 *
 * 3. LEVA FUORI DALLA PRODUZIONE. Finché i valori di prodotto (materiali, feel
 *    della camera, inquadrature, luci) vivevano dentro `useControls`, `leva` e
 *    tutto l'authoring erano codice di produzione, non separabili dal bundle.
 *    Qui la direzione si inverte: il runtime legge SOLO da questo store, e i
 *    pannelli Leva (in authoring/) sono l'unico posto che chiama `set`.
 *
 * Le sezioni sono esattamente le chiavi del JSON salvato, più `ui` che non si
 * salva (è lo stato dell'editor, non del prodotto). Non è una coincidenza da
 * mantenere a mano: `hydrate` e `toJSON` sono l'una l'inversa dell'altra
 * proprio perché la lista è una sola.
 *
 * ⚠️ IDENTITÀ STABILE. `set` restituisce lo STESSO oggetto quando nessun valore
 * cambia davvero. Non è un'ottimizzazione: `useComposerSection` è costruito su
 * `useSyncExternalStore`, che confronta gli snapshot per identità e cicla
 * all'infinito se ne riceve uno nuovo a ogni lettura.
 */

/**
 * Le sezioni che finiscono nel JSON di configurazione.
 *
 * ⚠️ L'ORDINE È SIGNIFICATIVO: `toJSON` itera questo elenco, e
 * `JSON.stringify` rispetta l'ordine di inserimento. Rimescolarlo non cambia
 * nulla di funzionale ma produce un file che differisce da quello committato in
 * ogni riga, il che rende inservibile il diff — che è l'unico modo che questo
 * repo ha di verificare una non-regressione dello stato autorato.
 *
 * ⚠️ `variants` contiene SOLO i binding variante→animazione di swap. La
 * selezione (quale layout è acceso) non si salva: è stato dell'utente, vive in
 * sessionStorage, e in produzione si riparte sempre dal `defaultOption`.
 */
export const COMPOSER_SECTIONS = [
  'lights',
  'materials',
  'rotation',
  'keylight',
  'spotlight',
  'focus',
  'animations',
  'variants',
  'app',
  'postfx',
]

/**
 * Stato dell'EDITOR, non del prodotto: modalità di authoring attiva e posa home
 * in corso di scelta. Vive nello store perché il runtime lo legge (`editMode`
 * entra in `controlsDisabled`), ma non viene mai serializzato — un JSON che si
 * porta dietro "ero in modalità Luci" non ha senso per nessuno.
 */
export const UI_SECTION = 'ui'

/**
 * Impostazioni della VISTA CORRENTE (margine della scatola luci, velocità di
 * transizione, helper visibili). Non si serializza da sola e non è una svista:
 * questi valori sono PER POSA e vivono dentro `lights[posa]`. Questa sezione è
 * la finestra sulla posa attiva — il rig la specchia dentro `lights` a ogni
 * modifica e la ricarica a ogni cambio di posa.
 */
export const VIEW_SECTION = 'view'

const ALL_SECTIONS = [...COMPOSER_SECTIONS, UI_SECTION, VIEW_SECTION]

/** Confronto per valore a un livello: basta, perché ogni sezione è un dizionario piatto di scalari. */
export const shallowEqual = (a, b) => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keysA = Object.keys(a)
  if (keysA.length !== Object.keys(b).length) return false
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}

const assertSection = (section) => {
  if (!ALL_SECTIONS.includes(section)) {
    throw new Error(
      `composerStore: sezione sconosciuta "${section}" (attese: ${ALL_SECTIONS.join(', ')})`,
    )
  }
}

/**
 * @param {Object} [initial] valori di partenza per sezione; le sezioni assenti
 *   nascono a `{}`. In pratica arriva da `createInitialState()` di defaults.js.
 */
export function createComposerStore(initial = {}) {
  const state = {}
  for (const section of ALL_SECTIONS) state[section] = initial[section] ?? {}

  // Un elenco di ascoltatori per sezione, più il canale '*' per chi vuole
  // sapere di qualunque cambiamento (il salvataggio, la telemetria).
  const listeners = new Map()
  const listenersFor = (section) => {
    if (!listeners.has(section)) listeners.set(section, new Set())
    return listeners.get(section)
  }

  const notify = (section, value) => {
    // Copia difensiva: un ascoltatore può disiscriversi (o iscriverne un altro)
    // mentre lo stiamo notificando.
    for (const fn of [...listenersFor(section)]) fn(value, section)
    for (const fn of [...listenersFor('*')]) fn(value, section)
  }

  const commit = (section, next) => {
    if (shallowEqual(state[section], next)) return state[section]
    state[section] = next
    notify(section, next)
    return next
  }

  return {
    /** Lettura non reattiva, a costo zero: è questa che si usa dentro useFrame. */
    get(section) {
      assertSection(section)
      return state[section]
    },

    /** Tutto lo stato, `ui` compresa. Per il salvataggio serve `toJSON`. */
    getAll() {
      return { ...state }
    },

    /**
     * Lo stato serializzabile, nell'ordine delle sezioni: è esattamente ciò che
     * finisce nel file di configurazione, senza `ui`.
     */
    toJSON() {
      const out = {}
      for (const section of COMPOSER_SECTIONS) out[section] = state[section]
      return out
    },

    /** Aggiornamento PARZIALE: le chiavi assenti dal patch restano quelle di prima. */
    set(section, patch) {
      assertSection(section)
      if (!patch) return state[section]
      return commit(section, { ...state[section], ...patch })
    },

    /**
     * Sostituzione INTEGRALE. Serve alle sezioni che non sono dizionari di
     * scalari e per cui un merge non ha senso: `animations` ({version, items})
     * e `lights` (una config per posa).
     */
    replace(section, value) {
      assertSection(section)
      return commit(section, value)
    },

    /**
     * Applica un JSON di configurazione appena letto. Le sezioni assenti dal
     * file NON vengono toccate: un JSON salvato prima che una manopola
     * esistesse (è il caso di `rotation.focusOutDamp`) deve continuare a
     * caricarsi lasciando quella manopola al suo default, non azzerandola.
     */
    hydrate(parsed) {
      if (!parsed) return
      for (const section of COMPOSER_SECTIONS) {
        const value = parsed[section]
        if (!value) continue
        // `lights` e `animations` sono strutture, non manopole: si sostituiscono.
        if (section === 'lights' || section === 'animations') commit(section, value)
        else commit(section, { ...state[section], ...value })
      }
    },

    /**
     * @param {string} section nome di sezione, oppure '*' per qualunque cambiamento
     * @param {(value: Object, section: string) => void} fn
     * @returns {() => void} disiscrizione
     */
    subscribe(section, fn) {
      if (section !== '*') assertSection(section)
      const set = listenersFor(section)
      set.add(fn)
      return () => set.delete(fn)
    },
  }
}
