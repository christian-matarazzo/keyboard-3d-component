import { useEffect } from 'react'

/**
 * Escape: la via d'uscita da una sessione di configurazione.
 *
 * Viveva dentro `Hud.jsx`, e non poteva restarci: l'HUD è un overlay
 * OPZIONALE — un e-commerce disegna i propri pulsanti e non lo monta — mentre
 * l'uscita da `config` non è opzionale affatto. Senza, chi non monta l'HUD
 * lascia l'utente dentro una modalità in cui drag e frecce sono spenti e
 * l'unico modo di uscire è un pulsante che potrebbe non aver disegnato.
 *
 * La scala è a tre gradini, dal più interno al più esterno: se sta girando
 * un'animazione si esce dalla modalità (che è anche il suo smontaggio morbido);
 * altrimenti si molla prima lo zoom sul gruppo inquadrato; e solo quando non
 * c'è più niente di annidato si esce.
 *
 * ⚠️ L'ascoltatore sta su `window` e non sul canvas: il focus si attiva
 * cliccando un pulsante, che porta via il fuoco dal canvas — un listener sul
 * canvas non riceverebbe mai il tasto subito dopo il click.
 *
 * @param {boolean} [enabled] `false` lo disattiva, per chi vuole gestire da sé
 *   la tastiera.
 */
export function useEscapeToIdle({ apiRef, appMode, onAppModeChange, enabled = true }) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      const api = apiRef.current
      if (api?.currentAnimation?.()) {
        if (appMode === 'config') onAppModeChange?.('idle')
      } else if (api?.currentFocus?.()) api.clearFocus?.()
      else if (appMode === 'config') onAppModeChange?.('idle')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [apiRef, appMode, onAppModeChange, enabled])
}
