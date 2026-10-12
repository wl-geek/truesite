/**
 * One Euro filter: G. Casiez, N. Roussel, D. Vogel, "1 Euro Filter: A Simple
 * Speed-based Low-pass Filter for Noisy Input in Interactive Systems", CHI 2012.
 *
 * An exponential low-pass whose cutoff rises with the signal's speed:
 *   alpha(fc, dt) = 1 / (1 + tau/dt),  tau = 1 / (2 pi fc)
 *   dx_hat = lowpass(dx/dt, alpha(dCutoff))
 *   fc     = minCutoff + beta * |dx_hat|
 *   x_hat  = lowpass(x, alpha(fc))
 * Slow movement -> low cutoff -> little jitter; fast movement -> high cutoff ->
 * little lag. Tune minCutoff (Hz) first for jitter at rest, then beta for lag.
 *
 * Timestamps are in SECONDS (use performance.now() / 1000 or the video
 * frame's mediaTime). Frames with dt <= 0 are ignored; a gap longer than
 * `maxGapSec` (the code was lost) resets the filter to the new sample.
 *
 * Classes:
 *  - OneEuroFilter: scalar;
 *  - OneEuroVector: n-vector with ONE shared cutoff driven by the speed |dx|
 *    (keeps the direction of motion unchanged);
 *  - OneEuroQuaternion: rotation smoothing; flips q to the hemisphere of the
 *    previous output (q and -q are the same rotation), drives the cutoff by the
 *    angular speed (rad/s), blends by normalised lerp and renormalises;
 *  - PoseSmoother: translation (OneEuroVector) + rotation (OneEuroQuaternion).
 */
import { type Pose } from './camera';
import { type Vec3 } from './linalg';
import { type Quat, quatFromRotation, rotationFromQuat } from './rotation';

export interface OneEuroParams {
  /** Cutoff (Hz) at zero speed. Lower = less jitter, more lag at rest. */
  minCutoff: number;
  /** Speed coefficient (cutoff Hz per unit/s). Higher = less lag when moving. */
  beta: number;
  /** Cutoff (Hz) for the derivative estimate (1 Hz in the paper). */
  dCutoff: number;
  /** Reset if no sample for this long (s). Default 0.5. */
  maxGapSec?: number;
}

export const smoothingAlpha = (cutoffHz: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

export class OneEuroVector {
  private x: number[] | null = null;
  private dx = 0;
  private t = 0;
  params: OneEuroParams;
  constructor(params: OneEuroParams) {
    this.params = params;
  }

  reset(): void { this.x = null; this.dx = 0; }

  filter(value: readonly number[], tSec: number): number[] {
    const p = this.params;
    if (this.x === null || tSec - this.t > (p.maxGapSec ?? 0.5)) {
      this.x = [...value];
      this.dx = 0;
      this.t = tSec;
      return [...this.x];
    }
    const dt = tSec - this.t;
    if (!(dt > 0)) return [...this.x];
    let speed2 = 0;
    for (let i = 0; i < value.length; i++) speed2 += ((value[i] - this.x[i]) / dt) ** 2;
    const aD = smoothingAlpha(p.dCutoff, dt);
    this.dx = this.dx + aD * (Math.sqrt(speed2) - this.dx);
    const a = smoothingAlpha(p.minCutoff + p.beta * this.dx, dt);
    for (let i = 0; i < value.length; i++) this.x[i] += a * (value[i] - this.x[i]);
    this.t = tSec;
    return [...this.x];
  }
}

export class OneEuroFilter {
  private v: OneEuroVector;
  constructor(params: OneEuroParams) { this.v = new OneEuroVector(params); }
  reset(): void { this.v.reset(); }
  filter(x: number, tSec: number): number { return this.v.filter([x], tSec)[0]; }
}

export class OneEuroQuaternion {
  private q: Quat | null = null;
  private w = 0; // filtered angular speed, rad/s
  private t = 0;
  params: OneEuroParams;
  constructor(params: OneEuroParams) {
    this.params = params;
  }

  reset(): void { this.q = null; this.w = 0; }

  filter(qIn: Quat, tSec: number): Quat {
    const p = this.params;
    const n = Math.hypot(qIn[0], qIn[1], qIn[2], qIn[3]);
    let q: Quat = [qIn[0] / n, qIn[1] / n, qIn[2] / n, qIn[3] / n];
    if (this.q === null || tSec - this.t > (p.maxGapSec ?? 0.5)) {
      this.q = q;
      this.w = 0;
      this.t = tSec;
      return [...q] as Quat;
    }
    const dt = tSec - this.t;
    if (!(dt > 0)) return [...this.q] as Quat;
    let d = q[0] * this.q[0] + q[1] * this.q[1] + q[2] * this.q[2] + q[3] * this.q[3];
    if (d < 0) { q = [-q[0], -q[1], -q[2], -q[3]]; d = -d; } // sign continuity
    const angle = 2 * Math.acos(Math.min(1, d)); // rotation from previous output, rad
    const aD = smoothingAlpha(p.dCutoff, dt);
    this.w = this.w + aD * (angle / dt - this.w);
    const a = smoothingAlpha(p.minCutoff + p.beta * this.w, dt);
    const out: Quat = [
      this.q[0] + a * (q[0] - this.q[0]),
      this.q[1] + a * (q[1] - this.q[1]),
      this.q[2] + a * (q[2] - this.q[2]),
      this.q[3] + a * (q[3] - this.q[3]),
    ];
    const m = Math.hypot(out[0], out[1], out[2], out[3]);
    this.q = [out[0] / m, out[1] / m, out[2] / m, out[3] / m];
    this.t = tSec;
    return [...this.q] as Quat;
  }
}

/**
 * Starting points for the camera<-marker pose (metres, radians), to be tuned
 * on a phone: at rest the overlay should not shimmer; on a quick pan it
 * should not trail the code by more than a frame or two.
 */
export const DEFAULT_TRANSLATION_PARAMS: OneEuroParams = { minCutoff: 1.0, beta: 20, dCutoff: 1.0 };
export const DEFAULT_ROTATION_PARAMS: OneEuroParams = { minCutoff: 1.0, beta: 2, dCutoff: 1.0 };

export class PoseSmoother {
  private tf: OneEuroVector;
  private rf: OneEuroQuaternion;
  constructor(tParams: OneEuroParams = DEFAULT_TRANSLATION_PARAMS, rParams: OneEuroParams = DEFAULT_ROTATION_PARAMS) {
    this.tf = new OneEuroVector(tParams);
    this.rf = new OneEuroQuaternion(rParams);
  }
  reset(): void { this.tf.reset(); this.rf.reset(); }
  filter(pose: Pose, tSec: number): Pose {
    const t = this.tf.filter(pose.t, tSec) as Vec3;
    const q = this.rf.filter(quatFromRotation(pose.R), tSec);
    return { R: rotationFromQuat(q), t };
  }
}
