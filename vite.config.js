import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * UN SORGENTE, DUE ARTEFATTI.
 *
 *   vite build              → la SPA del playground (dist/), con editor e HUD
 *   vite build --mode lib   → il pacchetto npm (dist/lib/), senza i peer
 *
 * Non sono due progetti né due workspace: è lo stesso albero letto da due
 * punti d'ingresso diversi. Il confine fra ciò che pesa in produzione e ciò
 * che resta interno non lo decide questa configurazione ma il dynamic import di
 * `authoring/` (vedi src/components/KeyboardComposer/authoring/index.jsx) —
 * qui si decide solo cosa NON impacchettare.
 */

// ⚠️ Devono restare ESTERNI, non impacchettati.
//
// `three` in due copie non è un problema di peso ma di correttezza: due moduli
// distinti significano due `RectAreaLightUniformsLib.init()` e `instanceof` che
// falliscono fra drei e questo componente. La scena si spegne in modi che non
// somigliano affatto a un conflitto di versioni, ed è la ragione per cui erano
// dependencies e ora sono peerDependencies.
//
// `leva` è esterna E opzionale: serve solo a chi accende l'authoring. Chi
// installa il pacchetto per il solo configuratore non la installa affatto, e il
// chunk che la importa non viene mai caricato.
const EXTERNAL = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'leva',
]

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [react()],
    server: {
      // Il launcher della preview assegna la porta via env PORT; 5174 è il
      // fallback per l'avvio manuale.
      port: Number(process.env.PORT) || 5174,
    },
    // ⚠️ Nella build di libreria `public/` NON va copiata dentro l'output.
    // Vite lo farebbe di default, ed è giusto per una SPA; per un pacchetto
    // significa spedire GLB, JSON e — soprattutto — i FONT DEL CLIENTE dentro
    // `dist/lib`, cioè gli stessi file già inclusi da `files` in package.json,
    // due volte, con in più un font su licenza che non deve viaggiare affatto.
    publicDir: isLib ? false : 'public',
    build: isLib
      ? {
          outDir: 'dist/lib',
          emptyOutDir: true,
          lib: {
            entry: 'src/components/KeyboardComposer/index.js',
            formats: ['es'],
            fileName: () => 'keyboard-composer.js',
            cssFileName: 'keyboard-composer',
          },
          rollupOptions: {
            // Anche i sottopercorsi (`three/examples/jsm/...`): senza, una
            // parte di three verrebbe impacchettata comunque.
            external: (id) => EXTERNAL.some((p) => id === p || id.startsWith(`${p}/`)),
          },
        }
      : {
          rollupOptions: {
            output: {
              // three e drei cambiano raramente, il codice del componente
              // spesso: separarli non riduce il totale ma rende cacheabile la
              // parte grossa fra un deploy e l'altro.
              manualChunks: (id) =>
                id.includes('node_modules/three') || id.includes('node_modules/@react-three')
                  ? 'three'
                  : undefined,
            },
          },
        },
  }
})
