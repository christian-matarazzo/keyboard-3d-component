import { COMPOSER_SECTIONS } from '../state/composerStore'
import { normalizeAnimations } from '../animation/animationSchema'

/**
 * Il caricamento della configurazione autorata, in un posto solo.
 *
 * Stava dentro LightRig.jsx — milleduecento righe di editor luci — per un
 * motivo che non era architetturale ma di TEMPISTICA: il fetch dispatchava otto
 * `CustomEvent` su `window`, e un CustomEvent lanciato prima che l'ascoltatore
 * esista non viene mai recapitato né ripetuto. LightRig sta dentro il Canvas,
 * cioè dopo il Suspense del GLB: quando arrivava lì, tutti gli ascoltatori
 * erano montati. Era l'unico punto in cui il fetch "funzionava", e per questo
 * ci era rimasto.
 *
 * Con lo store quel vincolo sparisce: `hydrate` deposita i valori, e chi monta
 * dopo li trova già lì. Gli otto CustomEvent non esistono più, e con loro il
 * motivo per cui il caricamento doveva vivere in un posto scomodo.
 */

/**
 * Porta un file appena letto nella forma corrente.
 *
 * I JSON della primissima versione erano il solo dizionario delle luci indicizzato
 * per posa, senza sezioni: si riconoscono perché non hanno la chiave `lights`.
 * Continuano a caricarsi — è l'unica migrazione di formato che questo
 * componente si porta dietro, e costa una riga.
 */
export const normalizeConfig = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null
  const config = parsed.lights ? { ...parsed } : { lights: parsed }

  // Le animazioni si normalizzano all'INGRESSO, non a ogni lettura: lo schema
  // è cresciuto nel tempo (slug, `requires`, `loop`, `stopOnFinish`) e un file
  // salvato prima di una di queste aggiunte deve caricarsi comunque.
  if (config.animations) config.animations = normalizeAnimations(config.animations)

  // ⚠️ `variants.selection` viene SCARTATA, non migrata. Quale layout è acceso
  // è stato dell'utente (vive in sessionStorage): un layout di partenza scritto
  // nel file di configurazione significherebbe che ricaricare la configurazione
  // riporta l'utente su una scelta non sua. I JSON vecchi che la contengono
  // ancora restano validi, semplicemente quella chiave non viene letta.
  if (config.variants) config.variants = { swapAnimations: config.variants.swapAnimations ?? {} }

  return config
}

/**
 * Scarica la configurazione del prodotto attivo.
 *
 * @param {string} configUrl da `product.configUrl`
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Object|null>} la config normalizzata, o `null` se non c'è —
 *   un prodotto senza file autorato è legittimo, parte dai default.
 */
export const fetchProductConfig = async (configUrl, { signal } = {}) => {
  const res = await fetch(configUrl, { signal })
  if (!res.ok) throw new Error(`File di configurazione non trovato (${res.status})`)
  return normalizeConfig(await res.json())
}

/**
 * Applica una configurazione allo store. È l'unico punto di ingresso: lo usano
 * sia il fetch di produzione sia il "Carica JSON" del pannello di authoring,
 * che prima erano due blocchi identici riga per riga nello stesso file.
 *
 * @returns {boolean} false se non c'era nulla da applicare
 */
export const applyConfig = (store, parsed) => {
  const config = normalizeConfig(parsed)
  if (!config) return false
  store.hydrate(config)
  return true
}

/** Le sezioni note, riesportate per chi ispeziona un file prima di applicarlo. */
export { COMPOSER_SECTIONS }
