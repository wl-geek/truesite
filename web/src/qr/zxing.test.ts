// zxing-wasm in node on synthetic QR frames with exactly known corners (the worker's decode path).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { makeQrPng, type QrPng } from '../test-support/qrPng'
import { dist, expectedCorners, homographyFromPose, mul3, renderQr, rotX, rotY, type Mat3 } from '../test-support/synthQr'
import { parseAnchorLink } from './link'
import { ZXING_OPTIONS, toDetection } from './zxingOptions'

const PAYLOAD = 'https://truesite-abcdefghij-as.a.run.app/a/room1/D1'
const deg = Math.PI / 180
let qr: QrPng

beforeAll(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('network disabled in tests') })
  const wasmPath = createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm')
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasmPath).buffer as ArrayBuffer }, fireImmediately: true })
  qr = await makeQrPng(PAYLOAD, 'M')
})
afterAll(() => vi.unstubAllGlobals())

async function detect(R: Mat3, z: number) {
  const N = qr.modules.size
  const H = homographyFromPose({ fx: 600, fy: 600, cx: 320, cy: 240 }, R, [0, 0, z], 0.12, N)
  const rgba = renderQr(qr.modules, H, 640, 480, { supersample: 4 })
  const results = await readBarcodes({ data: rgba, width: 640, height: 480, colorSpace: 'srgb' } as ImageData, ZXING_OPTIONS)
  return { det: toDetection(results), truth: expectedCorners(H, N), N }
}

describe('zxing QR detection', () => {
  it('decodes our anchor link with corners within 1.5 px, frontal and tilted', async () => {
    for (const R of [[1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, mul3(rotY(25 * deg), rotX(35 * deg))]) {
      const { det, truth, N } = await detect(R, 0.6)
      expect(det).not.toBeNull()
      expect(det!.text).toBe(PAYLOAD)
      expect(det!.dimension).toBe(N)
      det!.corners.forEach((p, i) => expect(dist(p, truth[i])).toBeLessThan(1.5))
      expect(parseAnchorLink(det!.text, 'http://localhost')).toEqual({ projectId: 'room1', anchorId: 'D1' })
    }
  })

  it('reports corners in SYMBOL order for an upside-down code (desk mode from the other side)', async () => {
    const R: Mat3 = [-1, 0, 0, 0, -1, 0, 0, 0, 1]
    const { det, truth } = await detect(R, 0.6)
    det!.corners.forEach((p, i) => expect(dist(p, truth[i])).toBeLessThan(1.5))
    expect(det!.corners[0].y).toBeGreaterThan(det!.corners[2].y) // TL is now at the bottom of the image
  })

  it('returns null when there is no code', async () => {
    const blank = new Uint8ClampedArray(640 * 480 * 4).fill(255)
    expect(toDetection(await readBarcodes({ data: blank, width: 640, height: 480, colorSpace: 'srgb' } as ImageData, ZXING_OPTIONS))).toBeNull()
  })
})
