/**
 * Helpers for live-ar.e2e.ts: the synthetic camera videos' ground truth (made by live-ar-videos.py), the expected
 * overlay silhouette for a known camera pose, the overlay mask read back from a screenshot, the motion events
 * that match a camera pose, and small page helpers.
 *
 * Frames and conventions (web/src/pose/camera.ts, modelMatrix.ts, scene/motion.ts):
 *  - world: IFC metres, Z up (site); for D1 the desk: origin at the code centre, x page right, y page up, z up;
 *  - camera poses in the manifest: c (camera centre, world) and R (camera -> world, row-major, OpenCV axes:
 *    x right, y down, z forward);
 *  - video pixels: pixel-edge convention, K = (f, cx, cy) in video px; the <video> fills the canvas with
 *    object-fit: cover, so a video pixel (u, v) shows at (ox + s u, oy + s v) in CSS px.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import type { Page } from '@playwright/test'

export type V3 = [number, number, number]
/** 3x3, row-major. */
export type M3 = number[]
export type P2 = [number, number]

export type CamPose = { c: V3; R: M3 }
export type SheetTruth = { C: V3; ex: V3; ey: V3; ez: V3; qrMm: number; modules: number | null }
export type VideoSpec = {
  file: string
  scene: 'site' | 'desk'
  frames: number
  anchor: string
  payload: string | null
  leanDeg: number
  cams: CamPose[]
  codeVisible: boolean[]
  sheet: SheetTruth | null
  turn?: { startFrame: number; frames: number; yawDeg: number; pitchDeg: number }
}
export type Manifest = {
  width: number
  height: number
  fps: number
  K: { f: number; cx: number; cy: number }
  hfovDeg: number
  stamp: { bits: number; px: number }
  baseUrl: string
  videos: Record<string, VideoSpec>
}

export type Anchor = { anchor_id: string; project_id: string; qr_size_m: number; position_m: V3; normal: V3; up: V3; scale: number }
export type Element = { guid: string; ifc_class: string; name: string; bbox_m: [V3, V3]; props?: Record<string, unknown> }

export function loadManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, 'live-ar-videos.json'), 'utf8')) as Manifest
}

// --- small linear algebra -------------------------------------------------------------------------------------
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(...a))
export const T3 = (a: M3): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
export const cols = (x: V3, y: V3, z: V3): M3 => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]
export function mul3(a: M3, b: M3): M3 {
  const r = new Array<number>(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}
export const mulV = (a: M3, v: V3): V3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
]
const rad = Math.PI / 180
const Rz = (deg: number): M3 => { const c = Math.cos(deg * rad), s = Math.sin(deg * rad); return [c, -s, 0, s, c, 0, 0, 0, 1] }
const Rx = (deg: number): M3 => { const c = Math.cos(deg * rad), s = Math.sin(deg * rad); return [1, 0, 0, 0, c, -s, 0, s, c] }
const Ry = (deg: number): M3 => { const c = Math.cos(deg * rad), s = Math.sin(deg * rad); return [c, 0, s, 0, 1, 0, -s, 0, c] }
export function rotationAngleDeg(a: M3, b: M3): number {
  const m = mul3(T3(a), b)
  return Math.acos(Math.min(1, Math.max(-1, (m[0] + m[4] + m[8] - 1) / 2))) / rad
}

/** Marker axes in model coordinates (columns x, y, z), as web/src/pose/modelMatrix.ts markerAxesInModel. */
export function markerAxes(a: Anchor): M3 {
  const z = unit(a.normal)
  const y = unit(sub(a.up, scale(z, dot(a.up, z))))
  return cols(cross(y, z), y, z)
}

/**
 * Model (IFC) -> world, for the model rigidly attached to `sheet` as the app assumes (the sheet IS the anchor).
 * With sheet = null the model stands where it belongs (site: IFC = world), which is the truth.
 */
export function modelToWorld(anchor: Anchor, sheet: SheetTruth | null): (p: V3) => V3 {
  if (!sheet) return (p) => p
  const A = mul3(cols(sheet.ex, sheet.ey, sheet.ez), T3(markerAxes(anchor))).map((v) => v * anchor.scale)
  return (p) => add(sheet.C, mulV(A, sub(p, anchor.position_m)))
}

/** The motion-event angles (degrees) the app turns back into this camera's rotation, for a screen angle. */
export function orientationFor(R: M3, screenAngleDeg: number): { alpha: number; beta: number; gamma: number } {
  // screen -> world: screen x = camera x, screen y = -camera y, screen z = -camera z (scene/motion.ts C_FROM_DEVICE)
  const Ds = [R[0], -R[1], -R[2], R[3], -R[4], -R[5], R[6], -R[7], -R[8]]
  // The app builds D = Rz(alpha) Rx(beta) Ry(gamma) Rz(-screen) and uses it as screen -> world.
  const M = mul3(Ds, Rz(screenAngleDeg))
  const beta = Math.asin(Math.max(-1, Math.min(1, M[7]))) / rad
  const gamma = Math.atan2(-M[6], M[8]) / rad
  let alpha = Math.atan2(-M[1], M[4]) / rad
  if (alpha < 0) alpha += 360
  const back = mul3(mul3(mul3(Rz(alpha), Rx(beta)), Ry(gamma)), Rz(-screenAngleDeg))
  if (back.some((v, i) => Math.abs(v - Ds[i]) > 1e-9)) throw new Error('orientationFor: decomposition failed (gimbal lock?)')
  return { alpha, beta, gamma }
}

/** A camera pose turned by `rollDeg` about its viewing axis (what a wrong or rolled gravity sensor reports). */
export function rolled(R: M3, rollDeg: number): M3 {
  return mul3(R, Rz(rollDeg))
}

// --- expected silhouette --------------------------------------------------------------------------------------
export type View = { K: { f: number; cx: number; cy: number }; videoW: number; videoH: number; viewW: number; viewH: number }

export function coverFit(v: View): { s: number; ox: number; oy: number } {
  const s = Math.max(v.viewW / v.videoW, v.viewH / v.videoH)
  return { s, ox: (v.viewW - v.videoW * s) / 2, oy: (v.viewH - v.videoH * s) / 2 }
}

/** World point -> CSS px on the canvas (null when behind the camera). */
export function projectToView(v: View, cam: CamPose, pw: V3, near = 0.02): P2 | null {
  const x = mulV(T3(cam.R), sub(pw, cam.c))
  if (x[2] <= near) return null
  const { s, ox, oy } = coverFit(v)
  return [ox + s * (v.K.f * (x[0] / x[2]) + v.K.cx), oy + s * (v.K.f * (x[1] / x[2]) + v.K.cy)]
}

function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const crossZ = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: P2[] = []
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: P2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** The element's bounding box, clipped in front of the camera, projected: its convex hull in CSS px (or null). */
export function elementHull(v: View, cam: CamPose, toWorld: (p: V3) => V3, bbox: [V3, V3], near = 0.05): P2[] | null {
  const [lo, hi] = bbox
  const corners: V3[] = []
  for (let i = 0; i < 8; i++) {
    const p: V3 = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]
    corners.push(mulV(T3(cam.R), sub(toWorld(p), cam.c)))
  }
  const pts: V3[] = corners.filter((x) => x[2] >= near)
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue
      const a = corners[i], b = corners[i | bit]
      if ((a[2] - near) * (b[2] - near) < 0) {
        const t = (near - a[2]) / (b[2] - a[2])
        pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), near])
      }
    }
  }
  if (pts.length < 3) return null
  const { s, ox, oy } = coverFit(v)
  const hull = convexHull(pts.map((x) => [ox + s * (v.K.f * (x[0] / x[2]) + v.K.cx), oy + s * (v.K.f * (x[1] / x[2]) + v.K.cy)] as P2))
  return hull.length >= 3 ? hull : null
}

/** Fill a convex polygon into a w x h mask (pixel centres at +0.5), shifted by `pad` px on both axes. */
export function fillConvex(mask: Uint8Array, w: number, h: number, poly: P2[], pad = 0): void {
  let minY = Infinity, maxY = -Infinity
  for (const p of poly) { minY = Math.min(minY, p[1] + pad); maxY = Math.max(maxY, p[1] + pad) }
  const y0 = Math.max(0, Math.ceil(minY - 0.5)), y1 = Math.min(h - 1, Math.floor(maxY - 0.5))
  const n = poly.length
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5 - pad
    let xl = Infinity, xr = -Infinity
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        const x = a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
        xl = Math.min(xl, x)
        xr = Math.max(xr, x)
      }
    }
    if (!(xl <= xr)) continue
    const x0 = Math.max(0, Math.ceil(xl + pad - 0.5)), x1 = Math.min(w - 1, Math.floor(xr + pad - 0.5))
    for (let x = x0; x <= x1; x++) mask[y * w + x] = 1
  }
}

/** Box-like concrete elements: their bounding box is their silhouette, so they must be drawn (recall). */
export function isSolid(e: Element): boolean {
  return /^Ifc(Column|Beam|Slab|Footing)$/.test(e.ifc_class) && String(e.props?.Material ?? '').startsWith('Concrete')
}

export type Expected = { w: number; h: number; pad: number; all: Uint8Array; solid: Uint8Array }

/** Expected silhouettes on a canvas padded by `pad` px all round (so shifted comparisons keep what falls outside). */
export function expectedMasks(v: View, cam: CamPose, toWorld: (p: V3) => V3, elements: Element[], pad = 64): Expected {
  const w = Math.round(v.viewW) + 2 * pad, h = Math.round(v.viewH) + 2 * pad
  const all = new Uint8Array(w * h), solid = new Uint8Array(w * h)
  for (const e of elements) {
    const hull = elementHull(v, cam, toWorld, e.bbox_m)
    if (!hull) continue
    fillConvex(all, w, h, hull, pad)
    if (isSolid(e)) fillConvex(solid, w, h, hull, pad)
  }
  return { w, h, pad, all, solid }
}

// --- the drawn overlay ----------------------------------------------------------------------------------------
/** Overlay pixels in a screenshot taken with the video blacked out: anything brighter than `threshold`. */
export function drawnMask(png: Buffer, threshold = 28): { w: number; h: number; mask: Uint8Array; count: number } {
  const img = PNG.sync.read(png)
  const mask = new Uint8Array(img.width * img.height)
  let count = 0
  for (let i = 0; i < mask.length; i++) {
    const r = img.data[4 * i], g = img.data[4 * i + 1], b = img.data[4 * i + 2]
    if (Math.max(r, g, b) > threshold) { mask[i] = 1; count++ }
  }
  return { w: img.width, h: img.height, mask, count }
}

/** Square dilation (radius r) of a binary mask, via running sums per row then per column. */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice()
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let run = 0
    for (let x = -r; x < w; x++) {
      if (x + r < w) run += m[y * w + x + r]
      if (x - r - 1 >= 0) run -= m[y * w + x - r - 1]
      if (x >= 0) tmp[y * w + x] = run > 0 ? 1 : 0
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0
    for (let y = -r; y < h; y++) {
      if (y + r < h) run += tmp[(y + r) * w + x]
      if (y - r - 1 >= 0) run -= tmp[(y - r - 1) * w + x]
      if (y >= 0) out[y * w + x] = run > 0 ? 1 : 0
    }
  }
  return out
}

export function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = m.map((v) => 1 - v)
  return dilate(inv, w, h, r).map((v) => 1 - v)
}

export type Fit = {
  /** drawn pixels (fraction of the canvas) */
  drawnFrac: number
  /** drawn pixels within `tol` px of the expected silhouette (any element) */
  precision: number
  /** pixels at least `tol` px inside a box-like concrete element's silhouette that are drawn */
  recall: number
  /** the shift (CSS px) of the expected silhouette that best matches the drawn one (IoU), and that IoU */
  shift: P2
  iouAtShift: number
  iouAtZero: number
}

/** Compare the drawn overlay with the expected silhouettes (same CSS px grid; exp is padded). */
export function compare(drawn: { w: number; h: number; mask: Uint8Array; count: number }, exp: Expected, tol: number, maxShift = 60): Fit {
  const { w, h } = drawn
  const { pad } = exp
  if (exp.w !== w + 2 * pad || exp.h !== h + 2 * pad) throw new Error(`size mismatch: drawn ${w}x${h}, expected ${exp.w - 2 * pad}x${exp.h - 2 * pad}`)
  const crop = (m: Uint8Array, dx = 0, dy = 0) => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = m[(y + pad - dy) * exp.w + (x + pad - dx)]
    return out
  }
  const all = crop(exp.all)
  const allD = dilate(all, w, h, tol)
  const solidE = erode(crop(exp.solid), w, h, tol)
  let inside = 0, solidN = 0, solidHit = 0
  for (let i = 0; i < w * h; i++) {
    if (drawn.mask[i] && allD[i]) inside++
    if (solidE[i]) { solidN++; if (drawn.mask[i]) solidHit++ }
  }
  // IoU against shifted expected silhouettes, coarse to fine (the expected mask is padded, so nothing falls off).
  const drawnIdx: number[] = []
  for (let i = 0; i < w * h; i++) if (drawn.mask[i]) drawnIdx.push(i)
  // integral image of exp.all for |shifted expected ∩ view|
  const W1 = exp.w + 1
  const integ = new Float64Array(W1 * (exp.h + 1))
  for (let y = 0; y < exp.h; y++) {
    let row = 0
    for (let x = 0; x < exp.w; x++) {
      row += exp.all[y * exp.w + x]
      integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row
    }
  }
  const windowSum = (x0: number, y0: number) => integ[(y0 + h) * W1 + x0 + w] - integ[y0 * W1 + x0 + w] - integ[(y0 + h) * W1 + x0] + integ[y0 * W1 + x0]
  const iou = (dx: number, dy: number) => {
    let inter = 0
    for (const i of drawnIdx) {
      const y = (i / w) | 0, x = i - y * w
      inter += exp.all[(y + pad - dy) * exp.w + (x + pad - dx)]
    }
    const expN = windowSum(pad - dx, pad - dy)
    const uni = drawn.count + expN - inter
    return uni > 0 ? inter / uni : 0
  }
  const lim = Math.min(maxShift, pad)
  let best: P2 = [0, 0], bestIou = iou(0, 0)
  const iouAtZero = bestIou
  for (const step of [8, 2, 1]) {
    const [cx, cy] = best
    const span = step === 8 ? lim : step * 4
    for (let dy = cy - span; dy <= cy + span; dy += step) {
      for (let dx = cx - span; dx <= cx + span; dx += step) {
        if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue
        const v = iou(dx, dy)
        if (v > bestIou) { bestIou = v; best = [dx, dy] }
      }
    }
  }
  return {
    drawnFrac: drawn.count / (w * h),
    precision: drawn.count ? inside / drawn.count : 0,
    recall: solidN ? solidHit / solidN : NaN,
    shift: best,
    iouAtShift: bestIou,
    iouAtZero,
  }
}

/** Save a mask comparison picture: drawn only (red), expected only (blue), both (white). */
export function comparisonPng(drawn: { w: number; h: number; mask: Uint8Array }, exp: Expected): Buffer {
  const { w, h } = drawn
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const d = drawn.mask[i], e = exp.all[(y + exp.pad) * exp.w + x + exp.pad], s = exp.solid[(y + exp.pad) * exp.w + x + exp.pad]
      const o = 4 * i
      png.data[o] = d ? 255 : 0
      png.data[o + 1] = d && e ? 255 : s ? 60 : 0
      png.data[o + 2] = e ? 255 : 0
      png.data[o + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

// --- page helpers ---------------------------------------------------------------------------------------------
/**
 * Installs window.__e2eMotion in the page: `sync(schedule)` sends, on every video frame, the deviceorientation
 * event of the camera pose of the frame on screen (read from the frame-index stamp); `constant(o)` sends one
 * event 30 times a second; `stop()`; `stats()` = last frame index read and events sent. Call before Start camera,
 * so its video-frame callback runs before the overlay's on each frame.
 */
export async function installMotionDriver(page: Page, stamp: { bits: number; px: number }): Promise<void> {
  await page.evaluate((st) => {
    type O = { alpha: number; beta: number; gamma: number }
    const w = window as unknown as Record<string, unknown>
    if (w.__e2eMotion) return
    const cvs = document.createElement('canvas')
    cvs.width = (st.bits + 2) * st.px
    cvs.height = st.px
    const ctx = cvs.getContext('2d', { willReadFrequently: true })!
    let mode: 'off' | 'sync' | 'const' = 'off'
    let schedule: (O | null)[] = []
    let constant: O | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let lastIdx = -1, sent = 0, frames = 0, bad = 0
    const video = () => document.querySelector('video.live-video') as HTMLVideoElement | null
    const readIndex = (v: HTMLVideoElement): number => {
      ctx.drawImage(v, 0, 0, cvs.width, cvs.height, 0, 0, cvs.width, cvs.height)
      const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data
      const bit = (i: number) => d[((st.px >> 1) * cvs.width + i * st.px + (st.px >> 1)) * 4] > 128
      if (!bit(st.bits) || bit(st.bits + 1)) return -1
      let idx = 0
      for (let i = 0; i < st.bits; i++) if (bit(i)) idx |= 1 << i
      return idx
    }
    const send = (o: O) => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: o.alpha, beta: o.beta, gamma: o.gamma, absolute: false }))
      sent++
    }
    // Always watch the frames (the index is useful without motion events too).
    const watch = () => {
      const v = video()
      if (!v) return void setTimeout(watch, 50)
      const cb = () => {
        frames++
        const i = v.videoWidth ? readIndex(v) : -1
        if (i < 0) bad++
        else lastIdx = i
        if (mode === 'sync' && i >= 0 && schedule[i]) send(schedule[i]!)
        v.requestVideoFrameCallback(cb)
      }
      v.requestVideoFrameCallback(cb)
    }
    watch()
    w.__e2eMotion = {
      sync(s: (O | null)[]) { if (timer) clearInterval(timer); timer = null; schedule = s; mode = 'sync' },
      constant(o: O) {
        if (timer) clearInterval(timer)
        constant = o
        mode = 'const'
        send(o)
        timer = setInterval(() => constant && send(constant), 33)
      },
      stop() { if (timer) clearInterval(timer); timer = null; mode = 'off' },
      stats() { return { lastIdx, sent, frames, bad, mode } },
    }
  }, stamp)
}

export type MotionStats = { lastIdx: number; sent: number; frames: number; bad: number; mode: string }
export const motion = {
  sync: (page: Page, s: ({ alpha: number; beta: number; gamma: number } | null)[]) =>
    page.evaluate((x) => (window as unknown as { __e2eMotion: { sync(v: unknown): void } }).__e2eMotion.sync(x), s),
  constant: (page: Page, o: { alpha: number; beta: number; gamma: number }) =>
    page.evaluate((x) => (window as unknown as { __e2eMotion: { constant(v: unknown): void } }).__e2eMotion.constant(x), o),
  stop: (page: Page) => page.evaluate(() => (window as unknown as { __e2eMotion: { stop(): void } }).__e2eMotion.stop()),
  stats: (page: Page) => page.evaluate(() => (window as unknown as { __e2eMotion: { stats(): MotionStats } }).__e2eMotion.stats()),
}

/** Screenshot of the overlay canvas alone: the video blacked out and the live chrome hidden for the shot. */
export async function overlayShot(page: Page): Promise<{ png: Buffer; rect: { x: number; y: number; width: number; height: number } }> {
  await page.evaluate(() => {
    const st = document.createElement('style')
    st.id = 'e2e-mask'
    st.textContent = '.live-video{filter:brightness(0)!important}.live-top,.live-actions,.live-calib,.live-controls,.results-sheet{visibility:hidden!important}'
    document.head.append(st)
  })
  try {
    // A few video frames: the restyled layers need a newly presented WebGL frame (the overlay draws per video frame).
    await page.waitForTimeout(300)
    const rect = await page.locator('canvas.live-canvas').boundingBox()
    if (!rect) throw new Error('no overlay canvas')
    const png = await page.screenshot({ clip: rect, scale: 'css' })
    return { png, rect }
  } finally {
    await page.evaluate(() => document.getElementById('e2e-mask')?.remove())
  }
}

/** The live page's visible state: badge, chips, coach lines, warnings and the Check as-built button. */
export async function liveState(page: Page): Promise<{ badge: string; chip: string; coach: string[]; warnings: string[]; checkDisabled: boolean | null }> {
  return page.evaluate(() => {
    const text = (sel: string) => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').trim())
    const btn = [...document.querySelectorAll('.live-actions button')].find((b) => /Check as-built|Checking/.test(b.textContent ?? '')) as HTMLButtonElement | undefined
    return {
      badge: text('.q-badge')[0] ?? '',
      chip: text('.mode-chip')[0] ?? '',
      coach: text('.live-top .coach'),
      warnings: text('.live-top .live-warning'),
      checkDisabled: btn ? btn.disabled : null,
    }
  })
}
