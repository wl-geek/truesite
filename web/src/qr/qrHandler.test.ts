// The QR worker's message handler: it always answers, and a failed load is retried on the next frame.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareZXingModule, purgeZXingModule, readBarcodes, type ReadResult } from 'zxing-wasm/reader'
import { makeQrPng } from '../test-support/qrPng'
import { homographyFromPose, renderQr } from './synthQr'
import { createQrHandler } from './qrHandler'
import type { QrRequest } from './protocol'
import { ZXING_OPTIONS } from './zxingOptions'

const PAYLOAD = 'https://truesite.test/a/room1/A1'

function request(id: number, rgba = new Uint8ClampedArray(64 * 48 * 4).fill(255), width = 64, height = 48): QrRequest {
  return { id, width, height, buffer: rgba.buffer as ArrayBuffer }
}

const VALID = {
  isValid: true, text: PAYLOAD, version: '2',
  position: { topLeft: { x: 1, y: 1 }, topRight: { x: 9, y: 1 }, bottomRight: { x: 9, y: 9 }, bottomLeft: { x: 1, y: 9 } },
} as unknown as ReadResult

describe('createQrHandler', () => {
  it('answers a failed read with detection null and the error, resets the reader, and decodes the next frame', async () => {
    let fail = true
    const reset = vi.fn()
    const handle = createQrHandler({
      read: async () => {
        if (fail) throw new Error('failed to fetch zxing_reader.wasm')
        return [VALID]
      },
      reset,
    })
    const req = request(7)
    const first = await handle(req)
    expect(first.id).toBe(7)
    expect(first.detection).toBeNull()
    expect(first.error).toMatch(/zxing_reader\.wasm/)
    expect(first.buffer).toBe(req.buffer) // handed back so it can be transferred
    expect(reset).toHaveBeenCalledTimes(1)

    fail = false
    const second = await handle(request(8))
    expect(second.error).toBeUndefined()
    expect(second.detection?.text).toBe(PAYLOAD)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe('zxing-wasm after a failed load (real module)', () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'))
  let networkUp = false
  // One overrides object for the whole test, like the worker's locateFile: only the "network" changes.
  const overrides = {
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      if (!networkUp) throw new Error('failed to fetch zxing_reader.wasm')
      void WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module))
      return {}
    },
  }
  const prepare = () => prepareZXingModule({ overrides: overrides as never })
  const read = (img: ImageData) => readBarcodes(img, ZXING_OPTIONS)
  let frame: Uint8ClampedArray
  const image = () => ({ data: frame.slice(), width: 640, height: 480, colorSpace: 'srgb' }) as ImageData

  beforeAll(async () => {
    vi.stubGlobal('fetch', () => { throw new Error('network disabled in tests') })
    const qr = await makeQrPng(PAYLOAD, 'M')
    const H = homographyFromPose({ fx: 600, fy: 600, cx: 320, cy: 240 }, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0.6], 0.12, qr.modules.size)
    frame = renderQr(qr.modules, H, 640, 480, { supersample: 2 })
  })
  afterAll(() => {
    purgeZXingModule()
    vi.unstubAllGlobals()
  })

  it('keeps the rejected load cached, so the handler must purge and prepare again to recover', async () => {
    prepare()
    await expect(read(image())).rejects.toThrow()
    networkUp = true
    // Without a reset the library answers from the cached rejection, even though the load would now work.
    await expect(read(image())).rejects.toThrow()

    networkUp = false
    const handle = createQrHandler({ read, reset: () => { purgeZXingModule(); prepare() } })
    const failed = await handle(request(1, frame.slice(), 640, 480))
    expect(failed.detection).toBeNull()
    expect(failed.error).toBeTruthy()
    networkUp = true
    const ok = await handle(request(2, frame.slice(), 640, 480))
    expect(ok.error).toBeUndefined()
    expect(ok.detection?.text).toBe(PAYLOAD)
  })
})
