// zxing-wasm (zxing-cpp) QR detection in a module worker, on every device (iOS has no BarcodeDetector).
// The .wasm is bundled by Vite (?url) and served from our own origin; without locateFile,
// zxing-wasm would fetch it from the jsDelivr CDN at runtime.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { QrRequest, QrResponse } from './protocol'
import { ZXING_OPTIONS, toDetection } from './zxingOptions'

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
})

self.onmessage = async (e: MessageEvent<QrRequest>) => {
  const { id, width, height, buffer } = e.data
  const t0 = performance.now()
  const results = await readBarcodes({ data: new Uint8ClampedArray(buffer), width, height, colorSpace: 'srgb' } as ImageData, ZXING_OPTIONS)
  const res: QrResponse = { id, ms: performance.now() - t0, detection: toDetection(results), buffer }
  self.postMessage(res, { transfer: [buffer] })
}
