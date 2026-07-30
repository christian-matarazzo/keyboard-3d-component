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
  return { version: ANIMATIONS_VERSION, items: normalized }
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
