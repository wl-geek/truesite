// The QR worker's message handler, kept free of worker globals so it can be tested in node.
import type { ReadResult } from 'zxing-wasm/reader'
import type { QrRequest, QrResponse } from './protocol'
import { toDetection } from './zxingOptions'

export type QrReader = {
  read: (img: ImageData) => Promise<readonly ReadResult[]>
  /** Drop the failed module and prepare it again (zxing-wasm caches a rejected load, so it never retries on its own). */
  reset: () => void
}

/**
 * Every request gets an answer, with the buffer handed back for transfer. A failed read answers
 * `detection: null` with the error and resets the reader, so the next frame retries the load.
 */
export function createQrHandler(reader: QrReader): (req: QrRequest) => Promise<QrResponse> {
  return async ({ id, width, height, buffer }) => {
    const t0 = performance.now()
    try {
      const results = await reader.read({ data: new Uint8ClampedArray(buffer), width, height, colorSpace: 'srgb' } as ImageData)
      return { id, ms: performance.now() - t0, detection: toDetection(results), buffer }
    } catch (e) {
      reader.reset()
      return { id, ms: performance.now() - t0, detection: null, buffer, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
