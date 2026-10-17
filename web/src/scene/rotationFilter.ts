/**
 * Smooths the device rotation from the motion sensors before it turns the model. With the sensors on, every rendered
 * frame turns the whole model by the device rotation of that frame, so a few hundredths of a degree of sensor noise
 * shake it on screen even with the phone on a stand (measured on the ray-traced videos: 2-8 px per frame for
 * 0.05-0.15 degrees of noise). Adaptive, like a One Euro filter: heavy at rest (cutoff `minCutoffHz`), light while the
 * device turns (the cutoff rises with the turn rate, `beta` Hz per degree/s), so turning stays in step with the camera
 * image. The turn rate is measured over the last `rateWindowMs` of readings, not between two readings 16 ms apart:
 * over 16 ms the noise itself looks like a turn of several degrees a second and would loosen the filter at rest.
 */
import { quatFromRotation, rotationFromQuat, type Mat3, type Quat } from '../pose'

export type RotationFilterParams = { minCutoffHz: number; beta: number; rateWindowMs: number }
export const ROTATION_FILTER: RotationFilterParams = { minCutoffHz: 0.2, beta: 0.5, rateWindowMs: 150 }

export class RotationSmoother {
  private q: Quat | null = null
  private history: { tMs: number; q: Quat }[] = []
  private tMs = 0
  private readonly p: RotationFilterParams

  constructor(p: RotationFilterParams = ROTATION_FILTER) {
    this.p = p
  }

  /** The smoothed device rotation for a reading taken at tMs (performance.now() ms). */
  filter(D: Mat3, tMs: number): Mat3 {
    const qIn = quatFromRotation(D)
    this.history.push({ tMs, q: qIn })
    while (this.history.length > 2 && this.history[1].tMs <= tMs - this.p.rateWindowMs) this.history.shift()
    if (!this.q) {
      this.q = qIn
      this.tMs = tMs
      return D
    }
    const dt = (tMs - this.tMs) / 1000
    if (!(dt > 0)) return rotationFromQuat(this.q)
    this.tMs = tMs
    const qi = align(qIn, this.q)
    // How fast the device turns (degrees/s): the oldest reading in the window to this one.
    const old = this.history[0]
    const span = (tMs - old.tMs) / 1000
    const rate = span > 0 ? Math.hypot(...rotationVectorDeg(mul(conj(old.q), align(qIn, old.q)))) / span : 0
    this.q = nlerp(this.q, qi, alpha(this.p.minCutoffHz + this.p.beta * rate, dt))
    return rotationFromQuat(this.q)
  }

  reset(): void {
    this.q = null
    this.history = []
  }
}

/** Exponential smoothing factor for a cutoff frequency and a time step (s). */
function alpha(cutoffHz: number, dt: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dt))
}

function mul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

function align(q: Quat, ref: Quat): Quat {
  return q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q
}

function rotationVectorDeg(q: Quat): [number, number, number] {
  const w = Math.min(1, Math.abs(q[3]))
  const s = q[3] < 0 ? -1 : 1
  const angle = 2 * Math.acos(w)
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w))
  const k = sinHalf < 1e-9 ? 2 : angle / sinHalf
  return [q[0], q[1], q[2]].map((v) => ((s * v * k) * 180) / Math.PI) as [number, number, number]
}

function nlerp(a: Quat, b: Quat, k: number): Quat {
  const q: Quat = [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1]), a[2] + k * (b[2] - a[2]), a[3] + k * (b[3] - a[3])]
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}
