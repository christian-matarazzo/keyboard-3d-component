import { DEFAULT_FOCUS_GROUP } from '../state/defaults'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * Inquadratura autorata di un gruppo (pannello ?debug, modalità Focus).
 *
 * Il focus calcolato da solo (sfera che contiene il gruppo, vedi
 * focusFraming.js) è un default sicuro, non un'inquadratura di prodotto:
 * `radiusFactor` la stringe/allarga e `offsetX/Y/Z` spostano il centro
 * dell'orbita rispetto al baricentro geometrico. I valori si trovano a video
 * con la rotella (attiva solo in ?debug) e si salvano nel JSON globale.
 *
 * Un gruppo assente dalla sezione `focus` ricade semplicemente sul focus
 * calcolato: è il motivo per cui il default è l'identità (vedi
 * DEFAULT_FOCUS_GROUP).
 *
 * Stesso pattern per-gruppo di MaterialTuner: un COMPONENTE per gruppo, non una
 * `useControls` dentro un ciclo.
 */
function FocusGroupTuner({ store, group }) {
  useLevaSection(
    store,
    'focus',
    {
      radiusFactor: { value: DEFAULT_FOCUS_GROUP.radiusFactor, min: 0.1, max: 3, step: 0.01, label: 'distanza (×)' },
      offsetX: { value: DEFAULT_FOCUS_GROUP.offsetX, min: -2, max: 2, step: 0.01, label: 'offset X' },
      offsetY: { value: DEFAULT_FOCUS_GROUP.offsetY, min: -2, max: 2, step: 0.01, label: 'offset Y' },
      offsetZ: { value: DEFAULT_FOCUS_GROUP.offsetZ, min: -2, max: 2, step: 0.01, label: 'offset Z' },
    },
    {
      folder: `Focus · ${group.label.toLowerCase()}`,
      groupId: group.id,
      render: renderInMode('focus'),
    },
  )

  return null
}

export default function FocusTuner({ store, groups }) {
  return groups.map((group) => <FocusGroupTuner key={group.id} store={store} group={group} />)
}
