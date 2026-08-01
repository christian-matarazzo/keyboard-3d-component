import KeyboardComposer, { isDebug } from './components/KeyboardComposer'

// ⚠️ Il marchio vive QUI, non dentro il componente.
//
// Erano tre stringhe e un'URL cablate dentro Hud.jsx, e sembravano innocue
// finché il componente era l'applicazione. Da quando è un pacchetto
// installabile non lo sono più: un lockup del cliente e un "for internal use
// only" spediti a chiunque faccia `npm install` sono, nel migliore dei casi,
// peso morto. Il playground è il posto giusto per il playground.
const PLAYGROUND_BRANDING = {
  logoUrl: '/brand/Logo_System.svg',
  logoAlt: 'Dither — Array Keyboard Series, Model L',
  version: 'V 0.2 Configurator Playground',
  footer: ['IT - EU ©', 'For internal use only, do not share', 'Instruments of Becoming 2026©'],
}

export default function App() {
  // In `?debug` la superficie pubblica finisce su `window.__kb`: è la stessa
  // che riceverà l'e-commerce, quindi provarla dalla console qui significa
  // provare davvero ciò che si consegna — `__kb.animations()`,
  // `__kb.play('go-to-rotors')`, `__kb.subscribe(console.log)`.
  const onReady = isDebug() ? (api) => { window.__kb = api } : undefined

  // Vetrina a piena viewport. `hud` è spento di default nel componente (chi
  // integra disegna i propri pulsanti): qui lo si accende, perché questo È
  // l'ambiente di prova interno.
  return (
    <main
      style={{
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <KeyboardComposer hud branding={PLAYGROUND_BRANDING} onReady={onReady} />
    </main>
  )
}
