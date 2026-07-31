import { collectMeshGroups } from '../materials/meshGroups'

/**
 * Selettore di mesh condiviso da ogni azione che tocca la geometria o i
 * materiali (opacità, spin, offset).
 *
 * Quattro forme, tutte serializzabili:
 *   { kind: 'all' }
 *   { kind: 'group',     groupId: 'rotors' }
 *   { kind: 'allExcept', groupIds: ['rotors'] }
 *   { kind: 'meshes',    names: ['L_ARRAY_Rotor_01', …] }
 *
 * ⚠️ `kind: 'meshes'` risolve per NOME DI NODO, mai per `uuid`: three rigenera
 * gli uuid a ogni parse del GLTF, quindi un uuid salvato nel JSON punta al
 * nulla al caricamento successivo. Conseguenza accettata: i nomi nel GLB
 * possono ripetersi, e un nome seleziona TUTTE le mesh che lo portano —
 * l'editor mostra le label dedup di `collectMeshList` ma salva il nome grezzo.
 *
 * Tutto passa da `collectMeshGroups`, così l'esclusione delle mesh
 * `__editorHelper` (gli halo di selezione) e la classificazione per gruppo
 * arrivano gratis e restano coerenti col resto del componente.
 */

export const SELECTOR_KINDS = ['all', 'group', 'allExcept', 'meshes']

export function resolveSelector(scene, groups, selector) {
  if (!scene || !selector || !groups) return []
  const byGroup = collectMeshGroups(scene, groups)

  switch (selector.kind) {
    case 'all':
      return groups.flatMap((g) => byGroup[g.id] ?? [])

    case 'group':
      return byGroup[selector.groupId] ?? []

    case 'allExcept': {
      const excluded = new Set(selector.groupIds ?? [])
      return groups.filter((g) => !excluded.has(g.id)).flatMap((g) => byGroup[g.id] ?? [])
    }

    case 'meshes': {
      const wanted = new Set(selector.names ?? [])
      if (wanted.size === 0) return []
      // Si passa comunque dai gruppi (e non da un traverse diretto) per non
      // raccogliere gli helper dell'editor, che sono figli di mesh reali.
      return groups.flatMap((g) => (byGroup[g.id] ?? []).filter((m) => wanted.has(m.name)))
    }

    default:
      return []
  }
}

/** Etichetta leggibile di un selettore, per l'editor e i log del runtime. */
export function describeSelector(selector, groups = []) {
  const label = (id) => groups.find((g) => g.id === id)?.label ?? id
  switch (selector?.kind) {
    case 'all': return 'tutto'
    case 'group': return label(selector.groupId)
    case 'allExcept': return `tutto tranne ${(selector.groupIds ?? []).map(label).join(', ') || '—'}`
    case 'meshes': return `${(selector.names ?? []).length} mesh`
    default: return '—'
  }
}
