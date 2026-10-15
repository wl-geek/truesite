// zxing-wasm (zxing-cpp) QR detection in a module worker, on every device (iOS has no BarcodeDetector).
// The .wasm is bundled by Vite (?url) and served from our own origin; without locateFile,
// zxing-wasm would fetch it from the jsDelivr CDN at runtime.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { prepareZXingModule, purgeZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { QrRequest } from './protocol'
import { createQrHandler } from './qrHandler'
import { ZXING_OPTIONS } from './zxingOptions'

function prepare(): void {
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
}
prepare()

// A failed load (flaky network, stale asset after a redeploy) answers "no detection" with the error
// and is retried on the next frame, instead of leaving the request unanswered.
const handle = createQrHandler({
  read: (img) => readBarcodes(img, ZXING_OPTIONS),
  reset: () => {
    purgeZXingModule()
    prepare()
  },
})

self.onmessage = async (e: MessageEvent<QrRequest>) => {
  const res = await handle(e.data)
  self.postMessage(res, { transfer: [res.buffer] })
}
