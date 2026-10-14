// Verifies jsQR's returned geometry against synthetic images with exactly known geometry.
// A real QR PNG (qrcode pkg) is decoded (pngjs) and projected through a pinhole camera
// with a known pose; jsQR's corners / finder centres are compared with the truth.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeQrPng, writeGreyPng, type QrPng } from '../test-support/qrPng'
import { detectQr } from './jsqrDetect'
import {
  applyH, dist, expectedCorners, homographyFromPose, mul3, renderQr, rotX, rotY, rotZ,
  type Intrinsics, type Mat3,
} from './synthQr'

const W = 640
const H = 480
const K: Intrinsics = { fx: 600, fy: 600, cx: W / 2, cy: H / 2 } // ~56 deg HFOV at 640 px
const SIZE_M = 0.12 // printed code side, metres (A4 judge sheet in the spec)
const PAYLOAD = 'https://truesite-abcdefghij-as.a.run.app/a/room1/A1'
const OUT = process.env.QR_TEST_OUT // set to a directory to dump the rendered PNGs

const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const deg = Math.PI / 180

interface Case {
  name: string
  R: Mat3
  t: [number, number, number]
  /** max allowed corner error, px (set from measured values with margin) */
  tolCorner: number
}

const CASES: Case[] = [
  { name: 'frontal 120px', R: I3, t: [0, 0, 0.6], tolCorner: 1.5 },
  { name: 'frontal 240px', R: I3, t: [0, 0, 0.3], tolCorner: 1.5 },
  { name: 'frontal 72px', R: I3, t: [0, 0, 1.0], tolCorner: 1.5 },
  { name: 'in-plane 30deg', R: rotZ(30 * deg), t: [0.02, 0.01, 0.6], tolCorner: 1.5 },
  { name: 'in-plane 90deg', R: rotZ(90 * deg), t: [0, 0, 0.6], tolCorner: 1.5 },
  { name: 'upside down 180deg', R: rotZ(180 * deg), t: [0, 0, 0.6], tolCorner: 1.5 },
  { name: 'tilt 40deg about X', R: rotX(40 * deg), t: [0, 0, 0.55], tolCorner: 1.5 },
  { name: 'tilt X35 Y25 Z15 off-centre', R: mul3(rotZ(15 * deg), mul3(rotY(25 * deg), rotX(35 * deg))), t: [0.05, -0.03, 0.6], tolCorner: 1.5 },
  { name: 'tilt 55deg about Y, 90px', R: rotY(55 * deg), t: [0, 0, 0.7], tolCorner: 1.5 },
]

let qr: QrPng

beforeAll(async () => {
  qr = await makeQrPng(PAYLOAD, 'M')
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, 'qr-1px-per-module.png'), qr.png)
  }
})

describe('qrcode payload sizing (spec section 6: short payload, ECL M)', () => {
  it('reports QR version/modules for candidate payloads', () => {
    const rows = [
      PAYLOAD,
      PAYLOAD.toUpperCase(), // alphanumeric mode if the app routes paths case-insensitively
      'https://truesite-123456789012.asia-southeast1.run.app/a/room1/A1',
      'https://truesite-123456789012.asia-southeast1.run.app/a/room1/A1'.toUpperCase(),
    ].map((p) => {
      const c = QRCode.create(p, { errorCorrectionLevel: 'M' })
      return { chars: p.length, version: c.version, modules: c.modules.size, mode: c.segments.map((s) => s.mode.id).join('+'), payload: p }
    })
    console.table(rows)
    expect(rows[0].version).toBeGreaterThanOrEqual(2) // version 1 has no alignment pattern
  })
})

describe('jsQR geometry on synthetic projections', () => {
  const summary: Record<string, string | number>[] = []

  for (const c of CASES) {
    it(c.name, () => {
      const N = qr.modules.size
      const Hm = homographyFromPose(K, c.R, c.t, SIZE_M, N)
      const rgba = renderQr(qr.modules, Hm, W, H, { supersample: 4 })
      if (OUT) writeGreyPng(join(OUT, c.name.replace(/\W+/g, '_') + '.png'), rgba, W, H, writeFileSync)

      const det = detectQr(rgba, W, H, 'dontInvert')
      expect(det, 'jsQR found the code').not.toBeNull()
      if (!det) return
      expect(det.data).toBe(PAYLOAD)
      expect(det.dimension).toBe(N)

      const truth = expectedCorners(Hm, N)
      const cornerErr = det.corners.map((p, i) => dist(p, truth[i]))
      const pointErr = det.points.map((pc) => dist(pc.image, applyH(Hm, pc.module.x, pc.module.y)))
      // also test the "pixel-centre" hypothesis: are jsQR coords offset by half a pixel?
      const halfShift = det.corners.map((p, i) => dist({ x: p.x + 0.5, y: p.y + 0.5 }, truth[i]))
      const widthPx = dist(truth[0], truth[1])
      summary.push({
        case: c.name,
        codePx: +widthPx.toFixed(0),
        cornerMax: +Math.max(...cornerErr).toFixed(2),
        cornerMean: +(cornerErr.reduce((a, b) => a + b, 0) / 4).toFixed(2),
        cornerMaxIfShifted: +Math.max(...halfShift).toFixed(2),
        pointsMax: +Math.max(...pointErr).toFixed(2),
        alignFound: det.points.length === 4 ? 'yes' : 'no',
      })
      // Symbol order is the code's own orientation, regardless of image rotation.
      expect(Math.max(...cornerErr)).toBeLessThan(c.tolCorner)
    })
  }

  it('prints the error table', () => {
    console.table(summary)
    expect(summary.length).toBe(CASES.length)
  })
})

describe('jsQR API behaviours', () => {
  it('upside-down code: topLeftCorner lands near the image bottom-right', () => {
    const N = qr.modules.size
    const Hm = homographyFromPose(K, rotZ(180 * deg), [0, 0, 0.6], SIZE_M, N)
    const det = detectQr(renderQr(qr.modules, Hm, W, H), W, H)!
    expect(det.corners[0].x).toBeGreaterThan(W / 2)
    expect(det.corners[0].y).toBeGreaterThan(H / 2)
  })

  it('white-on-black code needs inversion: dontInvert fails, attemptBoth succeeds', () => {
    const N = qr.modules.size
    const Hm = homographyFromPose(K, I3, [0, 0, 0.6], SIZE_M, N)
    const inv = renderQr(qr.modules, Hm, W, H, { ink: 235, paper: 20, background: 100 })
    expect(detectQr(inv, W, H, 'dontInvert')).toBeNull()
    expect(detectQr(inv, W, H, 'attemptBoth')?.data).toBe(PAYLOAD)
  })

  it('GOTCHA: jsQR 1.4.0 options leak into later calls (shared mutable defaults)', () => {
    const N = qr.modules.size
    const Hm = homographyFromPose(K, I3, [0, 0, 0.6], SIZE_M, N)
    const inv = renderQr(qr.modules, Hm, W, H, { ink: 235, paper: 20, background: 100 })
    // fresh call with explicit attemptBoth works...
    expect(jsQR(inv, W, H, { inversionAttempts: 'attemptBoth' })).not.toBeNull()
    // ...set dontInvert once...
    jsQR(inv, W, H, { inversionAttempts: 'dontInvert' })
    // ...and a later call that omits options silently keeps 'dontInvert' (documented default is attemptBoth)
    expect(jsQR(inv, W, H)).toBeNull()
    jsQR(inv, W, H, { inversionAttempts: 'attemptBoth' }) // restore
  })

  it('timing: one 640x480 frame (node, this machine)', () => {
    const N = qr.modules.size
    const Hm = homographyFromPose(K, rotX(30 * deg), [0, 0, 0.6], SIZE_M, N)
    const rgba = renderQr(qr.modules, Hm, W, H, { supersample: 2 })
    const empty = new Uint8ClampedArray(W * H * 4).fill(128)
    const time = (f: () => void, n = 20) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n }
    const found = time(() => detectQr(rgba, W, H, 'dontInvert'))
    const notFoundDont = time(() => detectQr(empty, W, H, 'dontInvert'))
    const notFoundBoth = time(() => detectQr(empty, W, H, 'attemptBoth'))
    console.log(`jsQR ms/frame 640x480: found=${found.toFixed(1)} notFound(dontInvert)=${notFoundDont.toFixed(1)} notFound(attemptBoth)=${notFoundBoth.toFixed(1)}`)
    expect(found).toBeLessThan(100)
  })
})
