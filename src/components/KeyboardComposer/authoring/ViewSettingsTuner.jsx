import { useMemo } from 'react'
import { button } from 'leva'
import { DEFAULT_VIEW_SETTINGS } from '../state/defaults'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * "Impostazioni Globali Vista": margine della scatola di luci, velocità di
 * transizione e visibilità degli helper, tutti PER POSA.
 *
 * Era una `useControls` dentro LightRig.jsx, ed è stata l'ultima a uscire — la
 * più difficile, perché il rig legge quei valori a ogni frame e li specchia
 * dentro `lights[posa]`. Adesso il rig legge la sezione `view` dello store e
 * questo pannello è solo la manopola.
 *
 * ⚠️ "Resetta Vista" non azzera niente qui dentro: chiama `resetActiveView` sul
 * ponte imperativo. La config delle luci appartiene al rig, e un pannello che
 * la riscrivesse da fuori sarebbe un secondo proprietario.
 */
export default function ViewSettingsTuner({ store, apiRef }) {
  const schema = useMemo(
    () => ({
      showHelpers: { value: false, label: 'Mostra Punti' },
      showSurfaces: { value: false, label: 'Mostra Superfici' },
      // Max alzato da 3 a 12: con la scatola adattiva (che segue le mesh
      // traslate dall'editor) serve poter allontanare le luci molto più del
      // vecchio modello statico senza rimanere incastrati nel modello.
      margin: { value: DEFAULT_VIEW_SETTINGS.margin, min: 0, max: 12, step: 0.1, label: 'Margine Scatola' },

      // Velocità di transizione, anch'esse PER VISTA: il valore mostrato è
      // sempre quello della posa attiva.
      animMarginDamp: { value: DEFAULT_VIEW_SETTINGS.animMarginDamp, min: 0.01, max: 1, step: 0.01, label: 'Velocità Margine' },
      animLightOnDamp: { value: DEFAULT_VIEW_SETTINGS.animLightOnDamp, min: 0.01, max: 1, step: 0.01, label: 'Velocità Accensione' },
      animLightOffDamp: { value: DEFAULT_VIEW_SETTINGS.animLightOffDamp, min: 0.01, max: 1, step: 0.01, label: 'Velocità Spegnimento' },
      animColorDamp: { value: DEFAULT_VIEW_SETTINGS.animColorDamp, min: 0.01, max: 1, step: 0.01, label: 'Velocità Colore' },

      'Resetta Vista': button(() => {
        const pose = apiRef.current?.currentPoseKey?.()
        if (!window.confirm(`Vuoi azzerare le luci per la vista ${pose}?`)) return
        apiRef.current?.resetActiveView?.()
      }),
    }),
    [apiRef],
  )

  useLevaSection(store, 'view', schema, {
    folder: 'Impostazioni Globali Vista',
    render: renderInMode('lights'),
  })

  return null
}
