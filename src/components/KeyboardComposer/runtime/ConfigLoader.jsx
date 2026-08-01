import { useEffect } from 'react'
import { applyConfig, fetchProductConfig } from './productConfig'

/**
 * Scarica la configurazione autorata del prodotto e la deposita nello store.
 * Non rende nulla: è un effetto con un posto nell'albero, come
 * AnimationDirector.
 *
 * Sta nella shell, accanto allo store che popola, e parte al primo mount —
 * prima del Canvas e prima del GLB. Prima non era possibile: il caricamento
 * dispatchava CustomEvent, e un evento lanciato prima dei suoi ascoltatori è
 * perso per sempre, quindi doveva per forza vivere dentro il Canvas, dopo il
 * Suspense. Con lo store l'ordine non conta più: chi monta dopo legge ciò che
 * trova. È il guadagno concreto dell'intera migrazione.
 *
 * A differenza di prima il fetch avviene ANCHE in `?debug`: l'autore riparte dal
 * file reale invece che dai default dei pannelli, senza doverlo ricaricare a
 * mano a ogni sessione.
 */
export default function ConfigLoader({ store, product }) {
  const { configUrl } = product

  useEffect(() => {
    if (!store || !configUrl) return
    // Uno smontaggio a fetch in volo applicava la configurazione a una scena
    // già morta: nessun errore visibile, ma in StrictMode succede a ogni mount.
    const controller = new AbortController()

    fetchProductConfig(configUrl, { signal: controller.signal })
      .then((config) => {
        if (controller.signal.aborted) return
        applyConfig(store, config)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.warn(
          'Nessun JSON personalizzato trovato, applico i default di sistema:',
          err.message,
        )
      })

    return () => controller.abort()
  }, [store, configUrl])

  return null
}
