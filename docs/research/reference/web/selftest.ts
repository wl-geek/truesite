// In-browser self-test (open the app with ?selftest). Verifies, in a real browser:
//  1. both QR module workers load from the production build and decode synthetic frames
//  2. corner accuracy + per-frame time in the worker
//  3. BarcodeDetector availability, corner order/orientation (if present)
//  4. WebGL render-target ID buffer: exact bytes with setRGB(linear), drift with setHex, bottom-up rows
import QRCode from 'qrcode'
import {
  Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, UnsignedByteType, WebGLRenderer, WebGLRenderTarget, Color,
} from 'three'
import type { Pt } from '../qr/jsqrDetect'
import { QrWorkerClient, type DetectorKind } from '../qr/qrClient'
import { dist, expectedCorners, homographyFromPose, mul3, renderQr, rotX, rotY, rotZ, type Mat3, type ModuleMatrix } from '../qr/synthQr'
import { decodeId, idColor } from '../scene/elements'

const PAYLOAD = 'https://truesite-abcdefghij-as.a.run.app/a/room1/A1'
const W = 640, H = 480
const K = { fx: 600, fy: 600, cx: 320, cy: 240 }
const deg = Math.PI / 180
const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

interface DetectedBarcodeLike { rawValue: string; cornerPoints: Pt[]; boundingBox: DOMRectReadOnly; format: string }
interface BarcodeDetectorLike { detect(src: ImageBitmapSource): Promise<DetectedBarcodeLike[]> }
interface BarcodeDetectorCtor {
  new (opts?: { formats: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}

function modules(): ModuleMatrix {
  const q = QRCode.create(PAYLOAD, { errorCorrectionLevel: 'M' })
  return { size: q.modules.size, dark: (x, y) => !!q.modules.get(y, x) }
}

const POSES: { name: string; R: Mat3; z: number }[] = [
  { name: 'frontal', R: I3, z: 0.6 },
  { name: 'tilted', R: mul3(rotY(25 * deg), rotX(35 * deg)), z: 0.6 },
  { name: 'upside-down', R: rotZ(180 * deg), z: 0.6 },
  { name: 'rot90', R: rotZ(90 * deg), z: 0.6 },
]

function frames(mods: ModuleMatrix) {
  return POSES.map((p) => {
    const Hm = homographyFromPose(K, p.R, [0, 0, p.z], 0.12, mods.size)
    return { name: p.name, rgba: renderQr(mods, Hm, W, H, { supersample: 3 }), truth: expectedCorners(Hm, mods.size) }
  })
}

async function testWorker(kind: DetectorKind, fr: ReturnType<typeof frames>) {
  const client = new QrWorkerClient(kind)
  const out: Record<string, unknown> = {}
  try {
    for (const f of fr) {
      const res = await client.detect(new ImageData(new Uint8ClampedArray(f.rgba), W, H))
      const d = res.detection
      out[f.name] = d ? { ok: d.data === PAYLOAD, cornerMaxPx: +Math.max(...d.corners.map((c, i) => dist(c, f.truth[i]))).toFixed(2), ms: +res.ms.toFixed(1) } : { ok: false, ms: +res.ms.toFixed(1) }
    }
    const times: number[] = []
    for (let i = 0; i < 30; i++) times.push((await client.detect(new ImageData(new Uint8ClampedArray(fr[1].rgba), W, H))).ms)
    times.sort((a, b) => a - b)
    out.medianMsTilted640 = +times[15].toFixed(1)
  } catch (e) {
    out.error = String(e)
  } finally {
    client.terminate()
  }
  return out
}

async function testBarcodeDetector(fr: ReturnType<typeof frames>) {
  const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!BD) return { available: false }
  const out: Record<string, unknown> = { available: true }
  try {
    const formats = await BD.getSupportedFormats()
    out.formats = formats
    if (!formats.includes('qr_code')) return out
    const det = new BD({ formats: ['qr_code'] })
    for (const f of fr) {
      const t0 = performance.now()
      const [r] = await det.detect(new ImageData(new Uint8ClampedArray(f.rgba), W, H))
      const ms = performance.now() - t0
      if (!r) { out[f.name] = { ok: false, ms: +ms.toFixed(1) }; continue }
      // error if cornerPoints[i] corresponds to symbol corner i (TL,TR,BR,BL of the SYMBOL)
      const symbolOrderErr = Math.max(...r.cornerPoints.map((c, i) => dist(c, f.truth[i])))
      // best cyclic shift (if the browser reports image-relative order instead)
      const shifts = [0, 1, 2, 3].map((s) => Math.max(...r.cornerPoints.map((c, i) => dist(c, f.truth[(i + s) % 4]))))
      out[f.name] = { ok: r.rawValue === PAYLOAD, symbolOrderErrPx: +symbolOrderErr.toFixed(2), bestShift: shifts.indexOf(Math.min(...shifts)), bestShiftErrPx: +Math.min(...shifts).toFixed(2), corners: r.cornerPoints, ms: +ms.toFixed(1) }
    }
  } catch (e) {
    out.error = String(e)
  }
  return out
}

function testIdBuffer() {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, antialias: false })
  const size = 64
  const rt = new WebGLRenderTarget(size, size, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: true, samples: 0 })
  const scene = new Scene()
  scene.background = new Color(0, 0, 0)
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
  cam.position.z = 5
  const mk = (color: Color, x: number, y: number, w: number, h: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color }))
    m.position.set(x, y, 0)
    scene.add(m)
  }
  // top-left quadrant: element 4 via idColor (linear setRGB); bottom-right quadrant: setHex(0x000080)
  mk(idColor(4), -0.5, 0.5, 1, 1)
  mk(new Color().setHex(0x000080), 0.5, -0.5, 1, 1)
  renderer.setRenderTarget(rt)
  renderer.render(scene, cam)
  renderer.setRenderTarget(null)
  const buf = new Uint8Array(size * size * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf)
  const px = (x: number, row: number) => Array.from(buf.slice((row * size + x) * 4, (row * size + x) * 4 + 4))
  const topLeftImage = px(8, size - 1 - 8) // image row 8 (top) == GL row 55
  const bottomRightImage = px(size - 8, 8) // image bottom == GL row 8
  const glRow0Left = px(8, 8) // GL row 8 at left = image bottom-left: background
  const out = {
    idPixelBytes: topLeftImage,
    idDecoded: decodeId(topLeftImage[0], topLeftImage[1], topLeftImage[2]),
    idExact: decodeId(topLeftImage[0], topLeftImage[1], topLeftImage[2]) === 4,
    setHexBytes: bottomRightImage,
    setHexDrifted: bottomRightImage[2] !== 0x80,
    imageBottomLeftIsBackground: glRow0Left.slice(0, 3).every((v) => v === 0),
    readRenderTargetPixelsAsync: typeof (renderer as unknown as { readRenderTargetPixelsAsync?: unknown }).readRenderTargetPixelsAsync === 'function',
    webgl2: renderer.capabilities.isWebGL2,
  }
  rt.dispose()
  renderer.dispose()
  return out
}

export async function runSelfTest(): Promise<Record<string, unknown>> {
  const mods = modules()
  const fr = frames(mods)
  return {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    qrVersion: (mods.size - 17) / 4,
    jsqrWorker: await testWorker('jsqr', fr),
    zxingWorker: await testWorker('zxing', fr),
    barcodeDetector: await testBarcodeDetector(fr),
    idBuffer: testIdBuffer(),
  }
}
