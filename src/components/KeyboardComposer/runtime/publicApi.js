import { cycleVariant, nextVariantOption } from './variantCommands'

/**
 * La superficie che vede chi INTEGRA il componente.
 *
 * Non è `poseApi` con un altro nome. `poseApi` è il ponte INTERNO fra sette
 * scrittori che vivono in alberi React diversi: ventitré chiavi, di cui metà
 * sono dettagli del sequencer (`meshCatalog`, `isPoseSettled`,
 * `resetAnimationProgress`) o dell'authoring (`saveConfigJSON`). Esporlo così
 * com'è significherebbe promettere di non cambiarlo mai.
 *
 * Qui ci sono dodici metodi, e tre decisioni che valgono più dei metodi:
 *
 * 1. ⚠️ `play()` ENTRA DA SÉ IN CONFIG. È la trappola più insidiosa
 *    dell'integrazione e non va lasciata al chiamante: lanciare un'animazione
 *    restando in `idle` mette due scrittori sugli stessi target di posa e zoom
 *    (le gesture dell'utente e il sequencer), e il risultato è un movimento che
 *    "a volte non parte". Il cambio di modalità avviene qui dentro, e il play
 *    parte sul frame DOPO — nello stesso tick, `changeAppMode` sta ancora
 *    riportando la scena alla posa home.
 *
 * 2. IL GATE DELLE SEQUENZE VIVE QUI. Il runtime resta permissivo di proposito
 *    (l'editor deve poter provare qualunque cosa mentre la si autora); è la
 *    superficie di prodotto a rifiutare un'animazione il cui prerequisito non è
 *    stato soddisfatto. Prima quel controllo era ricalcolato a mano dentro
 *    l'HUD, quindi spariva insieme all'HUD.
 *
 * 3. SI CITA PER SLUG. `play('go-to-rotors')`, non `play('anim_ms5z8skh8hv8s')`.
 *    Gli id sono generati da un timestamp: leggibili da nessuno e diversi se
 *    l'animazione viene ricreata. Gli id restano accettati, perché le relazioni
 *    interne (`requires`, `idleAnimation`) li usano.
 */

const EMPTY = []

/**
 * @param {Object} deps.apiRef il ponte imperativo interno
 * @param {() => Object} deps.getAnimations `{ items }` autorate
 * @param {() => Array} deps.getVariants le varianti del prodotto attivo
 * @param {() => Object} deps.getPoseGraph il grafo delle pose
 */
export function createPublicApi({ apiRef, getAnimations, getVariants, getPoseGraph }) {
  const api = () => apiRef.current ?? {}
  const items = () => getAnimations()?.items ?? EMPTY

  const resolve = (key) =>
    items().find((a) => a.id === key) ?? items().find((a) => a.slug === key) ?? null

  return {
    // --- Modalità ---------------------------------------------------------
    /** `'idle'` si gira a mano · `'config'` si comanda dai pulsanti. */
    mode: () => api().appMode?.() ?? 'idle',
    enterConfig: () => api().setAppMode?.('config'),
    /** Rientro a riposo: passa dall'animazione autorata di idle, se c'è. */
    exitConfig: () => api().setAppMode?.('idle'),

    // --- Animazioni -------------------------------------------------------
    /**
     * Il catalogo su cui costruire i pulsanti. `locked` dice se il
     * prerequisito è ancora da soddisfare ADESSO: va riletto dopo ogni evento.
     */
    animations: () =>
      items()
        .filter((a) => !a.hidden)
        .map((a) => ({
          slug: a.slug,
          label: a.label,
          requires: a.requires || null,
          locked: !!a.requires && !(api().animationUnlocked?.(a.id) ?? true),
        })),

    /**
     * @param {string} key slug (consigliato) o id
     * @param {{ force?: boolean }} [opts] `force` scavalca il gate dei
     *   prerequisiti — serve a un'anteprima, non a un pulsante di prodotto.
     * @returns {boolean} false se l'animazione non esiste o è bloccata
     */
    play: (key, opts = {}) => {
      const anim = resolve(key)
      if (!anim) return false
      if (!opts.force && anim.requires && !(api().animationUnlocked?.(anim.id) ?? true)) return false

      if ((api().appMode?.() ?? 'idle') !== 'config') {
        api().setAppMode?.('config')
        // ⚠️ Il frame dopo, non questo: `changeAppMode` ha appena lanciato un
        // `goTo(home)` e la molla della camera è in movimento. Partire adesso
        // significherebbe scriverle sopra a metà corsa.
        requestAnimationFrame(() => api().playAnimation?.(anim.id, opts))
        return true
      }
      return api().playAnimation?.(anim.id, opts) ?? false
    },

    stop: () => api().stopAnimation?.(),

    /**
     * Stato istantaneo del sequencer: `{ state, slug, label, waveIndex,
     * waveCount, waitingTrigger, … }`. Per reagire ai cambiamenti conviene
     * `subscribe`, che non ha latenza di polling.
     */
    state: () => api().animationState?.() ?? null,

    /** Sblocca uno step in attesa (`waitTrigger`). */
    trigger: (name) => api().triggerAnimation?.(name),

    /**
     * @param {(event: { type: 'start'|'finish'|'stop', id, slug, label }) => void} fn
     * @returns {() => void} disiscrizione
     */
    subscribe: (fn) => api().subscribeAnimation?.(fn) ?? (() => {}),

    // --- Varianti ---------------------------------------------------------
    /** `[{ id, label, options, selected }]` per costruire i selettori. */
    variants: () => {
      const selection = api().currentVariants?.() ?? {}
      return (getVariants() ?? EMPTY).map((v) => ({
        id: v.id,
        label: v.label,
        options: (v.options ?? []).map((o) => ({ id: o.id, label: o.label })),
        selected: selection[v.id] ?? null,
        next: nextVariantOption(v, selection)?.id ?? null,
      }))
    },

    /**
     * Passa all'opzione successiva CON la transizione autorata. È questo, non
     * `setVariant`, il comando da mettere su un pulsante.
     */
    cycleVariant: (variantId) => {
      const variant = (getVariants() ?? EMPTY).find((v) => v.id === variantId)
      if (!variant) return false
      return cycleVariant(api(), variant, api().currentVariants?.() ?? {}, getAnimations())
    },

    /** Scatto secco a un'opzione precisa, senza transizione. */
    setVariant: (variantId, optionId) => api().setVariant?.(variantId, optionId),

    // --- Navigazione ------------------------------------------------------
    /** `[{ key, label }]` — le pose del grafo del prodotto attivo. */
    poses: () => {
      const graph = getPoseGraph()
      return (graph?.keys ?? EMPTY).map((key) => ({ key, label: graph.label(key) }))
    },
    goTo: (poseKey) => api().goTo?.(poseKey),
    currentPose: () => api().currentPoseKey?.() ?? null,
    /** Inquadra un gruppo di mesh (zoom + spostamento del pivot). */
    focus: (groupId) => api().focusGroup?.(groupId) ?? false,
    clearFocus: () => api().clearFocus?.(),
  }
}
