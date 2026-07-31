import { ACTIONS, DEFAULT_MAX_WAIT } from './actions'

/**
 * Forma dei dati delle animazioni autorate — l'unica cosa che finisce nel JSON
 * globale (chiave `animations`, vedi handleSaveJSON in LightRig.jsx).
 *
 * `{ version, items }` e non un array nudo: un futuro cambio di formato ha dove
 * vivere, e `!!parsed.animations` resta un controllo di presenza pulito lato
 * caricamento.
 *
 * ⚠️ I selettori di mesh salvano NOMI DI NODO, mai `uuid`: three rigenera gli
 * uuid a ogni parse del GLTF, quindi un uuid persistito è valido solo per la
 * sessione in cui è stato scritto. Il dropdown di MeshController può usarli
 * (vive e muore dentro una sessione), questo file no.
 *
 * Un'animazione è una lista ORDINATA di step. Al play la lista viene
 * partizionata in "wave": uno step con `parallel: false` apre una wave nuova,
 * uno con `parallel: true` entra in quella precedente. Il runtime avvia insieme
 * tutti gli step di una wave e avanza solo quando tutti riportano `done` — è
 * tutto il modello di sequenza (vedi animationRuntime.js).
 */

export const ANIMATIONS_VERSION = 1

export const EMPTY_ANIMATIONS = { version: ANIMATIONS_VERSION, items: [] }

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

const clampNum = (v, min, max, fallback) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.max(min, Math.min(max, n))
}

const WAIT_MODES = ['settle', 'duration', 'none']

/** Uno step nuovo, coi default dichiarati dall'azione stessa nel registry. */
export function newStep(actionKey) {
  const action = ACTIONS[actionKey]
  if (!action) throw new Error(`[anim] azione sconosciuta: ${actionKey}`)
  const params = {}
  for (const p of action.params ?? []) {
    params[p.key] = typeof p.default === 'function' ? p.default() : structuredClone(p.default ?? null)
  }
  return {
    id: uid('s'),
    action: actionKey,
    enabled: true,
    parallel: false,
    delay: 0,
    wait: action.defaults?.wait ?? 'none',
    duration: action.defaults?.duration ?? 0,
    maxWait: action.defaults?.maxWait ?? DEFAULT_MAX_WAIT,
    easing: action.defaults?.easing ?? 'linear',
    params,
  }
}

export function newAnimation(label = 'Nuova animazione') {
  return {
    id: uid('anim'),
    label,
    hidden: false,
    loop: { mode: 'none' },
    restoreOnStop: true,
    // SEQUENZA: id dell'animazione che deve essere stata ESEGUITA (arrivata a
    // fine wave) perché questa sia lanciabile. '' = nessun prerequisito.
    // Una catena `A1 ← A2 ← A3` è tutto il concetto di sequenza: non serve un
    // contenitore "gruppo ordinato", l'ordine È la catena, e ogni anello
    // conosce solo il proprio predecessore. Il vincolo è di PRODOTTO — lo fa
    // valere l'HUD, non il runtime: il ▶ dell'editor e i comandi di console
    // devono poter lanciare qualunque animazione mentre la si autora (stessa
    // regola di appMode, vedi CLAUDE.md).
    requires: '',
    // 'reset' = al play smonta ciò che sta girando; 'keep' = ci si concatena
    // sopra (vedi `play` in animationRuntime.js).
    startFrom: 'reset',
    // Deroga a "fine ≠ smontaggio": a wave esaurite l'animazione si ferma da
    // sola. Serve alle sequenze che RIPORTANO la scena a riposo (la
    // transizione verso idle), che altrimenti lascerebbero vive le istanze
    // ereditate col concatenamento — uno `spinGroup` continuerebbe a girare.
    stopOnFinish: false,
    steps: [],
  }
}

function normalizeStep(raw) {
  if (!raw || typeof raw !== 'object') return null
  const action = ACTIONS[raw.action]
  if (!action) {
    console.warn('[anim] step scartato, azione sconosciuta:', raw.action)
    return null
  }
  // I parametri partono dai default dello schema e vengono sovrascritti solo
  // dalle chiavi che l'azione dichiara: un JSON vecchio a cui manca un
  // parametro aggiunto dopo prende il default invece di `undefined`, e chiavi
  // di troppo (parametri rimossi) non sopravvivono al giro.
  const params = {}
  for (const p of action.params ?? []) {
    const v = raw.params?.[p.key]
    params[p.key] = v === undefined
      ? (typeof p.default === 'function' ? p.default() : structuredClone(p.default ?? null))
      : v
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('s'),
    action: raw.action,
    enabled: raw.enabled !== false,
    parallel: raw.parallel === true,
    delay: clampNum(raw.delay, 0, 600, 0),
    wait: WAIT_MODES.includes(raw.wait) ? raw.wait : (action.defaults?.wait ?? 'none'),
    duration: clampNum(raw.duration, 0, 600, action.defaults?.duration ?? 0),
    maxWait: clampNum(raw.maxWait, 0, 600, action.defaults?.maxWait ?? DEFAULT_MAX_WAIT),
    easing: typeof raw.easing === 'string' ? raw.easing : (action.defaults?.easing ?? 'linear'),
    params,
  }
}

function normalizeAnimation(raw) {
  if (!raw || typeof raw !== 'object') return null
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normalizeStep).filter(Boolean) : []
  const loopMode = ['none', 'forever', 'count'].includes(raw.loop?.mode) ? raw.loop.mode : 'none'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('anim'),
    label: typeof raw.label === 'string' && raw.label ? raw.label : 'Senza nome',
    hidden: raw.hidden === true,
    loop: {
      mode: loopMode,
      times: clampNum(raw.loop?.times, 1, 999, 1),
      // `from` è un indice di WAVE, non di step: è ciò su cui il runtime
      // cursorea, e dopo il filtro degli step disabilitati i due non
      // coincidono.
      from: clampNum(raw.loop?.from, 0, 999, 0),
    },
    restoreOnStop: raw.restoreOnStop !== false,
    startFrom: raw.startFrom === 'keep' ? 'keep' : 'reset',
    stopOnFinish: raw.stopOnFinish === true,
    // Validato dopo, in normalizeAnimations: qui l'elenco completo non c'è
    // ancora, e un prerequisito che punta a un id inesistente o a un ciclo
    // renderebbe l'animazione impossibile da lanciare per sempre.
    requires: typeof raw.requires === 'string' ? raw.requires : '',
    // ⚠️ Niente `interruptOn`: c'era una chiave così, mai letta da nessuno, che
    // prometteva "un input dell'utente interrompe la sequenza". È l'esatto
    // contrario della regola vigente — un'animazione non viene interrotta, si
    // sostituisce con un'altra o si esce da config_mode (vedi Hud.jsx e
    // KeyboardComposer.jsx). Un JSON che ancora la contiene la perde qui, senza
    // conseguenze.
    steps,
  }
}

/**
 * Rende utilizzabile qualunque cosa arrivi dal JSON o dalla textarea
 * dell'editor: riempie i default, scarta gli step con azioni sconosciute,
 * genera gli id mancanti. Accetta anche un array nudo, così incollare solo la
 * lista di animazioni nella vista JSON funziona.
 */
export function normalizeAnimations(raw) {
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []
  const seen = new Set()
  const normalized = []
  for (const item of items) {
    const anim = normalizeAnimation(item)
    if (!anim) continue
    // Gli id devono essere unici: sono la chiave di playAnimation() e dei chip
    // dell'HUD.
    while (seen.has(anim.id)) anim.id = uid('anim')
    seen.add(anim.id)
    normalized.push(anim)
  }
  sanitizeRequires(normalized)
  return { version: ANIMATIONS_VERSION, items: normalized }
}

/**
 * Ripulisce i prerequisiti di sequenza: un `requires` che punta a se stesso, a
 * un id inesistente o che chiude un ANELLO va tolto, altrimenti l'animazione
 * resta bloccata per sempre — nessuna delle due potrebbe mai essere eseguita
 * per prima. Si spezza l'arco che chiude il ciclo, non l'intera catena.
 */
function sanitizeRequires(items) {
  const byId = new Map(items.map((a) => [a.id, a]))
  for (const a of items) {
    if (!a.requires) continue
    if (a.requires === a.id || !byId.has(a.requires)) {
      a.requires = ''
      continue
    }
    const chain = new Set([a.id])
    let cur = byId.get(a.requires)
    while (cur) {
      if (chain.has(cur.id)) {
        console.warn('[anim] prerequisito ciclico rimosso da', a.id)
        a.requires = ''
        break
      }
      chain.add(cur.id)
      cur = cur.requires ? byId.get(cur.requires) : null
    }
  }
}

/**
 * Vero se `candidate` può fare da prerequisito ad `anim` senza chiudere un
 * ciclo — cioè se `anim` non è già, direttamente o no, un suo antenato. Serve
 * all'editor per non offrire nemmeno la scelta sbagliata.
 */
export function canRequire(items, animId, candidateId) {
  if (!candidateId || candidateId === animId) return false
  const byId = new Map((items ?? []).map((a) => [a.id, a]))
  let cur = byId.get(candidateId)
  const seen = new Set()
  while (cur) {
    if (cur.id === animId) return false
    if (seen.has(cur.id)) return false
    seen.add(cur.id)
    cur = cur.requires ? byId.get(cur.requires) : null
  }
  return true
}

/** La catena di prerequisiti che porta ad `anim`, dal primo anello a lei. */
export function requireChain(items, animId) {
  const byId = new Map((items ?? []).map((a) => [a.id, a]))
  const chain = []
  let cur = byId.get(animId)
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = cur.requires ? byId.get(cur.requires) : null
  }
  return chain
}

/**
 * Partiziona gli step ABILITATI in wave. Usato dal runtime al play e
 * dall'editor per rientrare visivamente le righe parallele: una sola
 * definizione, così non possono divergere.
 *
 * Il primo step abilitato apre sempre una wave a prescindere dal suo flag
 * `parallel` (non c'è nulla a cui accodarsi).
 */
export function buildWaves(animation) {
  const waves = []
  for (const step of animation?.steps ?? []) {
    if (step.enabled === false) continue
    if (step.parallel && waves.length > 0) waves[waves.length - 1].push(step)
    else waves.push([step])
  }
  return waves
}

/**
 * Stessa partizione, ma su TUTTI gli step, disabilitati compresi. È la vista
 * dell'editor — dove un gruppo di azioni sincronizzate è una scatola che si
 * apre e si chiude — e dell'inversione, che deve rimontare i gruppi al
 * contrario senza perdere per strada ciò che è momentaneamente spento.
 *
 * ⚠️ Non coincide sempre con `buildWaves`: se la capofila di un gruppo è
 * disabilitata, a runtime è il primo step abilitato che apre la wave. Per
 * questo il numero di wave mostrato su ogni scheda continua ad arrivare da
 * `buildWaves`, non da qui.
 */
export function buildStepGroups(steps = []) {
  const groups = []
  for (const step of steps) {
    if (step.parallel && groups.length > 0) groups[groups.length - 1].push(step)
    else groups.push([step])
  }
  return groups
}
