import type { ReadResult, ReaderOptions } from 'zxing-wasm/reader'
import type { QrDetection } from './protocol'

/** Measured on 11 Oct: fast and robust on 640 px frames; corners come back in symbol order. */
export const ZXING_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryInvert: false,
  tryRotate: false,
  tryDownscale: false,
}

/** The first valid zxing result as a QrDetection, or null. */
export function toDetection(results: readonly ReadResult[]): QrDetection | null {
  const r = results.find((x) => x.isValid)
  if (!r) return null
  const version = parseInt(r.version, 10)
  const p = r.position
  return {
    text: r.text,
    corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft],
    version,
    dimension: 17 + 4 * version,
  }
}
