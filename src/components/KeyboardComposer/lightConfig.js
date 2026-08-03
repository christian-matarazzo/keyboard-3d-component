import { DEFAULT_VIEW_SETTINGS } from './state/defaults'

/**
 * LA FORMA di una configurazione di luci PER POSA — le tre funzioni che sanno
 * com'è fatto un `lights[posa]`, e nient'altro.
 *
 * Estratte da LightRig.jsx quando l'editor luci è uscito di lì
 * (authoring/LightEditor.jsx): da quel momento i due lati leggono e scrivono lo
 * STESSO dizionario — il rig lo consuma ogni frame, l'editor lo muta — e due
 * copie di queste funzioni sarebbero due idee diverse di cosa contiene una
 * posa. Due consumatori reali, quindi l'estrazione è dovuta e non preventiva.
 *
 * ⚠️ Le chiavi generate qui SONO le chiavi del JSON di configurazione
 * (`top_0_intensity`, `mid_3_color`, `surf_left_intensity`, …). Valgono le
 * stesse regole scritte in LightRig.jsx sopra `gridLayers`: non rinominare un
 * prefisso, non cambiare i conteggi (9 top / 8 mid / 9 bot) e non toccare
 * l'elenco delle sei facce. Qualunque di queste modifiche rimappa in silenzio
 * ogni configurazione già salvata su luci diverse — invisibile in review,
 * visibile solo sul prodotto renderizzato.
 */

/**
 * Le chiavi della cartella "Impostazioni Globali Vista". I default abitano in
 * state/defaults.js insieme a tutti gli altri: da lì leggono sia lo schema del
 * pannello sia `generateDefaultConfig`, così un default cambiato in un punto non
 * può divergere dall'altro (prima erano due elenchi paralleli da tenere
 * allineati a mano).
 *
 * ⚠️ Queste chiavi finiscono nel JSON dentro `lights[posa]`, accanto a
 * `top_0_intensity` & co.
 */
export const VIEW_SETTING_KEYS = Object.keys(DEFAULT_VIEW_SETTINGS)

/** Legge le impostazioni per vista da una config di posa, con i default per le chiavi assenti. */
export const readViewSettings = (config) => {
  const out = {}
  for (const k of VIEW_SETTING_KEYS) out[k] = config?.[k] ?? DEFAULT_VIEW_SETTINGS[k]
  return out
}

/** Una posa "spenta": tutte le luci a intensità 0, impostazioni vista ai default. */
export const generateDefaultConfig = () => {
  const def = { ...DEFAULT_VIEW_SETTINGS, showHelpers: true, showSurfaces: true }
  for (let i = 0; i < 9; i++) { def[`top_${i}_intensity`] = 0; def[`top_${i}_color`] = '#ffffff'; def[`top_${i}_decay`] = 2 }
  for (let i = 0; i < 8; i++) { def[`mid_${i}_intensity`] = 0; def[`mid_${i}_color`] = '#ffffff'; def[`mid_${i}_decay`] = 2 }
  for (let i = 0; i < 9; i++) { def[`bot_${i}_intensity`] = 0; def[`bot_${i}_color`] = '#ffffff'; def[`bot_${i}_decay`] = 2 }

  const surfaces = ['top', 'bot', 'left', 'right', 'front', 'back']
  surfaces.forEach((s) => {
    def[`surf_${s}_intensity`] = 0
    def[`surf_${s}_color`] = '#ffffff'
  })

  return def
}
