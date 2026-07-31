/**
 * Varianti di ARRAY_MODEL_L — insiemi di mesh alternative fra cui l'utente
 * finale sceglie (layout ISO/ANSI oggi, in futuro il rialzo o altro). DATI:
 * la macchina che li applica sta in `materials/meshVariants.js`.
 *
 * ⚠️ Nel GLB attuale le quattro mesh `S05_{L,R}_{ISO,ANSI}` esistono tutte e
 * quattro e finora venivano disegnate INSIEME, compenetrandosi. Applicare una
 * selezione non è quindi solo una feature: è ciò che rende il modello corretto.
 *
 * @type {import('../../materials/meshVariants').MeshVariant[]}
 */
export const ARRAY_MODEL_L_MESH_VARIANTS = [
  {
    id: 'layout',
    label: 'Layout',
    // Opzione mostrata quando non c'è nulla di salvato né di autorato.
    defaultOption: 'iso',
    // Id di un'animazione (facoltativo, autorabile): se presente il comando di
    // layout dell'HUD lancia QUESTA. Se manca non si scambia di scatto — si
    // gioca l'animazione integrata (`BUILTIN_VARIANT_SWAP_ID` in
    // animation/animationSchema.js), un incrocio morbido in dissolvenza. Vedi
    // Hud.jsx.
    swapAnimation: null,
    options: [
      { id: 'iso', label: 'ISO', nameTokens: ['S05_L_ISO', 'S05_R_ISO'] },
      { id: 'ansi', label: 'ANSI', nameTokens: ['S05_L_ANSI', 'S05_R_ANSI'] },
    ],
  },
]
