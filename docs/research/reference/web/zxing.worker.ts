// Alternative detector: zxing-wasm (zxing-cpp) in a module worker.
// The .wasm is bundled by Vite (?url) so it is served from our own origin.
// Without prepareZXingModule + locateFile, zxing-wasm fetches the wasm from the jsDelivr CDN at runtime.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'
import type { QrDetection } from './jsqrDetect'
import type { QrRequest, QrResponse } from './protocol'

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
})

const OPTS: ReaderOptions = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryInvert: false,
  tryRotate: false,
  tryDownscale: false,
}

self.onmessage = async (e: MessageEvent<QrRequest>) => {
  const { id, width, height, buffer } = e.data
  const t0 = performance.now()
  let detection: QrDetection | null = null
  const results = await readBarcodes({ data: new Uint8ClampedArray(buffer), width, height } as ImageData, OPTS)
  const r = results.find((x) => x.isValid)
  if (r) {
    const version = parseInt(r.version, 10)
    const N = 17 + 4 * version
    const p = r.position
    // zxing-cpp returns INTEGER outer-corner coordinates in symbol order (verified in tests)
    detection = {
      data: r.text,
      version,
      dimension: N,
      corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft],
      points: [
        { module: { x: 0, y: 0 }, image: p.topLeft },
        { module: { x: N, y: 0 }, image: p.topRight },
        { module: { x: N, y: N }, image: p.bottomRight },
        { module: { x: 0, y: N }, image: p.bottomLeft },
      ],
    }
  }
  const res: QrResponse = { id, ms: performance.now() - t0, detection, buffer }
  self.postMessage(res, { transfer: [buffer] })
}
