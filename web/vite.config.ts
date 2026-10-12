/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev`        -> http://localhost:5173 (desktop; the camera works on localhost)
// `npm run dev:https`  -> https://<lan-ip>:5173 with a self-signed certificate, for phones on the LAN
//                         (getUserMedia needs a secure context; accept the certificate warning once)
// Both proxy /api to the FastAPI dev server on 127.0.0.1:8000, so the page and the API share one origin.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true, // listen on 0.0.0.0 so phones on the LAN can reach it
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    chunkSizeWarningLimit: 1200, // three.js + React are ~860 kB raw / ~230 kB gzip in one chunk
  },
  worker: {
    format: 'es', // module workers: new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
}))
