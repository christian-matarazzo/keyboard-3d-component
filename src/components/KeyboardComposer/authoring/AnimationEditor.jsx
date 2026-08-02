import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './AnimationEditor.module.css'
import { ACTIONS, ACTION_GROUPS } from '../animation/actions'
import { EASING_NAMES } from '../animation/easings'
import { SELECTOR_KINDS } from '../animation/selectors'
import {
  buildStepGroups,
  buildWaves,
  canRequire,
  newAnimation,
  newStep,
  normalizeAnimations,
  requireChain,
  slugify,
} from '../animation/animationSchema'
import { cloneAnimation, cloneSteps, reverseAnimation } from '../animation/animationTransforms'

const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Le etichette dell'HUD sono duplicate per design (più pose condividono la
// stessa label breve): si disambigua accodando la chiave, come in Scene.jsx.
// Derivate dal grafo del PRODOTTO attivo, non più da una costante di modulo:
// le pose selezionabili in uno step `goToPose` sono quelle di questo modello.
const poseOptionsOf = (poseGraph) =>
  poseGraph.keys.map((key) => ({ key, label: `${poseGraph.label(key)} · ${key}` }))

const WAIT_LABEL = { settle: 'attendi', duration: 'durata', none: 'subito' }

// Quanto indietro si può tornare, e per quanto tempo due modifiche consecutive
// dello STESSO campo contano come una sola (o scrivere un nome darebbe un passo
// di cronologia per carattere).
const HISTORY_LIMIT = 60
const COALESCE_MS = 700

const DEFAULT_TINT = '#ff4d4d'

/** Il valore di default dichiarato dallo schema, anche quando è una factory. */
const defaultOf = (schema) =>
  typeof schema.default === 'function' ? schema.default() : schema.default ?? null

const isDefaultValue = (value, schema) =>
  JSON.stringify(value ?? null) === JSON.stringify(defaultOf(schema) ?? null)

/**
 * Durata PREVEDIBILE di uno step, ritardo compreso — `null` quando non lo è.
 *
 * ⚠️ Il `null` non è una lacuna da colmare: metà degli step finisce quando un
 * predicato di fisica converge (la molla della posa, il dolly del focus) o
 * quando l'utente clicca, quindi la stessa animazione dura davvero tempi
 * diversi su macchine diverse — vedi «ogni done è una policy, non un fatto» in
 * CLAUDE.md. Mostrare un numero inventato lì sarebbe peggio che non mostrarne.
 */
const stepDuration = (step) => {
  const action = ACTIONS[step.action]
  const delay = step.delay ?? 0
  if (step.wait === 'none') return delay
  if (step.wait === 'duration') return delay + (step.duration ?? 0)
  // 'settle' con un predicato dietro: imprevedibile. Senza predicato il runtime
  // ripiega sulla durata (vedi isStepDone), e allora è calcolabile.
  if (action?.isSettled) return null
  return delay + (step.duration ?? 0)
}

/** Una wave dura quanto il suo step più lento; ignota se lo è anche uno solo. */
const waveDuration = (wave) => {
  let t = 0
  for (const step of wave) {
    const d = stepDuration(step)
    if (d == null) return null
    t = Math.max(t, d)
  }
  return t
}

const formatSeconds = (t) => `${t < 10 ? t.toFixed(1) : Math.round(t)} s`

const stepsLabel = (n) => `${n} ${n === 1 ? 'passo disponibile' : 'passi disponibili'}`

/**
 * Cosa c'è di storto in uno step, in italiano e senza allarmismi.
 *
 * Tutti i casi qui sotto hanno in comune la cosa che li rende utili: a runtime
 * NON danno errore. Un selettore senza gruppo risolve zero mesh e l'azione non
 * fa nulla in silenzio, esattamente come un'animazione scritta bene che però non
 * si vede — ed è mezz'ora persa a cercarla altrove.
 */
const stepIssues = (step) => {
  const action = ACTIONS[step.action]
  if (!action) return []
  const out = []
  for (const schema of action.params ?? []) {
    const v = step.params?.[schema.key]
    if (schema.type === 'group' && !v) out.push('nessun gruppo scelto: lo step non fa nulla')
    if (schema.type === 'selector') {
      if (v?.kind === 'group' && !v.groupId) {
        out.push('selettore senza gruppo: lo step non fa nulla')
      }
      if (v?.kind === 'meshes' && (v.names ?? []).length === 0) {
        out.push('nessuna mesh scelta: lo step non fa nulla')
      }
      if (v?.kind === 'allExcept' && (v.groupIds ?? []).length === 0) {
        out.push('«tutto tranne» senza esclusioni: equivale a «tutto»')
      }
    }
  }
  if (action.durationDriven && !(step.duration > 0)) {
    out.push('durata 0: l’effetto scatta invece di interpolare')
  }
  if (step.action === 'setMaterial') {
    const touched = ['color', 'emissive', 'emissiveIntensity', 'roughness', 'metalness'].some(
      (k) => step.params?.[k] != null,
    )
    if (!touched) out.push('nessuna proprietà impostata: non cambia niente')
  }
  return out
}

/**
 * Editor delle animazioni autorate (?debug + editMode 'anim') — sostituisce la
 * vecchia Timeline a keyframe.
 *
 * Overlay DOM fuori dal Canvas, stessi idiomi di Hud.jsx: `DEBUG` ricalcolato
 * in locale, un poll a 150 ms sul ponte imperativo `poseApi` (per `editMode` e
 * per lo stato del runtime, che vive in ref dentro il Canvas e non in stato
 * React), `null` se non siamo in modalità.
 *
 * Due viste sugli STESSI dati:
 *  - lista a blocchi: una riga per step, coi campi dei parametri GENERATI dallo
 *    schema del registry (animation/actions.js) — aggiungere un'azione lì la fa
 *    comparire qui senza toccare questo file;
 *  - vista JSON: una textarea con testo in stato LOCALE, così un JSON a metà
 *    digitazione non distrugge il modello; si applica solo con "Applica",
 *    passando da `normalizeAnimations`.
 *
 * Tre comodità che non si vedono guardando il markup, e da cui dipende il resto:
 *  1. CRONOLOGIA — ogni scrittura passa da `commitAll`, che impila lo stato
 *     precedente: non esiste una modifica non annullabile, import compreso.
 *     Le scritture ravvicinate sullo STESSO campo si accorpano, o scrivere un
 *     nome darebbe un passo di cronologia per carattere.
 *  2. PUNTO D'INSERIMENTO — il ⌖ di un blocco decide dove finiscono i nuovi
 *     step e gli incolla; senza, vanno in fondo (com'era prima).
 *  3. DIAGNOSI — `stepIssues` racconta ciò che a runtime non darebbe errore ma
 *     non farebbe nulla (un selettore senza gruppo risolve zero mesh, in
 *     silenzio).
 */
export default function AnimationEditor({
  poseApi,
  store,
  animations,
  onChange,
  // Prodotto attivo: gruppi di mesh, varianti e grafo delle pose che gli step
  // autorati possono citare (vedi products/).
  product,
  variantAnimations = {},
  onVariantAnimationsChange,
  // Sezione `app` del JSON: animazione di rientro in idle e tempi della
  // dissolvenza di uscita (vedi KeyboardComposer.jsx).
  appConfig = null,
  onAppConfigChange,
}) {
  const { meshGroups, meshVariants, poseGraph } = product
  const poseOptions = useMemo(() => poseOptionsOf(poseGraph), [poseGraph])

  const [editMode, setEditMode] = useState(null)
  const [runState, setRunState] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState(null)
  const [meshCatalog, setMeshCatalog] = useState([])
  const [collapsed, setCollapsed] = useState(false)
  // Appunti di step: sopravvivono al cambio di animazione (il pannello resta
  // montato), quindi sono anche il modo di portare un blocco da un'animazione
  // a un'altra. Non vanno nel JSON: sono uno stato dell'attrezzo, non del dato.
  const [clipboard, setClipboard] = useState(null)
  // Gruppi di step sincronizzati chiusi a icona, per chiave del primo step.
  const [foldedGroups, setFoldedGroups] = useState(() => new Set())
  // PUNTO D'INSERIMENTO: id del primo step del blocco dopo cui finiscono i
  // nuovi step e gli incolla. `null` = in fondo, che è com'era prima. Uno stato
  // solo per due comandi, invece di un «incolla qui» e un «aggiungi qui» su
  // ogni blocco — e la stessa scelta vale per entrambi, che è ciò che ci si
  // aspetta dopo averla fatta una volta.
  const [insertAfterId, setInsertAfterId] = useState(null)
  /**
   * Sezioni ripiegate sopra la lista degli step.
   *
   * ⚠️ Chiuse TUTTE all'apertura, ed è la scelta che dà senso alla funzione:
   * loop, prerequisito di sequenza, binding di variante e transizioni di
   * sistema si impostano una volta per animazione, mentre gli step si
   * rimaneggiano in continuazione — e in una colonna alta come la finestra
   * quelle quattro sezioni sempre aperte lasciavano visibile poco più di un
   * blocco per volta. Chi ne apre una la ritrova aperta finché non la richiude.
   */
  const [foldedSections, setFoldedSections] = useState(
    () => new Set(['opzioni', 'sequenza', 'varianti', 'transizioni']),
  )
  const toggleSection = (id) =>
    setFoldedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // Esito dell'ultima operazione di autorazione (inverso, incolla…): un
  // inverso generato è un punto di partenza, e ciò che non ha saputo invertire
  // va detto, non lasciato scoprire alla prima prova.
  const [notice, setNotice] = useState(null)

  /**
   * CRONOLOGIA — pile di stati INTERI del set di animazioni.
   *
   * Stati interi e non diff: il modello è già un albero JSON piccolo e
   * immutabile per convenzione (ogni mutazione qui dentro ricostruisce gli
   * oggetti toccati), quindi una pila di riferimenti costa quanto una pila di
   * patch e non può desincronizzarsi. Il tetto è lì per la memoria, non per la
   * correttezza.
   *
   * ⚠️ Copre il SET DI ANIMAZIONI, non i binding di variante né le transizioni
   * di sistema: quelli sono singole select in fondo al pannello, dove un
   * annullamento vale meno di un secondo clic, e includerli avrebbe richiesto di
   * fotografare tre sorgenti che il pannello riceve da tre prop diverse.
   */
  const historyRef = useRef({ past: [], future: [], lastKey: null, lastAt: 0 })
  // Le profondità delle due pile vivono anche in stato React: i pulsanti ↺/↻
  // devono accendersi e spegnersi, e una ref non fa ri-renderizzare.
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 })
  // Comandi raggiunti dal gestore di tastiera, che è registrato una volta sola
  // (idioma dei ref mirror, vedi CLAUDE.md).
  const commandsRef = useRef({})

  const items = animations?.items ?? []
  const current = items.find((a) => a.id === selectedId) ?? items[0] ?? null

  // Poll unico: modalità editor + stato del sequencer.
  useEffect(() => {
    const id = setInterval(() => {
      const api = poseApi.current
      const mode = api?.editMode ?? 'none'
      setEditMode((prev) => (prev === mode ? prev : mode))
      const st = api?.animationState?.() ?? null
      setRunState((prev) => {
        if (prev === st) return prev
        if (
          prev &&
          st &&
          prev.id === st.id &&
          prev.state === st.state &&
          prev.waveIndex === st.waveIndex &&
          prev.waitingTrigger?.name === st.waitingTrigger?.name
        ) {
          return prev
        }
        return st
      })
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  // Catalogo mesh: chiesto una volta all'apertura (il GLB può non essere
  // ancora pronto al mount, quindi si riprova finché non risponde).
  useEffect(() => {
    if (editMode !== 'anim' || meshCatalog.length > 0) return
    const read = () => {
      const list = poseApi.current?.meshCatalog?.()
      if (list?.length) setMeshCatalog(list)
    }
    read()
    const id = setInterval(read, 400)
    return () => clearInterval(id)
  }, [editMode, meshCatalog.length, poseApi])

  /**
   * Ctrl/⌘+Z e Ctrl/⌘+Shift+Z (o Ctrl+Y) per annullare e rifare.
   *
   * ⚠️ Non intercetta la scorciatoia mentre il fuoco è in un campo di testo: lì
   * l'annullamento che serve è quello del BROWSER, che disfa l'ultima parola
   * digitata. Rubarglielo per tornare indietro di un'intera modifica del
   * modello sarebbe una sorpresa sgradevole proprio mentre si scrive un nome.
   *
   * Registrato una volta sola e servito da `commandsRef`, perché i due comandi
   * si ricostruiscono a ogni render (dipendono da `animations`).
   */
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key?.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      const cmd = commandsRef.current
      if (!cmd.undo) return
      e.preventDefault()
      if (key === 'y' || e.shiftKey) cmd.redo()
      else cmd.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Entrando nella vista JSON si serializza l'animazione corrente; uscendo si
  // riparte dal modello (la textarea non è la fonte di verità).
  useEffect(() => {
    if (!showJson) return
    setJsonText(JSON.stringify(current ?? {}, null, 2))
    setJsonError(null)
  }, [showJson, current])

  const waves = useMemo(() => (current ? buildWaves(current) : []), [current])
  // Mappa step.id -> indice di wave, per rientrare le righe e evidenziare
  // quella in esecuzione senza ricalcolare la partizione nel render.
  const waveOfStep = useMemo(() => {
    const map = new Map()
    waves.forEach((wave, i) => wave.forEach((s) => map.set(s.id, i)))
    return map
  }, [waves])
  // Blocchi VISIVI: la stessa partizione, ma sui soli step così come sono
  // scritti, disabilitati compresi — è la scatola apribile/chiudibile
  // dell'editor. Il numero di wave mostrato su ogni scheda continua ad arrivare
  // da `waveOfStep`, che è la verità del runtime (vedi buildStepGroups).
  const stepGroups = useMemo(() => buildStepGroups(current?.steps ?? []), [current])
  // Posizione piatta di ogni step: i comandi ↑/↓ e i duplicati ragionano
  // sull'indice nella lista, i blocchi no.
  const indexOfStep = useMemo(() => {
    const map = new Map()
    ;(current?.steps ?? []).forEach((s, i) => map.set(s.id, i))
    return map
  }, [current])

  if (!DEBUG || editMode !== 'anim') {
    // Pannello non a video: la scorciatoia da tastiera resta registrata (è un
    // effetto senza dipendenze) ma non deve poter annullare su uno stato vecchio.
    commandsRef.current = {}
    return null
  }

  // ── Cronologia ────────────────────────────────────────────────────────────
  const syncHistoryDepth = () => {
    const h = historyRef.current
    setHistoryDepth((prev) =>
      prev.past === h.past.length && prev.future === h.future.length
        ? prev
        : { past: h.past.length, future: h.future.length },
    )
  }

  /**
   * Fotografa lo stato PRIMA della modifica.
   *
   * `coalesceKey` è ciò che rende la cronologia usabile su un campo di testo o
   * su uno slider: due scritture consecutive con la stessa chiave entro
   * COALESCE_MS non impilano un secondo passo, quindi annullare torna a prima
   * dell'intera digitazione invece che di un carattere. La chiave identifica il
   * CAMPO (`param:<stepId>:<key>`), non l'operazione: cambiare campo spezza
   * l'accorpamento anche se si è veloci.
   */
  const pushHistory = (coalesceKey) => {
    const h = historyRef.current
    const now = Date.now()
    const merge = coalesceKey && h.lastKey === coalesceKey && now - h.lastAt < COALESCE_MS
    if (!merge) {
      h.past.push(animations)
      if (h.past.length > HISTORY_LIMIT) h.past.shift()
    }
    h.lastKey = coalesceKey ?? null
    h.lastAt = now
    // Un ramo rifatto muore appena si scrive qualcosa di nuovo: è la regola di
    // qualunque cronologia lineare, e l'alternativa (un albero) non ha
    // interfaccia in un pannello largo 400 px.
    h.future = []
    syncHistoryDepth()
  }

  const undo = () => {
    const h = historyRef.current
    if (h.past.length === 0) return
    h.future.push(animations)
    h.lastKey = null
    onChange(h.past.pop())
    syncHistoryDepth()
    setNotice('annullato')
  }

  const redo = () => {
    const h = historyRef.current
    if (h.future.length === 0) return
    h.past.push(animations)
    h.lastKey = null
    onChange(h.future.pop())
    syncHistoryDepth()
    setNotice('rifatto')
  }

  // Il gestore di tastiera è registrato una volta sola e legge da qui.
  commandsRef.current = { undo, redo }

  // ── Mutazioni del modello ─────────────────────────────────────────────────
  // Ogni scrittura passa da `commitAll`: è l'unico punto in cui la cronologia
  // viene alimentata, quindi non esiste una modifica che non si possa annullare.
  const commitAll = (next, coalesceKey) => {
    pushHistory(coalesceKey)
    onChange(next)
  }
  const commit = (nextItems, coalesceKey) =>
    commitAll({ ...animations, items: nextItems }, coalesceKey)
  const patchAnimation = (patch, coalesceKey) =>
    commit(
      items.map((a) => (a.id === current.id ? { ...a, ...patch } : a)),
      coalesceKey,
    )
  const patchStep = (stepId, patch, coalesceKey) =>
    patchAnimation(
      { steps: current.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) },
      coalesceKey,
    )
  const patchParam = (stepId, key, value) =>
    patchAnimation(
      {
        steps: current.steps.map((s) =>
          s.id === stepId ? { ...s, params: { ...s.params, [key]: value } } : s,
        ),
      },
      `param:${stepId}:${key}`,
    )

  /**
   * Indice PIATTO dopo cui inserire: l'ultimo step del blocco scelto come punto
   * d'inserimento, o la fine della lista. Il blocco può essere sparito nel
   * frattempo (eliminato, o l'animazione è cambiata sotto): in quel caso si
   * ripiega sulla coda invece di rifiutare il comando.
   */
  const insertionIndex = () => {
    const last = current.steps.length - 1
    if (!insertAfterId) return last
    const group = stepGroups.find((g) => g[0].id === insertAfterId)
    if (!group) return last
    return indexOfStep.get(group[group.length - 1].id) ?? last
  }

  const addStep = (actionKey) => {
    if (!actionKey) return
    insertAfter(insertionIndex(), [newStep(actionKey)])
  }
  const removeStep = (stepId) =>
    patchAnimation({ steps: current.steps.filter((s) => s.id !== stepId) })
  const moveStep = (index, delta) => {
    const next = [...current.steps]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    patchAnimation({ steps: next })
  }
  const changeAction = (stepId, actionKey) => {
    // Cambiare azione ricrea lo step (parametri e default sono suoi), tenendo
    // l'id — così il runtime non lo scambia per uno step nuovo.
    const fresh = newStep(actionKey)
    patchStep(stepId, { ...fresh, id: stepId })
  }

  // ── Copia di step e di blocchi ────────────────────────────────────────────
  // `cloneSteps` rigenera gli id: sono la chiave delle istanze vive nel
  // runtime, due step con lo stesso id nella stessa animazione si
  // ruberebbero l'istanza a vicenda (vedi startStep in animationRuntime.js).

  /** Inserisce delle copie subito DOPO l'ultimo step del blocco indicato. */
  const insertAfter = (index, steps) => {
    const next = [...current.steps]
    next.splice(index + 1, 0, ...steps)
    patchAnimation({ steps: next })
  }

  const duplicateStep = (index) => {
    const src = current.steps[index]
    // Duplicato in loco: eredita il `parallel` dell'originale, quindi resta
    // dentro lo stesso blocco sincronizzato invece di aprirne uno nuovo.
    insertAfter(index, [{ ...cloneSteps([src])[0], parallel: src.parallel === true }])
  }

  const duplicateGroup = (group) => {
    const last = current.steps.findIndex((s) => s.id === group[group.length - 1].id)
    insertAfter(last, cloneSteps(group))
  }

  /**
   * Sposta un intero blocco sincronizzato di un posto, invece di far salire i
   * suoi step uno alla volta con ↑ (che oltretutto li fa attraversare il blocco
   * vicino, smembrandoli per qualche clic).
   *
   * ⚠️ Riscrive `parallel: false` sulla capofila di OGNI blocco. Senza, un
   * blocco la cui capofila porta ancora `parallel: true` — succede incollando —
   * si fonderebbe col blocco che si trova davanti dopo lo spostamento: i due
   * diventerebbero una wave sola, in silenzio. È la stessa normalizzazione che
   * `cloneSteps` applica a ciò che copia.
   */
  const moveGroup = (groupIndex, delta) => {
    const to = groupIndex + delta
    if (to < 0 || to >= stepGroups.length) return
    const next = [...stepGroups]
    ;[next[groupIndex], next[to]] = [next[to], next[groupIndex]]
    patchAnimation({
      steps: next.flatMap((g) => g.map((s, i) => ({ ...s, parallel: i > 0 && s.parallel === true }))),
    })
  }

  const copyToClipboard = (steps, what) => {
    setClipboard(steps.map((s) => structuredClone(s)))
    setNotice(`${what} negli appunti (${steps.length} step)`)
  }

  const pasteClipboard = () => {
    if (!clipboard?.length) return
    insertAfter(insertionIndex(), cloneSteps(clipboard))
    setNotice(
      insertAfterId
        ? `${clipboard.length} step incollati nel punto scelto`
        : `${clipboard.length} step incollati in fondo`,
    )
  }

  const removeGroup = (group) => {
    if (
      group.length > 1 &&
      !window.confirm(`Eliminare tutti i ${group.length} step di questo blocco?`)
    ) {
      return
    }
    const ids = new Set(group.map((s) => s.id))
    patchAnimation({ steps: current.steps.filter((s) => !ids.has(s.id)) })
  }

  // ── Gestione del set ──────────────────────────────────────────────────────
  const createAnimation = () => {
    const anim = newAnimation(`Animazione ${items.length + 1}`)
    commit([...items, anim])
    setSelectedId(anim.id)
  }
  const deleteAnimation = () => {
    if (!current) return
    commit(items.filter((a) => a.id !== current.id))
    setSelectedId(null)
  }

  /** Inserisce un'animazione derivata subito dopo quella corrente e ci si sposta. */
  const insertDerived = (anim) => {
    const at = items.findIndex((a) => a.id === current.id)
    const next = [...items]
    next.splice(at + 1, 0, anim)
    commit(next)
    setSelectedId(anim.id)
  }

  const duplicateAnimation = () => {
    if (!current) return
    insertDerived(cloneAnimation(current))
    setNotice('copia creata: ora è quella selezionata')
  }

  /**
   * Genera l'animazione che DISFA quella corrente (l'esploso che si ricompone).
   * La posa di partenza passata al generatore è quella home: è da lì che parte
   * ogni sessione di configurazione, quindi è l'unica posa di cui si sappia
   * qualcosa senza eseguire la sequenza — vedi reverseAnimation.
   */
  const makeReverse = () => {
    if (!current) return
    const { animation, notes } = reverseAnimation(current, {
      originPose: appConfig?.homePose ?? null,
    })
    if (animation.steps.length === 0) {
      setNotice('nessuno step invertibile: l’inverso sarebbe vuoto')
      return
    }
    insertDerived(animation)
    setNotice(
      notes.length > 0
        ? `inverso creato · da correggere: ${notes.join(' · ')}`
        : 'inverso creato: parte concatenato e a fine corsa rilascia tutto',
    )
  }

  // ── Import / export del solo blocco animazioni ────────────────────────────
  // Distinto da "Salva Configurazione"/"Carica JSON" del LightRig, che
  // serializzano TUTTO lo stato tunabile (luci, materiali, focus…): qui si
  // porta via e si rimette solo questa sezione, per scambiarla fra sessioni o
  // tenerla sotto versione senza toccare il resto. Il formato è identico alla
  // chiave `animations` del blob globale, quindi i due sono compatibili.
  const exportAnimations = () => {
    const blob = new Blob([JSON.stringify(animations, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'animations.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importAnimations = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result)
          const next = normalizeAnimations(parsed)
          if (next.items.length === 0) throw new Error('nessuna animazione valida nel file')
          // Sostituisce l'intero set (come "Carica JSON"), ma solo dopo
          // conferma se c'è già del lavoro in pancia.
          if (
            items.length > 0 &&
            !window.confirm(
              `Sostituire le ${items.length} animazioni correnti con le ${next.items.length} del file?`,
            )
          ) {
            return
          }
          // Passa dalla cronologia come tutto il resto: sostituire l'intero set
          // è la modifica più distruttiva che l'editor sappia fare, ed è
          // esattamente quella che deve essere annullabile.
          commitAll(next)
          setSelectedId(next.items[0].id)
        } catch (err) {
          window.alert(`Import fallito: ${err.message}`)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const normalized = normalizeAnimations([parsed])
      const anim = normalized.items[0]
      if (!anim) throw new Error('nessuna animazione valida nel JSON')
      // Si tiene l'id corrente, così i chip HUD e i riferimenti non cambiano
      // sotto i piedi per una modifica di contenuto.
      commit(items.map((a) => (a.id === current.id ? { ...anim, id: current.id } : a)))
      setJsonError(null)
    } catch (err) {
      setJsonError(err.message)
    }
  }

  // ── Comandi ───────────────────────────────────────────────────────────────
  const api = poseApi.current
  const playing = runState?.state === 'playing' || runState?.state === 'finished'
  const isCurrentPlaying = playing && runState?.id === current?.id

  // Trappola verificata in browser: `play()` di un'animazione con `startFrom:
  // 'reset'` smonta prima tutto, e il ripristino dell'opacità è SINCRONO (i
  // materiali devono tornare al registry, o resterebbero posseduti da nessuno).
  // Se quindi il primo blocco di quest'animazione è un "Torna all'insieme" con
  // la dissolvenza attiva, quando parte non c'è più niente da dissolvere: si
  // vede uno scatto. Va messo `continua da dov'è`, o lo stesso step dentro
  // l'animazione che ha applicato l'opacità.
  const fadeWontRun =
    current &&
    current.startFrom !== 'keep' &&
    (waves[0] ?? []).some(
      (s) => s.action === 'clearFocus' && s.params?.restoreOpacity !== false,
    )

  // Catena di sequenza che porta a questa animazione (lei compresa) e anello
  // che la precede: servono a mostrarla e a segnalare le due configurazioni che
  // la renderebbero irraggiungibile.
  const chain = current ? requireChain(items, current.id) : []
  const requiredAnim = current?.requires ? items.find((a) => a.id === current.requires) : null

  /**
   * Durata complessiva della sequenza, con il conto di ciò che non è
   * calcolabile. Volutamente due informazioni e non una media inventata: «≥ 4.2
   * s + 3 attese» dice sia il minimo garantito sia quante volte la sequenza
   * dipende da una fisica o da un clic — che è l'informazione utile quando
   * un'animazione «sembra lunga» e non si sa quale pezzo incolpare.
   */
  const totals = waves.reduce(
    (acc, wave) => {
      const d = waveDuration(wave)
      if (d == null) acc.unknown++
      else acc.time += d
      return acc
    },
    { time: 0, unknown: 0 },
  )

  /**
   * Avvisi contenuti in ciascuna sezione ripiegabile.
   *
   * ⚠️ Servono a FORZARNE L'APERTURA, e senza di loro il ripiegamento sarebbe
   * una regressione: questi avvisi segnalano configurazioni che a runtime non
   * danno errore (un prerequisito in loop infinito non si sblocca mai, un
   * rientro in idle senza «rilascia tutto» lascia istanze vive) e nasconderli
   * dietro una piega chiusa di default significherebbe non vederli mai. Stessa
   * regola dei parametri avanzati, che si aprono da soli quando sono fuori
   * default.
   */
  const sectionIssues = {
    opzioni: fadeWontRun,
    sequenza: requiredAnim?.loop?.mode === 'forever' || requiredAnim?.hidden === true,
    varianti: meshVariants.some((v) => {
      const bound = items.find((a) => a.id === variantAnimations?.[v.id])
      return bound?.steps?.some((s) => s.action === 'setVariant' && s.params?.optionId)
    }),
    transizioni:
      !!appConfig?.idleAnimation &&
      items.find((a) => a.id === appConfig.idleAnimation)?.stopOnFinish !== true,
  }
  const sectionOpen = (id) => !foldedSections.has(id) || !!sectionIssues[id]

  // ⚠️ Non `foldedGroups.size >= stepGroups.length`: l'insieme può conservare
  // chiavi di blocchi eliminati, e con quelle dentro il pulsante mostrerebbe
  // «apri tutti» su una lista aperta.
  const allFolded = stepGroups.length > 0 && stepGroups.every((g) => foldedGroups.has(g[0].id))

  const totalLabel = () => {
    const loop = current?.loop?.mode
    const prefix = loop === 'forever' ? '∞ · ' : loop === 'count' ? `×${current.loop.times ?? 1} · ` : ''
    if (waves.length === 0) return ''
    // Il prefisso «durata» non è decorazione: senza, il caso tutto-imprevedibile
    // si legge come «1 attesa» sotto la testata «step», che sembra un conteggio
    // di step invece che una durata.
    if (totals.unknown === 0) return `durata ${prefix}≈ ${formatSeconds(totals.time)}`
    const attese = `${totals.unknown} ${totals.unknown === 1 ? 'attesa' : 'attese'}`
    return totals.time > 0
      ? `durata ${prefix}≥ ${formatSeconds(totals.time)} · ${attese}`
      : `durata ${prefix}? · ${attese}`
  }

  const statusText = () => {
    if (!runState || runState.state === 'idle') return 'fermo'
    if (runState.waitingTrigger) return `in attesa · ${runState.waitingTrigger.label}`
    if (runState.state === 'finished') return 'concluso'
    return `wave ${runState.waveIndex + 1}/${runState.waveCount}`
  }

  return (
    <div className={`${styles.editor} ${collapsed ? styles.editorCollapsed : ''}`}>
      {/* Riga 1 — identità del pannello, stato e riduzione a icona. */}
      <div className={styles.headerTitle}>
        <span className={styles.paramLabel}>animazioni</span>
        <span className={styles.spacer} />
        <span
          className={`${styles.status} ${runState?.waitingTrigger ? styles.statusWaiting : ''}`}
        >
          {isCurrentPlaying ? statusText() : 'fermo'}
        </span>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Espandi' : 'Riduci (per vedere il modello)'}
        >
          {collapsed ? '▢' : '—'}
        </button>
      </div>

      {/* Riga 2 — quale animazione, come si chiama, play/stop. Resta visibile
          anche da ridotto: è il minimo per lanciare una prova. */}
      <div className={styles.header}>
        <select
          className={`${styles.select} ${styles.grow}`}
          value={current?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Animazione"
        >
          {items.length === 0 && <option value="">— nessuna animazione —</option>}
          {items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.btn}
          disabled={!current || current.steps.length === 0}
          onClick={() => api?.playAnimation?.(current.id)}
        >
          ▶ play
        </button>
        {/* ⚠️ Comando di AUTORAZIONE, non di prodotto: in produzione non
            esiste un "ferma" (i chip dell'HUD selezionano soltanto, e ciò che
            un'animazione lascia in scena si azzera lanciandone una con "al
            play: azzera lo stato precedente" o uscendo da config_mode). Qui
            serve per rimettere la scena a zero fra una prova e l'altra. */}
        <button
          type="button"
          className={styles.btn}
          disabled={!playing}
          onClick={() => api?.stopAnimation?.()}
          title="Solo per autorare: in produzione l'animazione non si ferma a mano"
        >
          ■ stop
        </button>
        {runState?.waitingTrigger && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnActive}`}
            onClick={() => api?.triggerAnimation?.(runState.waitingTrigger.name)}
          >
            ⚡ {runState.waitingTrigger.label}
          </button>
        )}
      </div>

      {/* Avanzamento. ⚠️ Conta le WAVE, non il tempo: le wave hanno durate
          diverse e metà non è nemmeno prevedibile (vedi `stepDuration`), quindi
          la barra avanza a scatti ed è un «a che punto della lista siamo», non
          una barra di riproduzione. Farla scorrere sul tempo avrebbe richiesto
          di mentire proprio sugli step che aspettano. */}
      {isCurrentPlaying && runState?.waveCount > 0 && (
        <div
          className={styles.progress}
          title={`wave ${runState.waveIndex + 1} di ${runState.waveCount}`}
        >
          <div
            className={styles.progressFill}
            style={{ width: `${((runState.waveIndex + 1) / runState.waveCount) * 100}%` }}
          />
        </div>
      )}

      {/* Riga 3 — gestione del set: crea/rinomina/elimina, import/export del
          solo blocco animazioni, vista JSON. */}
      {!collapsed && (
        <div className={styles.header}>
          {current && (
            <input
              className={`${styles.input} ${styles.grow}`}
              value={current.label}
              onChange={(e) => patchAnimation({ label: e.target.value }, `label:${current.id}`)}
              aria-label="Nome animazione"
            />
          )}
          {/* Lo SLUG è il nome con cui questa animazione viene lanciata da
              fuori (`api.play('go-to-rotors')`). Nasce dalla label, ma è
              modificabile perché è un contratto: una volta che dei pulsanti lo
              citano, rinominare l'animazione non deve romperli.
              ⚠️ Cambiarlo rompe i pulsanti che lo citano già. */}
          {current && (
            <input
              className={styles.input}
              value={current.slug ?? ''}
              onChange={(e) =>
                patchAnimation({ slug: slugify(e.target.value) }, `slug:${current.id}`)
              }
              aria-label="Slug pubblico"
              title="Nome pubblico: è così che un pulsante esterno lancia questa animazione (api.play). Cambiarlo rompe i pulsanti già programmati."
              placeholder="slug"
            />
          )}
          {/* Cronologia. Ha anche le scorciatoie (Ctrl+Z / Ctrl+Maiusc+Z), ma i
              pulsanti restano: sono l'unico posto in cui si vede QUANTO si può
              tornare indietro, e senza quel numero non si sa se conviene
              provare una modifica azzardata.
              ⚠️ I due stanno in un contenitore che NON va a capo: questa riga è
              a `flex-wrap` e in una colonna da 400 px la coppia si spezzava fra
              due righe, con ↺ in fondo a una e ↻ in cima all'altra. */}
          <span className={styles.pair}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnIcon}`}
              onClick={undo}
              disabled={historyDepth.past === 0}
              title={`Annulla (Ctrl+Z) — ${stepsLabel(historyDepth.past)}`}
              aria-label="Annulla"
            >
              ↺
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnIcon}`}
              onClick={redo}
              disabled={historyDepth.future === 0}
              title={`Rifai (Ctrl+Maiusc+Z) — ${stepsLabel(historyDepth.future)}`}
              aria-label="Rifai"
            >
              ↻
            </button>
          </span>
          <button type="button" className={styles.btn} onClick={createAnimation}>
            + nuova
          </button>
          {/* Duplica per farne una variante: stessi step, id nuovi, stesso
              punto nella catena di sequenza (vedi cloneAnimation). */}
          <button
            type="button"
            className={styles.btn}
            onClick={duplicateAnimation}
            disabled={!current}
            title="Duplica questa animazione per farne una variante"
          >
            ⧉ duplica
          </button>
          {/* Genera l'animazione che la disfa. Nasce concatenata e con il
              rilascio a fine sequenza — le due cose senza cui un rientro non
              funziona (vedi reverseAnimation). */}
          <button
            type="button"
            className={styles.btn}
            onClick={makeReverse}
            disabled={!current || current.steps.length === 0}
            title="Crea l'animazione inversa (es. l'esploso che si ricompone)"
          >
            ⇄ inverso
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={deleteAnimation}
            disabled={!current}
          >
            × elimina
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={importAnimations}
            title="Carica un animations.json (sostituisce il set corrente)"
          >
            ↑ importa
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={exportAnimations}
            disabled={items.length === 0}
            title="Scarica il set corrente come animations.json"
          >
            ↓ esporta
          </button>
          <button
            type="button"
            className={`${styles.btn} ${showJson ? styles.btnActive : ''}`}
            onClick={() => setShowJson((v) => !v)}
            disabled={!current}
          >
            {'{ } json'}
          </button>
        </div>
      )}

      {/* Esito dell'ultima operazione di autorazione. Non è un errore: un
          inverso generato PARTE da qui e va rifinito, e ciò che non si è
          saputo invertire (una rotazione continua, uno scambio di variante)
          è meglio leggerlo subito che scoprirlo al primo play. */}
      {!collapsed && notice && (
        <div className={styles.notice} role="status">
          <span className={styles.grow}>{notice}</span>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnIcon}`}
            onClick={() => setNotice(null)}
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>
      )}

      {!collapsed && current && !showJson && (
        <>
          <Section
            title="opzioni"
            open={sectionOpen('opzioni')}
            onToggle={() => toggleSection('opzioni')}
            issue={sectionIssues.opzioni}
          >
          <div className={styles.header}>
            <span className={styles.paramLabel}>loop</span>
            <select
              className={styles.select}
              value={current.loop?.mode ?? 'none'}
              onChange={(e) =>
                patchAnimation({ loop: { ...current.loop, mode: e.target.value } })
              }
            >
              <option value="none">nessuno</option>
              <option value="forever">infinito</option>
              <option value="count">n volte</option>
            </select>
            {current.loop?.mode === 'count' && (
              <NumberInput
                className={`${styles.input} ${styles.numSmall}`}
                value={current.loop.times ?? 1}
                min={1}
                emptyValue={1}
                onChange={(v) => patchAnimation({ loop: { ...current.loop, times: v } })}
              />
            )}
            {current.loop?.mode !== 'none' && (
              <>
                <span className={styles.paramLabel}>da wave</span>
                <NumberInput
                  className={`${styles.input} ${styles.numSmall}`}
                  value={current.loop.from ?? 0}
                  min={0}
                  onChange={(v) => patchAnimation({ loop: { ...current.loop, from: v } })}
                />
              </>
            )}
            {/* Concatenamento: è ciò che permette di premere play su una
                seconda animazione senza che zoom, opacità e trasformazioni
                della prima vengano smontati.
                ⚠️ Ed è, all'inverso, l'UNICA leva di azzeramento rimasta in
                produzione: l'HUD non ferma più niente, quindi un'animazione
                dichiarata "azzera lo stato precedente" è ciò che riporta la
                scena a zero prima di ricostruirla. Almeno una nel set
                dovrebbe averla, o si esce solo da config_mode. */}
            <label
              className={styles.paramLabel}
              title="Cosa fare, al play, di ciò che sta già girando — «azzera» è l'unico reset disponibile in produzione insieme all'uscita da config"
            >
              al play
              <select
                className={styles.select}
                value={current.startFrom ?? 'reset'}
                onChange={(e) => patchAnimation({ startFrom: e.target.value })}
              >
                <option value="reset">azzera lo stato precedente</option>
                <option value="keep">continua da dov’è</option>
              </select>
            </label>
            <label className={styles.paramLabel}>
              <input
                type="checkbox"
                checked={current.hidden === true}
                onChange={(e) => patchAnimation({ hidden: e.target.checked })}
              />{' '}
              nascosta nell’HUD
            </label>
            {/* Riguarda SOLO lo zoom: opacità e trasformazioni vengono comunque
                ripristinate allo stop, o resterebbero materiali e pivot appesi
                senza nessuno che li possieda. */}
            <label
              className={styles.paramLabel}
              title="Solo lo zoom: opacità e trasformazioni sono sempre ripristinate allo stop"
            >
              <input
                type="checkbox"
                checked={current.restoreOnStop !== false}
                onChange={(e) => patchAnimation({ restoreOnStop: e.target.checked })}
              />{' '}
              stop rilascia lo zoom
            </label>
            {/* Deroga a "fine ≠ smontaggio": serve alle sequenze il cui
                compito è RIPORTARE la scena a riposo — tipicamente quella di
                rientro in idle, che parte concatenata e quindi eredita le
                istanze dell'animazione precedente. Senza, resterebbero vive
                (uno `spinGroup` continuerebbe a girare in idle). */}
            <label
              className={styles.paramLabel}
              title="A wave esaurite l'animazione si ferma da sola, rilasciando anche ciò che ha ereditato"
            >
              <input
                type="checkbox"
                checked={current.stopOnFinish === true}
                onChange={(e) => patchAnimation({ stopOnFinish: e.target.checked })}
              />{' '}
              a fine sequenza rilascia tutto
            </label>
          </div>
          {/* Sta QUI e non più in fondo al pannello: parla di «al play», che è
              la manopola due righe sopra. Da lì teneva anche aperta la sezione
              sbagliata. */}
          {fadeWontRun && (
            <span className={styles.warning}>
              ⚠ il ripristino dell’opacità scatterà: metti “al play: continua da
              dov’è”, o sposta questo blocco nell’animazione che ha opacizzato
            </span>
          )}
          </Section>

          {/* ── Sequenza ────────────────────────────────────────────────────
              Un gruppo ordinato di animazioni non è un contenitore a parte: è
              una CATENA di prerequisiti, dove ogni anello conosce solo il
              proprio predecessore. A2 dichiara A1 e diventa lanciabile solo
              quando A1 è stata eseguita (arrivata a fine wave); A3 dichiara
              A2, e così via. L'avanzamento vive nel runtime e si azzera a ogni
              cambio di modalità di prodotto — una nuova sessione di
              configurazione riparte dal primo anello.
              ⚠️ Il vincolo lo fa rispettare l'HUD, non `play`: qui in ?debug il
              ▶ lancia sempre, o non si potrebbe provare A3 senza rifare tutto. */}
          <Section
            title="sequenza"
            open={sectionOpen('sequenza')}
            onToggle={() => toggleSection('sequenza')}
            issue={sectionIssues.sequenza}
          >
          <div className={styles.header}>
            <span
              className={styles.paramLabel}
              title="Questa animazione resterà spenta nell'HUD finché quella indicata non è stata eseguita"
            >
              solo dopo
            </span>
            <select
              className={`${styles.select} ${styles.grow}`}
              value={current.requires ?? ''}
              onChange={(e) => patchAnimation({ requires: e.target.value })}
            >
              <option value="">— sempre disponibile —</option>
              {items
                // Niente anelli: si offre solo chi non discende già da questa.
                .filter((a) => canRequire(items, current.id, a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
            </select>
          </div>
          {chain.length > 1 && (
            <div className={styles.chain}>
              {chain.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span className={styles.chainArrow}>→</span>}
                  <span className={a.id === current.id ? styles.chainSelf : undefined}>
                    {a.label}
                  </span>
                </span>
              ))}
            </div>
          )}
          {/* Due modi di rendere un anello irraggiungibile, entrambi silenziosi
              a runtime: chi non finisce mai non sblocca nessuno, e chi non ha
              un chip non può essere lanciato dall'utente. */}
          {requiredAnim?.loop?.mode === 'forever' && (
            <span className={styles.warning}>
              ⚠ «{requiredAnim.label}» è in loop infinito: non arriva mai a fine
              sequenza, quindi questa non si sbloccherà mai
            </span>
          )}
          {requiredAnim?.hidden === true && (
            <span className={styles.warning}>
              ⚠ «{requiredAnim.label}» è nascosta nell’HUD: in produzione non c’è
              un chip per eseguirla, quindi questa resta bloccata
            </span>
          )}
          </Section>

          {/* Binding variante → animazione di swap. Sta qui e non fra le
              opzioni dell'animazione perché è una proprietà della VARIANTE:
              "quando l'utente ruota questo comando, gioca questa". Finisce nel
              JSON globale.
              ⚠️ Vuoto NON vuol dire più "scambio secco": senza binding si gioca
              l'animazione INTEGRATA (un incrocio morbido in dissolvenza, vedi
              BUILTIN_ANIMATIONS in animation/animationSchema.js). Scegliere
              qui è quindi solo "la mia al posto di quella di serie". */}
          {meshVariants.length > 0 && onVariantAnimationsChange && (
            <Section
              title="swap delle varianti"
              open={sectionOpen('varianti')}
              onToggle={() => toggleSection('varianti')}
              issue={sectionIssues.varianti}
            >
              {meshVariants.map((v) => (
                <div key={v.id} className={styles.header}>
                  <span className={styles.paramLabel}>{v.label}</span>
                  <select
                    className={`${styles.select} ${styles.grow}`}
                    value={variantAnimations?.[v.id] ?? ''}
                    onChange={(e) =>
                      onVariantAnimationsChange({ ...variantAnimations, [v.id]: e.target.value })
                    }
                  >
                    <option value="">— transizione predefinita —</option>
                    {items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {/* Un'animazione di swap con variante e opzione FISSE serve un
                  verso solo: il comando dell'HUD ruota su tutte le opzioni, e
                  su quelle non previste non succederebbe nulla. */}
              {sectionIssues.varianti && (
                <span className={styles.warning}>
                  ⚠ svuota l’opzione negli step «cambia variante»: il comando di
                  layout ruota fra tutte le opzioni, un’opzione fissa copre un
                  verso solo
                </span>
              )}
            </Section>
          )}

          {/* Transizioni di sistema. Non appartengono a UNA animazione: sono
              come il componente passa da uno stato all'altro, quindi vivono
              nella sezione `app` del JSON e non fra le opzioni qui sopra.
              L'uscita dallo zoom ha la sua manopola gemella nella folder Leva
              `Rotazione` (`zoom-out (uscita)`), perché è feel di camera. */}
          {appConfig && onAppConfigChange && (
            <Section
              title="transizioni"
              open={sectionOpen('transizioni')}
              onToggle={() => toggleSection('transizioni')}
              issue={sectionIssues.transizioni}
            >
              <div className={styles.header}>
                <span className={styles.paramLabel} title="Giocata uscendo da config_mode: riporta la scena a riposo">
                  rientro in idle
                </span>
                <select
                  className={`${styles.select} ${styles.grow}`}
                  value={appConfig.idleAnimation ?? ''}
                  onChange={(e) => onAppConfigChange({ idleAnimation: e.target.value })}
                >
                  <option value="">— rientro secco —</option>
                  {items.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* Parte concatenata (`keep`) per poter dissolvere ciò che trova:
                  senza `stopOnFinish` acceso lascerebbe però vive le istanze
                  ereditate. Vale la pena dirlo dove si sceglie. */}
              {sectionIssues.transizioni && (
                  <span className={styles.warning}>
                    ⚠ accendi “a fine sequenza rilascia tutto” su questa animazione, o ciò
                    che eredita resta vivo in idle
                  </span>
                )}
              <div className={styles.header}>
                <span
                  className={styles.paramLabel}
                  title="Quanto ci mettono opacità e tinte a tornare com'erano quando un'animazione viene fermata o sostituita"
                >
                  dissolvenza in uscita
                </span>
                <NumberInput
                  className={`${styles.input} ${styles.numSmall}`}
                  value={appConfig.releaseDuration ?? 0.5}
                  min={0}
                  step={0.1}
                  onChange={(v) => onAppConfigChange({ releaseDuration: Math.max(0, v) })}
                />
                <select
                  className={`${styles.select} ${styles.grow}`}
                  value={appConfig.releaseEasing ?? 'easeInOutCubic'}
                  onChange={(e) => onAppConfigChange({ releaseEasing: e.target.value })}
                >
                  {EASING_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Binario gemello del precedente e con la stessa portata: vale
                  per il passaggio da un'animazione all'altra e per il rientro
                  secco in idle. Da spento le mesh spostate tornano a posto di
                  scatto, che è come si comportava prima. */}
              <div className={styles.header}>
                <label
                  className={styles.paramLabel}
                  title="Riporta gradualmente al loro posto le mesh che un'animazione ha traslato o ruotato"
                >
                  <input
                    type="checkbox"
                    checked={appConfig.releaseTransforms !== false}
                    onChange={(e) => onAppConfigChange({ releaseTransforms: e.target.checked })}
                  />{' '}
                  riposizionamento
                </label>
                <NumberInput
                  className={`${styles.input} ${styles.numSmall}`}
                  value={appConfig.releaseTransformsDuration ?? 0.7}
                  min={0}
                  step={0.1}
                  disabled={appConfig.releaseTransforms === false}
                  onChange={(v) =>
                    onAppConfigChange({ releaseTransformsDuration: Math.max(0, v) })
                  }
                />
                <select
                  className={`${styles.select} ${styles.grow}`}
                  value={appConfig.releaseTransformsEasing ?? 'easeInOutCubic'}
                  disabled={appConfig.releaseTransforms === false}
                  onChange={(e) => onAppConfigChange({ releaseTransformsEasing: e.target.value })}
                >
                  {EASING_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </Section>
          )}

          {/* La lista degli step non si ripiega: è l'area di lavoro. Passa
              comunque da `Section` per l'allineamento (vedi il componente). */}
          <Section title="step" open collapsible={false}>
          <div className={styles.header}>
            <span className={styles.total} title="Somma delle wave prevedibili; le altre finiscono quando converge una fisica o quando l’utente clicca">
              {totalLabel()}
            </span>
            <span className={styles.spacer} />
            {insertAfterId && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnActive}`}
                onClick={() => setInsertAfterId(null)}
                title="I nuovi step tornano ad andare in fondo"
              >
                ⌖ inserisci nel punto scelto ×
              </button>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnIcon}`}
              onClick={() =>
                setFoldedGroups(allFolded ? new Set() : new Set(stepGroups.map((g) => g[0].id)))
              }
              disabled={stepGroups.length === 0}
              title={allFolded ? 'Apri tutti i blocchi' : 'Comprimi tutti i blocchi'}
            >
              {allFolded ? '▾' : '▸'}
            </button>
          </div>
          {/* Gli step sono raggruppati per BLOCCO SINCRONIZZATO (la wave):
              quelli in parallelo stanno dentro una scatola che si apre e si
              chiude, e i comandi che valgono per tutto il blocco — play da
              qui, duplica, copia, elimina — stanno sulla sua testata invece
              che ripetuti su ogni scheda. */}
          <div className={styles.steps}>
            {current.steps.length === 0 && (
              <div className={styles.empty}>nessuno step — aggiungine uno qui sotto</div>
            )}
            {stepGroups.map((group, gi) => {
              const key = group[0].id
              const folded = foldedGroups.has(key)
              // Numero di wave del runtime: quello del primo step ABILITATO
              // del blocco (una capofila disabilitata non apre nessuna wave).
              const firstEnabled = group.find((s) => waveOfStep.has(s.id))
              const wave = firstEnabled ? waveOfStep.get(firstEnabled.id) : null
              // Durata e problemi si calcolano sui soli step ABILITATI: uno
              // step spento non allunga la wave e non può rompere niente.
              const enabledSteps = group.filter((s) => s.enabled !== false)
              const groupTime = enabledSteps.length > 0 ? waveDuration(enabledSteps) : null
              const groupIssues = enabledSteps.flatMap(stepIssues)
              return (
                <div
                  key={key}
                  className={[
                    styles.wave,
                    isCurrentPlaying && wave != null && wave === runState?.waveIndex
                      ? styles.waveRunning
                      : '',
                    insertAfterId === key ? styles.waveInsert : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={styles.waveHead}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() =>
                        setFoldedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                      title={folded ? 'Apri il blocco' : 'Comprimi il blocco'}
                    >
                      {folded ? '▸' : '▾'}
                    </button>
                    <span className={styles.waveTitle}>
                      {wave != null ? `wave ${wave + 1}` : `blocco ${gi + 1}`}
                      {group.length > 1 ? ` · ${group.length}` : ''}
                    </span>
                    {/* Durata del blocco: un numero solo quando è davvero
                        prevedibile, altrimenti il punto interrogativo — che è
                        un'informazione a sua volta («questa wave aspetta»). */}
                    {enabledSteps.length > 0 && (
                      <span
                        className={styles.waveTime}
                        title={
                          groupTime == null
                            ? 'Finisce quando converge una fisica o quando l’utente clicca: la durata non è prevedibile'
                            : 'Durata della wave (lo step più lento del blocco)'
                        }
                      >
                        {/* ⚠️ Fra parentesi, non nuda: accanto al conteggio di
                            step del titolo («wave 1 · 2» + «0.4 s») le due cifre
                            si toccavano e si leggevano come un numero solo,
                            «20.4». Misurato a video, non ipotizzato. */}
                        {groupTime == null ? '(?)' : `(${formatSeconds(groupTime)})`}
                      </span>
                    )}
                    {groupIssues.length > 0 && (
                      <span className={styles.waveIssue} title={groupIssues.join(' · ')}>
                        ⚠
                      </span>
                    )}
                    {/* Da chiuso il blocco deve restare riconoscibile: le
                        etichette delle azioni che contiene sono l'unica cosa
                        che serve per ritrovarlo. */}
                    {folded && (
                      <span className={styles.waveSummary}>
                        {group.map((s) => ACTIONS[s.action]?.label ?? s.action).join(' + ')}
                      </span>
                    )}
                    <span className={styles.spacer} />
                    {/* Spostamento del BLOCCO INTERO. Con i soli ↑/↓ per step,
                        far salire un blocco di tre voleva nove clic e nel
                        frattempo lo smembrava dentro il blocco vicino. */}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() => moveGroup(gi, -1)}
                      disabled={gi === 0}
                      title="Sposta il blocco più su"
                      aria-label="Sposta il blocco più su"
                    >
                      ⌃
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() => moveGroup(gi, 1)}
                      disabled={gi === stepGroups.length - 1}
                      title="Sposta il blocco più giù"
                      aria-label="Sposta il blocco più giù"
                    >
                      ⌄
                    </button>
                    {/* Punto d'inserimento: da qui in poi «+ aggiungi step» e
                        «incolla» finiscono subito sotto QUESTO blocco. */}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon} ${
                        insertAfterId === key ? styles.btnActive : ''
                      }`}
                      onClick={() => setInsertAfterId((prev) => (prev === key ? null : key))}
                      title="Inserisci qui sotto ciò che aggiungi o incolli"
                      aria-label="Punto d'inserimento"
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() => api?.playAnimation?.(current.id, { fromWave: wave ?? 0 })}
                      disabled={wave == null}
                      title="Play da questa wave"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() => duplicateGroup(group)}
                      title="Duplica il blocco qui sotto"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon}`}
                      onClick={() => copyToClipboard(group, 'blocco')}
                      title="Copia il blocco negli appunti (anche verso un'altra animazione)"
                    >
                      ⎘
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnIcon} ${styles.btnDanger}`}
                      onClick={() => removeGroup(group)}
                      title="Elimina il blocco"
                    >
                      ×
                    </button>
                  </div>

                  {!folded &&
                    group.map((step) => {
                      const i = indexOfStep.get(step.id)
                      return (
                        <StepRow
                          key={step.id}
                          step={step}
                          index={i}
                          total={current.steps.length}
                          waveIndex={waveOfStep.get(step.id)}
                          running={
                            isCurrentPlaying && waveOfStep.get(step.id) === runState?.waveIndex
                          }
                          meshGroups={meshGroups}
                          meshCatalog={meshCatalog}
                          meshVariants={meshVariants}
                          poseOptions={poseOptions}
                          onPatch={(patch, field) =>
                            patchStep(step.id, patch, field ? `step:${step.id}:${field}` : undefined)
                          }
                          onPatchParam={(key2, value) => patchParam(step.id, key2, value)}
                          onChangeAction={(key2) => changeAction(step.id, key2)}
                          onMove={(d) => moveStep(i, d)}
                          onRemove={() => removeStep(step.id)}
                          onDuplicate={() => duplicateStep(i)}
                          onCopy={() => copyToClipboard([step], 'step')}
                        />
                      )
                    })}
                </div>
              )
            })}
          </div>

          <div className={styles.header}>
            <select
              className={`${styles.select} ${styles.grow}`}
              value=""
              onChange={(e) => {
                addStep(e.target.value)
                e.target.value = ''
              }}
              aria-label="Aggiungi step"
            >
              <option value="">
                {insertAfterId ? '+ aggiungi step nel punto scelto…' : '+ aggiungi step in fondo…'}
              </option>
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {Object.entries(ACTIONS)
                    .filter(([, a]) => a.group === group)
                    .map(([key, a]) => (
                      <option key={key} value={key}>
                        {a.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {/* Gli appunti sopravvivono al cambio di animazione: è così che si
                porta un blocco da una all'altra. Finiscono nel punto scelto col
                ⌖ di un blocco, o in fondo se non ce n'è uno. */}
            <button
              type="button"
              className={styles.btn}
              onClick={pasteClipboard}
              disabled={!clipboard?.length}
              title={
                clipboard?.length
                  ? `Incolla ${clipboard.length} step ${
                      insertAfterId ? 'nel punto scelto' : 'in fondo'
                    }`
                  : 'Nessuno step negli appunti'
              }
            >
              ⎗ incolla{clipboard?.length ? ` (${clipboard.length})` : ''}
            </button>
          </div>
          </Section>
        </>
      )}

      {!collapsed && current && showJson && (
        <>
          <textarea
            className={styles.json}
            value={jsonText}
            spellCheck={false}
            onChange={(e) => setJsonText(e.target.value)}
          />
          <div className={styles.header}>
            <button type="button" className={styles.btn} onClick={applyJson}>
              applica
            </button>
            {jsonError && <span className={styles.jsonError}>{jsonError}</span>}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Una sezione ripiegabile del pannello ───────────────────────────────── */
/**
 * Testata di sezione con la freccia, usata anche da «step», che ripiegabile
 * NON è (`collapsible={false}`): la lista degli step è l'area di lavoro, non
 * ha senso poterla chiudere. Passa comunque di qui perché la freccia occupa
 * uno spazio fisso, quindi tutte e cinque le etichette restano allineate —
 * senza, «step» sarebbe l'unica fuori colonna.
 *
 * `issue` accende un ⚠ sulla testata E tiene la sezione aperta: un avviso
 * dentro una piega chiusa non è un avviso.
 */
function Section({ title, open, onToggle, issue, collapsible = true, children }) {
  const head = (
    <>
      <span className={styles.sectionCaret}>{collapsible ? (open ? '▾' : '▸') : ''}</span>
      <span>{title}</span>
      {issue && <span className={styles.sectionIssue}>⚠</span>}
    </>
  )
  return (
    <>
      {collapsible ? (
        <button
          type="button"
          className={styles.sectionHead}
          onClick={onToggle}
          aria-expanded={open}
          title={open ? 'Comprimi la sezione' : 'Apri la sezione'}
        >
          {head}
        </button>
      ) : (
        <span className={styles.sectionHead}>{head}</span>
      )}
      {open && children}
    </>
  )
}

/* ── Una riga della lista a blocchi ─────────────────────────────────────── */
function StepRow({
  step,
  index,
  total,
  waveIndex,
  running,
  meshGroups,
  meshCatalog,
  meshVariants,
  poseOptions,
  onPatch,
  onPatchParam,
  onChangeAction,
  onMove,
  onRemove,
  onDuplicate,
  onCopy,
}) {
  const action = ACTIONS[step.action]
  // ⚠️ Prima di ogni early return: le regole degli hook non ammettono un
  // `useState` condizionale, e questa scheda ne ha uno (le manopole avanzate).
  const [showAdvanced, setShowAdvanced] = useState(false)
  if (!action) return null

  const issues = step.enabled === false ? [] : stepIssues(step)

  // Parametri comuni e parametri avanzati, separati dallo schema del registry.
  // ⚠️ Un avanzato con un valore DIVERSO dal default si mostra comunque: una
  // manopola nascosta che cambia il comportamento è peggio di una manopola in
  // più: si finisce a cercare la causa nel runtime.
  const params = action.params ?? []
  const basicParams = params.filter((p) => !p.advanced)
  const advancedParams = params.filter((p) => p.advanced)
  const advancedDirty = advancedParams.some((p) => !isDefaultValue(step.params?.[p.key], p))
  const advancedOpen = showAdvanced || advancedDirty

  const classes = [
    styles.step,
    step.parallel && index > 0 ? styles.stepParallel : '',
    step.enabled === false ? styles.stepDisabled : '',
    running ? styles.stepRunning : '',
    issues.length > 0 ? styles.stepWarn : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {/* Riga 1 — wave, ordinamento, abilitazione, azione, comandi. */}
      <div className={styles.stepLine}>
        <span className={styles.stepIndex} title="Wave di appartenenza">
          {waveIndex != null ? waveIndex + 1 : '–'}
        </span>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Sposta su"
        >
          ↑
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Sposta giù"
        >
          ↓
        </button>

        <input
          type="checkbox"
          checked={step.enabled !== false}
          onChange={(e) => onPatch({ enabled: e.target.checked })}
          aria-label="Abilitato"
          title="Abilitato"
        />

        <select
          className={`${styles.select} ${styles.grow}`}
          value={step.action}
          onChange={(e) => onChangeAction(e.target.value)}
          aria-label="Azione"
        >
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {Object.entries(ACTIONS)
                .filter(([, a]) => a.group === group)
                .map(([key, a]) => (
                  <option key={key} value={key}>
                    {a.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        {/* Diagnosi: tutto ciò che a runtime NON darebbe errore ma non farebbe
            nulla. Vedi `stepIssues`. */}
        {issues.length > 0 && (
          <span className={styles.stepIssue} title={issues.join(' · ')}>
            ⚠
          </span>
        )}

        {/* Il primo step non ha una wave precedente a cui accodarsi. */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon} ${step.parallel ? styles.btnActive : ''}`}
          onClick={() => onPatch({ parallel: !step.parallel })}
          disabled={index === 0}
          title="In parallelo con lo step precedente"
        >
          ∥
        </button>
        {/* Duplicato in loco (resta nello stesso blocco sincronizzato) e copia
            negli appunti, che è quella che attraversa le animazioni. Il play
            da qui è salito sulla testata del blocco: è un comando di wave, non
            di singolo step. */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={onDuplicate}
          title="Duplica questo step"
        >
          ⧉
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={onCopy}
          title="Copia questo step negli appunti"
        >
          ⎘
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon} ${styles.btnDanger}`}
          onClick={onRemove}
          aria-label="Elimina step"
        >
          ×
        </button>
      </div>

      {/* Riga 2 — parametri dell'azione, generati dallo schema del registry. */}
      {params.length > 0 && (
        <div className={styles.stepLine}>
          {(advancedOpen ? params : basicParams).map((schema) => (
            <ParamField
              key={schema.key}
              schema={schema}
              value={step.params?.[schema.key]}
              allParams={step.params}
              meshGroups={meshGroups}
              meshCatalog={meshCatalog}
              meshVariants={meshVariants}
              poseOptions={poseOptions}
              onChange={(v) => onPatchParam(schema.key, v)}
            />
          ))}
          {advancedParams.length > 0 && !advancedDirty && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnIcon} ${advancedOpen ? styles.btnActive : ''}`}
              onClick={() => setShowAdvanced((v) => !v)}
              title={
                advancedOpen
                  ? 'Nascondi le manopole avanzate'
                  : `${advancedParams.length} manopole avanzate`
              }
              aria-label="Manopole avanzate"
            >
              ···
            </button>
          )}
        </div>
      )}

      {/* Riga 3 — tempi. `duration` è la durata dell'AZIONE per le azioni a
          durata, `wait` decide se la wave si blocca ad aspettarla. */}
      <div className={styles.stepLine}>
        <label className={styles.paramLabel}>
          attesa
          <select
            className={styles.select}
            value={step.wait}
            onChange={(e) => onPatch({ wait: e.target.value })}
          >
            {Object.entries(WAIT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {(step.wait === 'duration' || action.durationDriven) && (
          <label className={styles.paramLabel}>
            durata
            <NumberInput
              className={`${styles.input} ${styles.numSmall}`}
              value={step.duration}
              min={0}
              step={0.05}
              onChange={(v) => onPatch({ duration: v }, 'duration')}
            />
          </label>
        )}

        {action.durationDriven && (
          <label className={styles.paramLabel}>
            curva
            <select
              className={styles.select}
              value={step.easing}
              onChange={(e) => onPatch({ easing: e.target.value })}
            >
              {EASING_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.paramLabel} title="Ritardo dall’inizio della propria wave">
          ritardo
          <NumberInput
            className={`${styles.input} ${styles.numSmall}`}
            value={step.delay}
            min={0}
            step={0.05}
            onChange={(v) => onPatch({ delay: v }, 'delay')}
          />
        </label>
      </div>
    </div>
  )
}

/* ── Campo numerico ──────────────────────────────────────────────────────── */
/**
 * Input numerico che accetta di restare VUOTO mentre lo si scrive.
 *
 * Il problema che risolve: il modello tiene numeri, non stringhe, quindi un
 * campo controllato direttamente sul valore non ha modo di rappresentare
 * "vuoto" — cancellando tutto ricompariva subito uno `0` da riselezionare
 * prima di poter digitare. Qui il TESTO è stato locale e il vuoto vale
 * `emptyValue` (0, oppure `null` per i parametri opzionali, dove significa
 * "usa il valore autorato altrove"): il campo resta vuoto, il modello legge 0.
 *
 * La risincronizzazione dal valore esterno passa dall'updater funzionale e
 * confronta il testo GIÀ INTERPRETATO: senza, scrivere '' → onChange(0) →
 * value 0 → riscrittura del testo a "0" sarebbe un ciclo che rimette lo zero
 * che si è appena tolto.
 *
 * ⚠️ Un `type="number"` restituisce '' per gli stati intermedi non validi
 * ("-", "1."). Il testo diventa quindi vuoto per un attimo mentre si scrive un
 * negativo o un decimale — ma il browser tiene le proprie cifre nel campo e
 * React non lo riscrive (il valore del nodo è già ''), quindi a video non si
 * vede nulla di strano e l'ultimo carattere completa il numero.
 */
function NumberInput({ value, onChange, emptyValue = 0, ...rest }) {
  const [text, setText] = useState(() => (value == null ? '' : String(value)))
  const parse = (t) => (t.trim() === '' ? emptyValue : Number(t))
  const parseRef = useRef(parse)
  parseRef.current = parse

  useEffect(() => {
    setText((prev) =>
      parseRef.current(prev) === value ? prev : value == null ? '' : String(value),
    )
  }, [value])

  return (
    <input
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const parsed = parse(raw)
        // Testo non interpretabile: si tiene a video e NON si tocca il
        // modello, che resta all'ultimo valore buono.
        if (parsed === null || Number.isFinite(parsed)) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = parse(text)
        if (parsed !== null && !Number.isFinite(parsed)) {
          setText(value == null ? '' : String(value))
        }
      }}
      {...rest}
    />
  )
}

/* ── Un campo parametro, disegnato dallo schema del registry ────────────── */
function ParamField({ schema, value, allParams, meshGroups, meshCatalog, meshVariants, poseOptions, onChange }) {
  const label = schema.label ?? schema.key

  switch (schema.type) {
    // Vuoto = quella dell'intento passato al play, come per `variantOption`:
    // uno step che li lascia entrambi vuoti serve qualunque variante in
    // qualunque verso (è così che è fatta l'animazione di swap integrata).
    case 'variant':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">↔ quella del comando</option>
            {(meshVariants ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )

    // Dipende dal parametro `variantId` dello STESSO step, da cui `allParams`.
    // Il valore vuoto non è "non impostato" ma un vero comportamento: prende
    // l'opzione richiesta da chi lancia l'animazione, così un solo swap
    // autorato copre entrambi i versi.
    case 'variantOption': {
      const variant = (meshVariants ?? []).find((v) => v.id === allParams?.variantId)
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={!variant}
          >
            <option value="">↔ quella scelta dal comando</option>
            {(variant?.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )
    }
    case 'boolean':
      return (
        <label className={styles.paramLabel}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{' '}
          {label}
        </label>
      )

    case 'number':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <NumberInput
            className={`${styles.input} ${styles.num}`}
            value={value ?? null}
            min={schema.min}
            max={schema.max}
            step={schema.step ?? 0.01}
            // `optional` = campo vuoto significa "usa il valore autorato nel
            // FocusTuner", non "zero".
            emptyValue={schema.optional ? null : 0}
            placeholder={schema.optional ? 'auto' : ''}
            onChange={onChange}
          />
        </label>
      )

    case 'string':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <input
            className={styles.input}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )

    // ⚠️ Il colore ha TRE stati, non due: acceso, spento e «non impostato» —
    // che qui coincidono, ed è il punto. `null` significa «non toccare questa
    // proprietà», non «nero»: senza la casella di spunta non ci sarebbe modo di
    // dire a `setMaterial` di cambiare solo l'emissiva, perché un `<input
    // type="color">` un colore ce l'ha sempre.
    case 'color': {
      const on = value != null
      return (
        <span className={styles.paramLabel} title="Spento = non tocca questa proprietà">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onChange(e.target.checked ? value ?? DEFAULT_TINT : null)}
            aria-label={`${label} attivo`}
          />
          {label}{' '}
          <input
            type="color"
            className={styles.color}
            value={value ?? DEFAULT_TINT}
            disabled={!on}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
          />
        </span>
      )
    }

    case 'select':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? schema.options[0]}
            onChange={(e) => onChange(e.target.value)}
          >
            {schema.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )

    case 'group':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">— nessuno —</option>
            {meshGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )

    case 'pose':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            {poseOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )

    case 'easing':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? 'linear'}
            onChange={(e) => onChange(e.target.value)}
          >
            {EASING_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )

    case 'vec3': {
      const v = Array.isArray(value) ? value : [0, 0, 0]
      return (
        <span className={styles.paramLabel}>
          {label}{' '}
          <span className={styles.vec}>
            {[0, 1, 2].map((i) => (
              <NumberInput
                key={i}
                className={`${styles.input} ${styles.numSmall}`}
                value={v[i] ?? 0}
                min={schema.min}
                max={schema.max}
                step={schema.step ?? 0.05}
                onChange={(n) => {
                  const next = [...v]
                  next[i] = n
                  onChange(next)
                }}
              />
            ))}
          </span>
        </span>
      )
    }

    case 'selector':
      return (
        <SelectorField
          value={value}
          meshGroups={meshGroups}
          meshCatalog={meshCatalog}
          onChange={onChange}
        />
      )

    default:
      return null
  }
}

/* ── Editor del selettore di mesh ───────────────────────────────────────── */
const KIND_LABEL = {
  all: 'tutto',
  group: 'gruppo',
  allExcept: 'tutto tranne',
  meshes: 'mesh scelte',
}

function SelectorField({ value, meshGroups, meshCatalog, onChange }) {
  const sel = value ?? { kind: 'all' }
  const [filter, setFilter] = useState('')

  const toggleGroup = (id) => {
    const list = new Set(sel.groupIds ?? [])
    if (list.has(id)) list.delete(id)
    else list.add(id)
    onChange({ ...sel, groupIds: [...list] })
  }

  const names = sel.names ?? []
  const toggleMesh = (name) => {
    const list = new Set(names)
    if (list.has(name)) list.delete(name)
    else list.add(name)
    onChange({ ...sel, names: [...list] })
  }

  const q = filter.trim().toLowerCase()
  const visible = q
    ? meshCatalog.filter((m) => m.label.toLowerCase().includes(q))
    : meshCatalog

  return (
    <span className={styles.selector}>
      <span className={styles.selectorRow}>
        <select
          className={styles.select}
          value={sel.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
          aria-label="Tipo di selezione"
        >
          {SELECTOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>

        {sel.kind === 'group' && (
          <select
            className={`${styles.select} ${styles.grow}`}
            value={sel.groupId ?? ''}
            onChange={(e) => onChange({ ...sel, groupId: e.target.value })}
          >
            <option value="">— nessuno —</option>
            {meshGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        )}

        {sel.kind === 'allExcept' &&
          meshGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`${styles.chip} ${(sel.groupIds ?? []).includes(g.id) ? styles.chipOn : ''}`}
              onClick={() => toggleGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
      </span>

      {/* Lista a caselle di spunta, non una <select multiple>: quella
          richiedeva ctrl/shift per la selezione multipla e un click distratto
          azzerava tutto. Qui ogni riga è indipendente e la scelta persiste.
          Si mostra la label dedup di collectMeshList ma si SALVA il nome del
          nodo: gli uuid di three si rigenerano a ogni parse del GLTF e non
          sono persistibili (vedi selectors.js). */}
      {sel.kind === 'meshes' && (
        <>
          <span className={styles.selectorRow}>
            <input
              className={`${styles.input} ${styles.grow}`}
              value={filter}
              placeholder="filtra…"
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filtra mesh"
            />
            <button
              type="button"
              className={styles.chip}
              onClick={() => onChange({ ...sel, names: visible.map((m) => m.name) })}
              title="Seleziona tutte le mesh visibili nella lista"
            >
              tutte
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => onChange({ ...sel, names: [] })}
            >
              nessuna
            </button>
            <span className={styles.meshCount}>{names.length} sel.</span>
          </span>

          <span className={styles.meshList}>
            {visible.length === 0 && (
              <span className={styles.meshItem}>
                {meshCatalog.length === 0 ? 'catalogo mesh non pronto…' : 'nessuna corrispondenza'}
              </span>
            )}
            {visible.map((m) => {
              const on = names.includes(m.name)
              return (
                <label
                  key={m.label}
                  className={`${styles.meshItem} ${on ? styles.meshItemOn : ''}`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleMesh(m.name)} />
                  {m.label}
                </label>
              )
            })}
          </span>
        </>
      )}
    </span>
  )
}
