import KeyboardComposer from './components/KeyboardComposer'

export default function App() {
  return (
    <main
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(24px, 4vw, 44px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          margin: 0,
          padding: '20px clamp(16px, 4vw, 48px)',
          flex: 'none',
        }}
      >
        Guarda il tuo gaba prendere vita.
      </h1>
      {/* Full view: il canvas occupa tutta la viewport rimanente. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <KeyboardComposer />
      </div>
    </main>
  )
}
