// Node-only helpers: make a real QR PNG with `qrcode`, decode it with `pngjs`.
import { PNG } from 'pngjs'
import QRCode from 'qrcode'
import type { ModuleMatrix } from '../qr/synthQr'

export interface QrPng {
  png: Buffer
  version: number
  modules: ModuleMatrix
}

/**
 * Generate a QR as a PNG at 1 px per module with no margin, then read the
 * module matrix back out of the decoded PNG (so the test really draws "the PNG").
 */
export async function makeQrPng(text: string, ecl: 'L' | 'M' | 'Q' | 'H' = 'M'): Promise<QrPng> {
  const png = await QRCode.toBuffer(text, { errorCorrectionLevel: ecl, margin: 0, scale: 1, type: 'png' })
  const img = PNG.sync.read(png)
  if (img.width !== img.height) throw new Error('QR PNG not square')
  const N = img.width
  const dark = new Uint8Array(N * N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) dark[y * N + x] = img.data[(y * N + x) * 4] < 128 ? 1 : 0
  const version = (N - 17) / 4
  // cross-check against the library's own matrix
  const ref = QRCode.create(text, { errorCorrectionLevel: ecl })
  if (ref.version !== version || ref.modules.size !== N) throw new Error('PNG/matrix size mismatch')
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (!!ref.modules.get(y, x) !== !!dark[y * N + x]) throw new Error(`module mismatch at ${x},${y}`)
  return { png, version, modules: { size: N, dark: (x, y) => dark[y * N + x] === 1 } }
}

export function writeGreyPng(path: string, rgba: Uint8ClampedArray, width: number, height: number, write: (p: string, b: Buffer) => void) {
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  write(path, PNG.sync.write(png))
}
