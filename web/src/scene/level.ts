/**
 * Gravity levelling for the camera overlay. A degree of tilt in the QR pose (noise, or a sheet that leans a little)
 * tips a 10 m building visibly off the ground. The motion sensors know "up" to well under a degree, so the model
 * is rotated about the code until its IFC Z axis points straight up; the code position and the heading still come
 * from the QR code. A correction larger than `maxDeg` is refused (the sensors or the frames disagree too much to
 * trust either) and the QR-only matrix is kept.
 */
import type { Mat3, Vec3 } from '../pose'

export const LEVEL_MAX_DEG = 8

/** World up in three.js camera coordinates (x right, y up, z back), from the device -> world rotation (row-major). */
export function upInGlCamera(D: Mat3): Vec3 {
  // GL camera = CV_TO_GL * C_FROM_DEVICE * device = device (both are diag(1, -1, -1)), and up_device = D^T e_z.
  return [D[6], D[7], D[8]]
}

/**
 * Column-major 4x4 (IFC -> GL camera, uniform scale allowed) rotated about the IFC point `pivot` so that IFC +Z
 * maps onto `up`. Returns null when that takes more than `maxDeg`.
 */
export function levelModelMatrix(m: ArrayLike<number>, pivot: Vec3, up: Vec3, maxDeg = LEVEL_MAX_DEG): number[] | null {
  const z = unit([m[8], m[9], m[10]])
  const u = unit(up)
  if (!z || !u) return null
  const axis = cross(z, u)
  const sin = Math.hypot(...axis)
  const cos = dot(z, u)
  const angle = Math.atan2(sin, cos)
  if (angle > (maxDeg * Math.PI) / 180) return null
  const out = Array.from(m)
  if (sin < 1e-12) return out
  const k = axis.map((v) => v / sin) as Vec3
  const R = rodrigues(k, cos, sin)
  const p: Vec3 = [0, 1, 2].map((i) => m[i] * pivot[0] + m[4 + i] * pivot[1] + m[8 + i] * pivot[2] + m[12 + i]) as Vec3
  for (let c = 0; c < 3; c++) {
    const col = mulVec(R, [m[4 * c], m[4 * c + 1], m[4 * c + 2]])
    out[4 * c] = col[0]
    out[4 * c + 1] = col[1]
    out[4 * c + 2] = col[2]
  }
  const Rb = mulVec(R, [m[12], m[13], m[14]])
  const Rp = mulVec(R, p)
  for (let i = 0; i < 3; i++) out[12 + i] = Rb[i] + p[i] - Rp[i] // rotate about p: p stays where the code is
  return out
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function unit(v: Vec3): Vec3 | null {
  const n = Math.hypot(...v)
  return n > 1e-12 ? (v.map((x) => x / n) as Vec3) : null
}

/** Row-major rotation by the angle with this cos and sin about the unit axis k. */
function rodrigues(k: Vec3, cos: number, sin: number): Mat3 {
  const [x, y, z] = k
  const t = 1 - cos
  return [
    t * x * x + cos, t * x * y - sin * z, t * x * z + sin * y,
    t * x * y + sin * z, t * y * y + cos, t * y * z - sin * x,
    t * x * z - sin * y, t * y * z + sin * x, t * z * z + cos,
  ]
}

function mulVec(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ]
}
