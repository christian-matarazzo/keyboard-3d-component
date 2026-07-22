import KeyboardComposer from './components/KeyboardComposer'

export default function App() {
  // Vetrina a piena viewport: l'HUD di prodotto (logo, telemetria, paginazione,
  // footer) vive dentro KeyboardComposer, sopra il canvas. Niente intestazione.
  return (
    <main
      style={{
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <KeyboardComposer />
    </main>
  )
}
