// jsQR vs zxing-wasm on identical synthetic frames: decode rate, corner error, time.
// zxing-wasm is loaded from the local .wasm file; fetch is stubbed so nothing hits the network.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader'
import { makeQrPng, type QrPng } from '../test-support/qrPng'
import { detectQr, type Pt } from './jsqrDetect'
import {
  degrade, dist, downsample2x, expectedCorners, homographyFromPose, mul3, renderQr, rotX, rotY,
  type DegradeOptions, type Intrinsics, type Mat3,
} from './synthQr'

const PAYLOAD = 'https://truesite-abcdefghij-as.a.run.app/a/room1/A1'
const SIZE_M = 0.12
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const deg = Math.PI / 180

const ZX: ReaderOptions = {
  formats: ['QRCode'],
  maxNumberOfSymbols: 1,
  tryHarder: true,
  tryInvert: false,
  tryRotate: false,
  tryDownscale: false,
}

interface Scenario {
  name: string
  R: Mat3
  /** distance (z) in metres */
  z: number
  degrade?: DegradeOptions
  /** render at 1280x960 then 2x area-downscale to 640x480 (the real pipeline) */
  viaDownscale?: boolean
}

const SCENARIOS: Scenario[] = [
  { name: 'clean frontal 120px', R: I3, z: 0.6 },
  { name: 'clean tilt X35 Y25 118px', R: mul3(rotY(25 * deg), rotX(35 * deg)), z: 0.6 },
  { name: 'clean frontal 60px', R: I3, z: 1.2 },
  { name: 'clean frontal 45px', R: I3, z: 1.6 },
  { name: 'noise15 frontal 120px', R: I3, z: 0.6, degrade: { noise: 15, seed: 11 } },
  { name: 'noise15 via 2x downscale', R: I3, z: 0.6, degrade: { noise: 15, seed: 11 }, viaDownscale: true },
  { name: 'noise30 via 2x downscale', R: I3, z: 0.6, degrade: { noise: 30, seed: 12 }, viaDownscale: true },
  { name: 'blur1+noise15 tilted via 2x', R: mul3(rotY(25 * deg), rotX(35 * deg)), z: 0.6, degrade: { blurRadius: 1, noise: 15, gradient: 0.6, seed: 5 }, viaDownscale: true },
  { name: 'blur2 frontal 120px', R: I3, z: 0.6, degrade: { blurRadius: 2, seed: 2 } },
  { name: 'blur2+noise10 via 2x', R: I3, z: 0.6, degrade: { blurRadius: 2, noise: 10, seed: 8 }, viaDownscale: true },
]

let qr: QrPng

beforeAll(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('network disabled in tests') })
  const require = createRequire(import.meta.url)
  const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm')
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasmPath).buffer as ArrayBuffer }, fireImmediately: true })
  qr = await makeQrPng(PAYLOAD, 'M')
})
afterAll(() => vi.unstubAllGlobals())

function frame(s: Scenario): { rgba: Uint8ClampedArray; truth: Pt[] } {
  const N = qr.modules.size
  if (s.viaDownscale) {
    const K2: Intrinsics = { fx: 1200, fy: 1200, cx: 640, cy: 480 }
    const Hm = homographyFromPose(K2, s.R, [0, 0, s.z], SIZE_M, N)
    let big = renderQr(qr.modules, Hm, 1280, 960, { supersample: 3 })
    if (s.degrade) big = degrade(big, 1280, 960, s.degrade)
    return { rgba: downsample2x(big, 1280, 960), truth: expectedCorners(Hm, N).map((p) => ({ x: p.x / 2, y: p.y / 2 })) }
  }
  const K: Intrinsics = { fx: 600, fy: 600, cx: 320, cy: 240 }
  const Hm = homographyFromPose(K, s.R, [0, 0, s.z], SIZE_M, N)
  let rgba = renderQr(qr.modules, Hm, 640, 480, { supersample: 4 })
  if (s.degrade) rgba = degrade(rgba, 640, 480, s.degrade)
  return { rgba, truth: expectedCorners(Hm, N) }
}

describe('jsQR vs zxing-wasm (640x480 frames)', () => {
  const rows: Record<string, string | number>[] = []

  for (const s of SCENARIOS) {
    it(s.name, async () => {
      const { rgba, truth } = frame(s)
      const t0 = performance.now()
      const j = detectQr(rgba, 640, 480, 'dontInvert')
      const tj = performance.now() - t0
      const t1 = performance.now()
      const z = await readBarcodes({ data: rgba, width: 640, height: 480, colorSpace: 'srgb' } as ImageData, ZX)
      const tz = performance.now() - t1
      const zr = z.find((r) => r.isValid)
      const jErr = j ? Math.max(...j.corners.map((p, i) => dist(p, truth[i]))) : NaN
      const zc = zr ? [zr.position.topLeft, zr.position.topRight, zr.position.bottomRight, zr.position.bottomLeft] : null
      const zErr = zc ? Math.max(...zc.map((p, i) => dist(p, truth[i]))) : NaN
      const zIntCoords = zc ? zc.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)) : null
      rows.push({
        scenario: s.name,
        jsqr: j ? 'ok' : 'FAIL', jsqrCornerMaxPx: +jErr.toFixed(2), jsqrMs: +tj.toFixed(1),
        zxing: zr ? 'ok' : 'FAIL', zxingCornerMaxPx: +zErr.toFixed(2), zxingMs: +tz.toFixed(1),
        zxingIntCorners: String(zIntCoords),
      })
      if (zr) expect(zr.text).toBe(PAYLOAD)
      if (j) expect(j.data).toBe(PAYLOAD)
    })
  }

  it('zxing-wasm corners follow the SYMBOL orientation (upside-down and 90deg codes)', async () => {
    for (const a of [90, 180, 270]) {
      const s: Scenario = { name: `rot${a}`, R: [Math.cos(a * deg), -Math.sin(a * deg), 0, Math.sin(a * deg), Math.cos(a * deg), 0, 0, 0, 1], z: 0.6 }
      const { rgba, truth } = frame(s)
      const [r] = await readBarcodes({ data: rgba, width: 640, height: 480, colorSpace: 'srgb' } as ImageData, ZX)
      const zc = [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft]
      zc.forEach((p, i) => expect(dist(p, truth[i])).toBeLessThan(1.5))
      expect(r.orientation).toBe(a === 270 ? -90 : a) // degrees, as reported by zxing-cpp
    }
  })

  it('summary', () => {
    console.table(rows)
    // Hard facts this file pins (from measured runs):
    const r = Object.fromEntries(rows.map((x) => [x.scenario, x]))
    expect(r['clean frontal 120px'].jsqr).toBe('ok')
    expect(r['clean frontal 120px'].zxing).toBe('ok')
    expect(r['noise15 frontal 120px'].jsqr).toBe('FAIL') // jsQR's 8x8 binariser turns flat-area noise into speckle
    expect(r['noise15 via 2x downscale'].jsqr).toBe('ok') // area downscaling rescues it
  })
})
