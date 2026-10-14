// Module Web Worker running jsQR off the main thread.
// Created with: new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' })
import { detectQr } from './jsqrDetect'
import type { QrRequest, QrResponse } from './protocol'

self.onmessage = (e: MessageEvent<QrRequest>) => {
  const { id, width, height, buffer } = e.data
  const t0 = performance.now()
  const detection = detectQr(new Uint8ClampedArray(buffer), width, height, 'dontInvert')
  const res: QrResponse = { id, ms: performance.now() - t0, detection, buffer }
  // DOM lib types `self` as Window; the (message, { transfer }) overload exists on both.
  self.postMessage(res, { transfer: [buffer] })
}
