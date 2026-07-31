/**
 * VARIANTI DI MODELLO — insiemi di mesh alternative fra cui l'utente finale
 * sceglie (layout ISO/ANSI oggi, in futuro il rialzo o altro). Qui c'è solo la
 * MACCHINA: gli elenchi sono dati di prodotto e vivono in `products/`
 * (`products/arrayModelL/meshVariants.js` per il primo modello).
 *
 * Stessa forma e stesse regole di `meshGroups.js`, ed è deliberato: un elenco
 * dichiarativo, classificazione per SOTTOSTRINGA del nome nodo, e la lista
 * passata attraverso tutto l'albero dentro `product`, così un GLB diverso
 * descrive le proprie varianti senza toccare nessun consumatore.
 *
 * ⚠️ `variants` non ha un default: ricadere sulle varianti di ARRAY_MODEL_L
 * significherebbe, con più prodotti, cercare mesh ISO/ANSI in un modello che
 * non ne ha — silenziosamente, perché nessun match non è un errore.
 *
 * ⚠️ Le mesh nascoste vengono marcate `userData.__variantHidden = true`, ed è
 * quel tag — non `.visible` — che il resto del componente deve controllare per
 * saltarle (`collectMeshGroups`, `measureModelBox` del LightRig). Un tag
 * esplicito, come `__editorHelper`, invece di `.visible`: `.visible` può essere
 * spento da chiunque per motivi loro, il tag dice *perché*.
 */

/**
 * @typedef {Object} MeshVariantOption
 * @property {string} id
 * @property {string} label
 * @property {string[]} nameTokens - substring dei nomi nodo di questa opzione
 *
 * @typedef {Object} MeshVariant
 * @property {string} id - chiave stabile: la usano la selezione utente
 *   (sessionStorage), i binding di swap nel JSON e lo step `setVariant`.
 * @property {string} label
 * @property {string} [defaultOption] - opzione accesa senza nulla di salvato
 * @property {string|null} [swapAnimation] - id dell'animazione di scambio
 * @property {MeshVariantOption[]} options
 */

const matches = (name, tokens) => (tokens ?? []).some((t) => name.includes(t))

/**
 * Tutte le mesh di ogni opzione di ogni variante.
 * @returns {{ [variantId]: { [optionId]: THREE.Mesh[] } }}
 */
export function collectVariantMeshes(scene, variants) {
  const out = {}
  for (const v of variants) {
    out[v.id] = {}
    for (const o of v.options) out[v.id][o.id] = []
  }
  if (!scene) return out
  scene.traverse((obj) => {
    if (!obj.isMesh || obj.userData?.__editorHelper) return
    for (const v of variants) {
      for (const o of v.options) {
        if (matches(obj.name, o.nameTokens)) out[v.id][o.id].push(obj)
      }
    }
  })
  return out
}

/** Riempie i buchi di una selezione parziale con i default dichiarati. */
export function normalizeVariantSelection(raw, variants) {
  const out = {}
  for (const v of variants) {
    const wanted = raw?.[v.id]
    out[v.id] = v.options.some((o) => o.id === wanted)
      ? wanted
      : v.defaultOption ?? v.options[0]?.id ?? null
  }
  return out
}

/**
 * Accende le mesh dell'opzione scelta e spegne le altre.
 *
 * `holds` è l'insieme delle varianti in TRANSIZIONE: per quelle non si tocca
 * nulla, perché è l'animazione di swap a possedere temporaneamente la
 * visibilità (durante un incrocio in dissolvenza entrambe le opzioni devono
 * restare visibili). Senza questa deroga, il commit della scelta spegnerebbe
 * la mesh uscente nello stesso istante in cui inizia a sfumare.
 */
export function applyVariantVisibility(
  scene,
  variants,
  selection = {},
  holds = null,
) {
  if (!scene) return
  const byVariant = collectVariantMeshes(scene, variants)
  for (const v of variants) {
    if (holds?.has(v.id)) continue
    const chosen = selection[v.id]
    for (const o of v.options) {
      const on = o.id === chosen
      for (const mesh of byVariant[v.id][o.id]) {
        mesh.visible = on
        mesh.userData.__variantHidden = !on
      }
    }
  }
}

/** Mesh di una singola opzione — usata dall'azione di swap. */
export function variantOptionMeshes(scene, variants, variantId, optionId) {
  return collectVariantMeshes(scene, variants)?.[variantId]?.[optionId] ?? []
}

/** Rende visibili delle mesh senza toccare la selezione (durante il crossfade). */
export function forceVariantVisible(meshes, visible) {
  for (const mesh of meshes) {
    mesh.visible = visible
    mesh.userData.__variantHidden = !visible
  }
}
