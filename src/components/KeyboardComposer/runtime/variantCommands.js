import { BUILTIN_VARIANT_SWAP_ID } from '../animation/animationSchema'

/**
 * Come si cambia layout. Una funzione pura, e prima viveva dentro `Hud.jsx`.
 *
 * Non era un dettaglio di presentazione finito nel posto sbagliato: era
 * l'UNICO punto del codice che sapesse la regola, cioè che lo scambio passa
 * SEMPRE da un'animazione e mai da uno scatto. Finché stava lì, un integratore
 * che non montasse l'HUD non aveva alcun modo di cambiare variante
 * correttamente — poteva solo chiamare `setVariant`, cioè lo scatto secco che
 * la regola esclude.
 *
 * L'ordine di preferenza è: animazione AUTORATA per quella variante (binding
 * nell'editor) → animazione INTEGRATA (`BUILTIN_VARIANT_SWAP_ID`, un incrocio
 * morbido in dissolvenza) → scatto secco come sola rete di sicurezza, per
 * quando il runtime non c'è ancora o l'id non si risolve.
 */

/** L'opzione successiva nel giro, o null se non c'è niente da cambiare. */
export const nextVariantOption = (variant, selection) => {
  const options = variant?.options ?? []
  if (options.length < 2) return null
  // `Math.max(i, 0)`: una selezione irriconoscibile (non dovrebbe capitare,
  // `normalizeVariantSelection` la garantisce) si legge come la prima opzione
  // sia qui sia nel render, così il titolo "Passa a …" non promette qualcosa di
  // diverso da ciò che il clic fa.
  const i = options.findIndex((o) => o.id === selection?.[variant.id])
  const next = options[(Math.max(i, 0) + 1) % options.length]
  return !next || next.id === selection?.[variant.id] ? null : next
}

/**
 * Porta una variante alla sua prossima opzione.
 *
 * @param {Object} api il ponte imperativo (`poseApi.current`)
 * @param {Object} variant la variante dal prodotto attivo
 * @param {Object} selection selezione corrente `{ [variantId]: optionId }`
 * @param {Object} animations `{ items }` autorate, per validare il binding
 * @returns {boolean} false se non c'era nulla da cambiare
 */
export const cycleVariant = (api, variant, selection, animations) => {
  const next = nextVariantOption(variant, selection)
  if (!api || !next) return false

  const authored = api.variantSwapAnimation?.(variant.id)
  const animId =
    authored && (animations?.items ?? []).some((a) => a.id === authored)
      ? authored
      : BUILTIN_VARIANT_SWAP_ID

  // L'intento va passato al runtime: lo step `setVariant` lascia vuoti variante
  // e opzione e li prende da qui, così UNA sola animazione copre tutti i versi
  // (ISO→ANSI e ANSI→ISO) — ed è ciò che rende generica quella integrata.
  const played = api.playAnimation?.(animId, { variantTarget: { [variant.id]: next.id } })
  if (!played) api.setVariant?.(variant.id, next.id)
  return true
}
