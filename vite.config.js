import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Il launcher della preview assegna la porta via env PORT; 5174 è il
    // fallback per l'avvio manuale.
    port: Number(process.env.PORT) || 5174,
  },
})
