// Synthetic QR imaging with exactly known geometry (for tests and in-browser self-tests).
// Pixel-edge convention throughout: pixel (i, j) covers [i, i+1) x [j, j+1).
import type { Point as Pt } from './protocol'

/** 3x3 matrix, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export interface ModuleMatrix {
  /** modules per side (N) */
  size: number
  /** true when module (col x, row y) is dark */
  dark(x: number, y: number): boolean
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) throw new Error('singular matrix')
  const s = 1 / det
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ]
}

export function applyH(H: Mat3, x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

export const rotX = (a: number): Mat3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)]
export const rotY = (a: number): Mat3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)]
export const rotZ = (a: number): Mat3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]

export interface Intrinsics {
  fx: number
  fy: number
  cx: number
  cy: number
}

/**
 * Homography from symbol module coordinates (u, v) in [0, N] to image pixels,
 * for a QR of physical side `sizeM` metres, centred at the marker origin.
 * Vision camera frame: x right, y down, z forward. Marker frame: x along the
 * code's top edge (left -> right), y down the code, z into the code (away from
 * a viewer facing it). R (row-major) and t map marker -> camera.
 */
export function homographyFromPose(K: Intrinsics, R: Mat3, t: [number, number, number], sizeM: number, N: number): Mat3 {
  const Km: Mat3 = [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1]
  const Rt: Mat3 = [R[0], R[1], t[0], R[3], R[4], t[1], R[6], R[7], t[2]]
  const s = sizeM / N
  const A: Mat3 = [s, 0, -sizeM / 2, 0, s, -sizeM / 2, 0, 0, 1]
  return mul3(mul3(Km, Rt), A)
}

export interface RenderOptions {
  /** quiet-zone width in modules (spec: 4) */
  quiet?: number
  /** grey level (0-255) outside the quiet zone */
  background?: number
  /** supersampling per axis, for anti-aliased edges like a real camera */
  supersample?: number
  /** dark module grey level */
  ink?: number
  /** paper grey level */
  paper?: number
}

/** Render a module matrix through homography H (modules -> pixels) into RGBA. */
export function renderQr(mods: ModuleMatrix, H: Mat3, width: number, height: number, opts: RenderOptions = {}): Uint8ClampedArray {
  const { quiet = 4, background = 150, supersample = 4, ink = 20, paper = 235 } = opts
  const Hi = inv3(H)
  const N = mods.size
  const out = new Uint8ClampedArray(width * height * 4)
  const ss = supersample
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const p = applyH(Hi, x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)
          let v = background
          if (p.x >= -quiet && p.x < N + quiet && p.y >= -quiet && p.y < N + quiet) {
            v = paper
            if (p.x >= 0 && p.x < N && p.y >= 0 && p.y < N && mods.dark(Math.floor(p.x), Math.floor(p.y))) v = ink
          }
          acc += v
        }
      }
      const g = acc / (ss * ss)
      const o = (y * width + x) * 4
      out[o] = out[o + 1] = out[o + 2] = g
      out[o + 3] = 255
    }
  }
  return out
}

export interface DegradeOptions {
  /** box-blur radius in px, applied `passes` times (3 passes ~ Gaussian, sigma ~ radius) */
  blurRadius?: number
  passes?: number
  /** uniform noise amplitude in grey levels (+/-) */
  noise?: number
  /** multiplicative left-to-right lighting gradient, e.g. 0.5 -> right edge at 50% */
  gradient?: number
  seed?: number
}

/** Camera-like degradation: blur, sensor noise and uneven lighting. Deterministic (seeded). */
export function degrade(rgba: Uint8ClampedArray, width: number, height: number, o: DegradeOptions = {}): Uint8ClampedArray {
  const { blurRadius = 0, passes = 3, noise = 0, gradient = 1, seed = 1 } = o
  let g = new Float32Array(width * height)
  for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4]
  const r = Math.round(blurRadius)
  for (let p = 0; r > 0 && p < passes; p++) {
    const tmp = new Float32Array(g.length)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let s = 0, n = 0
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < width) { s += g[y * width + xx]; n++ } }
        tmp[y * width + x] = s / n
      }
    const out = new Float32Array(g.length)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let s = 0, n = 0
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < height) { s += tmp[yy * width + x]; n++ } }
        out[y * width + x] = s / n
      }
    g = out
  }
  let state = seed >>> 0 || 1
  const rand = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) / 4294967296) }
  const res = new Uint8ClampedArray(rgba.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const light = 1 + (gradient - 1) * (x / (width - 1))
      const v = g[i] * light + (rand() * 2 - 1) * noise
      res[i * 4] = res[i * 4 + 1] = res[i * 4 + 2] = v
      res[i * 4 + 3] = 255
    }
  return res
}

/**
 * 2x2 area-average downscale (what drawImage(video, 0, 0, w/2, h/2) roughly does
 * when shrinking a 1280-wide frame to 640 for detection). Coordinates scale by
 * exactly 0.5 in the pixel-edge convention.
 */
export function downsample2x(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const w = width >> 1, h = height >> 1
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const a = rgba[((2 * y) * width + 2 * x) * 4 + c] + rgba[((2 * y) * width + 2 * x + 1) * 4 + c]
          + rgba[((2 * y + 1) * width + 2 * x) * 4 + c] + rgba[((2 * y + 1) * width + 2 * x + 1) * 4 + c]
        out[(y * w + x) * 4 + c] = a / 4
      }
  return out
}

/** Expected image positions of the symbol's outer corners, in symbol order TL, TR, BR, BL. */
export function expectedCorners(H: Mat3, N: number): [Pt, Pt, Pt, Pt] {
  return [applyH(H, 0, 0), applyH(H, N, 0), applyH(H, N, N), applyH(H, 0, N)]
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
