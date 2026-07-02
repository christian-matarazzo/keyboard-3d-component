import KeyboardComposer from './components/KeyboardComposer'

export default function App() {
  return (
    <main style={{ minHeight: '100vh', padding: '48px clamp(16px, 5vw, 80px)' }}>
      <h1
        style={{
          fontSize: 'clamp(32px, 5vw, 56px)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          margin: '0 0 40px',
        }}
      >
        Guardala da vicino.
      </h1>
      <KeyboardComposer />
    </main>
  )
}
