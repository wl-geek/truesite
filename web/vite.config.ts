/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect } from 'vite'

// AR Quick Look needs .usdz served as model/vnd.usdz+zip; Vite's static server leaves the type empty.
const usdzMime: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url?.split('?')[0].endsWith('.usdz')) {
    const type = 'model/vnd.usdz+zip'
    const setHeader = res.setHeader.bind(res)
    res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === 'content-type' ? type : value)
    // sirv passes its headers to writeHead directly
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => typeof res
    res.writeHead = ((code: number, ...rest: unknown[]) => {
      for (const h of rest) {
        if (h && typeof h === 'object' && !Array.isArray(h)) {
          for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-type') delete (h as Record<string, unknown>)[k]
        }
      }
      setHeader('Content-Type', type)
      return writeHead(code, ...rest)
    }) as typeof res.writeHead
  }
  next()
}

// `npm run dev`        -> http://localhost:5173 (desktop; the camera works on localhost)
// `npm run dev:https`  -> https://<lan-ip>:5173 with a self-signed certificate, for phones on the LAN
//                         (getUserMedia needs a secure context; accept the certificate warning once)
// Both proxy /api to the FastAPI dev server on 127.0.0.1:8000, so the page and the API share one origin.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'https' ? [basicSsl()] : []),
    { name: 'usdz-mime', configureServer: (server) => void server.middlewares.use(usdzMime), configurePreviewServer: (server) => void server.middlewares.use(usdzMime) },
  ],
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
