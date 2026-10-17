/**
 * Sensor fusion for the camera overlay: the QR code says where the code is, the motion sensors say how the device is
 * turned. A tilt or heading error of 1° in one QR pose swings the far end of a 10 m building by about 20 cm, and the
 * QR pose of a 23 cm code wobbles by a degree or more from frame to frame; the sensors' rotation is smooth.
 *
 * Each detection gives, with D the device -> world rotation at that frame's capture time (motion.ts frames):
 *   - the code's orientation in the world, R_wm = D C R_cm. The code doesn't move, so this is a weighted running
 *     average: sharp, close views count most, scattered outliers are ignored, and a consistent jump (a flip being
 *     corrected, a sensor reset) re-anchors it;
 *   - the camera's position relative to the code in world axes, p = -D C t, smoothed (it follows the person).
 * Every rendered frame then rebuilds marker -> camera from those and the rotation at its own capture time:
 *   R_cm = C D^T R_wm,   t = -C D^T p.
 * Turning the device moves the model at sensor rate with no detection lag, and QR noise averages out.
 */
import { mat3Mul, mat3MulVec, OneEuroVector, quatFromRotation, rotationFromQuat, transpose3, type Mat3, type OneEuroParams, type Pose, type Quat, type Quality, type Vec3 } from '../pose'
import { C_FROM_DEVICE } from './motion'

/** Camera position smoothing (metres): firm at rest, where a centimetre shows on near elements, looser when walking. */
export const FUSION_POSITION_PARAMS: OneEuroParams = { minCutoff: 0.3, beta: 1.5, dCutoff: 1 }
const QUALITY_WEIGHT: Record<Quality, number> = { good: 1, fair: 0.25, poor: 0.05 }

export type FusionOptions = {
  /** Memory of the code's orientation (s): long, since the code doesn't move; short enough to follow sensor yaw drift. */
  memoryS?: number
  /** A detection further than this from the average (scaled up with distance) is an outlier. */
  outlierDeg?: number
  /** This many consecutive outliers that agree with each other re-anchor the orientation. */
  jumpFrames?: number
  /** Device rotations kept for looking up a frame's capture time (ms). */
  historyMs?: number
  /** No sensor sample for this long: the sensors are off (ms). */
  staleMs?: number
}

export class PoseFusion {
  private samples: { t: number; D: Mat3 }[] = []
  private q: Quat | null = null
  private weight = 0
  private tq = 0
  private jump: { q: Quat; n: number } | null = null
  private resets: number[] = []
  private p: Vec3 | null = null
  private readonly pf = new OneEuroVector(FUSION_POSITION_PARAMS)
  private readonly o: Required<FusionOptions>

  constructor(opts: FusionOptions = {}) {
    this.o = { memoryS: 30, outlierDeg: 6, jumpFrames: 8, historyMs: 1000, staleMs: 500, ...opts }
  }

  /** A device -> world rotation from the motion sensors, stamped in ms (performance.now()). */
  addOrientation(D: Mat3, tMs: number): void {
    this.samples.push({ t: tMs, D })
    while (this.samples.length > 2 && this.samples[1].t < tMs - this.o.historyMs) this.samples.shift()
  }

  /** The device rotation at time tMs: the last sample at or before it. Null without sensors, or when they went quiet. */
  orientationAt(tMs: number): Mat3 | null {
    const s = this.samples
    if (!s.length || s[s.length - 1].t < tMs - this.o.staleMs) return null
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= tMs) return s[i].D
    return s[0].D
  }

  /** Feed one detection (the raw QR pose of the frame captured at tMs). False when there is no sensor sample for it. */
  addDetection(pose: Pose, quality: Quality, provisional: boolean, distanceM: number, tMs: number): boolean {
    const D = this.orientationAt(tMs)
    if (!D) return false
    const DC = mat3Mul(D, C_FROM_DEVICE)
    const w = (QUALITY_WEIGHT[quality] * (provisional ? 0.02 : 1)) / Math.max(distanceM, 0.5) ** 2
    this.updateOrientation(quatFromRotation(mat3Mul(DC, pose.R)), w, distanceM, tMs)
    this.p = this.pf.filter(mat3MulVec(DC, pose.t).map((v) => -v), tMs / 1000) as Vec3
    return true
  }

  /** Marker -> camera for the frame captured at tMs, or null before the first detection or without sensors. */
  poseAt(tMs: number): Pose | null {
    const D = this.orientationAt(tMs)
    if (!D || !this.q || !this.p) return null
    const CDt = mat3Mul(C_FROM_DEVICE, transpose3(D))
    return { R: mat3Mul(CDt, rotationFromQuat(this.q)), t: mat3MulVec(CDt, this.p).map((v) => -v) as Vec3 }
  }

  /** False after repeated re-anchoring (the sensors and the code keep disagreeing): use the QR pose alone. */
  trusted(tMs: number): boolean {
    return this.resets.filter((t) => t > tMs - 20_000).length < 3
  }

  /** Forget the code's pose (new intrinsics or code size: earlier detections were measured with the old ones). */
  reset(): void {
    this.q = null
    this.p = null
    this.weight = 0
    this.jump = null
    this.pf.reset()
  }

  hasEstimate(): boolean {
    return this.q !== null && this.p !== null
  }

  private updateOrientation(qIn: Quat, w: number, distanceM: number, tMs: number): void {
    if (!this.q) {
      this.q = qIn
      this.weight = w
      this.tq = tMs
      return
    }
    this.weight *= Math.exp(-(tMs - this.tq) / 1000 / this.o.memoryS)
    this.tq = tMs
    const qi = align(qIn, this.q)
    const limit = (Math.max(this.o.outlierDeg, 3 * distanceM) * Math.PI) / 180
    if (this.weight >= 0.5 && angle(qi, this.q) > limit) {
      // An outlier. Several in a row that agree with each other are a real jump: re-anchor on them.
      if (this.jump && angle(align(qi, this.jump.q), this.jump.q) < limit) {
        this.jump = { q: nlerp(this.jump.q, align(qi, this.jump.q), 1 / (this.jump.n + 1)), n: this.jump.n + 1 }
      } else {
        this.jump = { q: qi, n: 1 }
      }
      if (this.jump.n >= this.o.jumpFrames) {
        this.q = this.jump.q
        this.weight = w * this.jump.n
        this.jump = null
        this.resets.push(tMs)
      }
      return
    }
    this.jump = null
    this.weight += w
    this.q = nlerp(this.q, qi, w / this.weight)
  }
}

function align(q: Quat, ref: Quat): Quat {
  return q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q
}

function angle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return 2 * Math.acos(Math.min(1, d))
}

function nlerp(a: Quat, b: Quat, k: number): Quat {
  const q: Quat = [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2]), a[3] + k * (b[3] - a[3])]
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}
