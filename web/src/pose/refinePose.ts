/**
 * Levenberg-Marquardt refinement of a marker pose over 6 parameters
 * (rotation vector + translation), minimising the pixel reprojection error of
 * the marker corners (conventions in camera.ts).
 *
 * Parameterisation: the state is (R, t) with R stored as a matrix and reported
 * as a rotation vector (rvec = log R). Each step solves for an increment
 * delta = (w, dt) and applies R <- exp([w]x) R, t <- t + dt. This is the
 * standard on-manifold form of the rotation-vector update: its Jacobian is
 * simple and exact at w = 0 and it has no singularity at any rotation.
 *
 * For Xc = R X + t = y + t and u = f x/z + cx, v = f y/z + cy:
 *   dXc/dw = -[y]x,   dXc/dt = I,
 *   du/dXc = (f/z) [1, 0, -x/z],   dv/dXc = (f/z) [0, 1, -y/z].
 * Damping: (J^T J + mu * diag(J^T J)) delta = -J^T r (Marquardt scaling).
 *
 * RMS is sqrt(sum of squared pixel distances / number of points), the same
 * definition OpenCV uses for reprojection error.
 */
import { type Intrinsics, type Pose, reprojectionRms } from './camera';
import { type Point2, type Vec3, mat3Mul, mat3MulVec, solveLinear } from './linalg';
import { rotationFromVector, vectorFromRotation } from './rotation';

export interface RefineOptions {
  /** Maximum LM iterations (default 30). */
  maxIterations?: number;
  /** Stop when the step norm falls below this (default 1e-10). */
  stepTol?: number;
}

export interface RefinedPose extends Pose {
  /** Rotation vector (axis * angle, radians) of R. */
  rvec: Vec3;
  /** RMS reprojection error in pixels. */
  rmsPx: number;
  iterations: number;
}

function cost(K: Intrinsics, pose: Pose, obj: readonly Vec3[], img: readonly Point2[]): number {
  const rms = reprojectionRms(K, pose, obj, img);
  return rms * rms * obj.length; // sum of squared distances
}

export function refinePose(
  init: Pose,
  objectPts: readonly Vec3[],
  imagePts: readonly Point2[],
  K: Intrinsics,
  opts: RefineOptions = {},
): RefinedPose {
  const maxIt = opts.maxIterations ?? 30;
  const stepTol = opts.stepTol ?? 1e-10;
  const n = objectPts.length;
  let R = init.R.slice();
  let t: Vec3 = [init.t[0], init.t[1], init.t[2]];
  let c = cost(K, { R, t }, objectPts, imagePts);
  let mu = 1e-3;
  let it = 0;
  const JtJ = new Array<number>(36);
  const g = new Array<number>(6);
  const Jrow = new Array<number>(6);

  for (; it < maxIt && Number.isFinite(c); it++) {
    JtJ.fill(0);
    g.fill(0);
    for (let i = 0; i < n; i++) {
      const y = mat3MulVec(R, objectPts[i] as Vec3);
      const X = y[0] + t[0], Y = y[1] + t[1], Z = y[2] + t[2];
      const iz = 1 / Z;
      const fx = K.f * iz;
      const ru = K.f * X * iz + K.cx - imagePts[i][0];
      const rv = K.f * Y * iz + K.cy - imagePts[i][1];
      // dXc/dw = -[y]x = [[0, y2, -y1], [-y2, 0, y0], [y1, -y0, 0]]
      const du = [fx, 0, -fx * X * iz]; // du/dXc
      const dv = [0, fx, -fx * Y * iz]; // dv/dXc
      for (const [d, r] of [[du, ru], [dv, rv]] as [number[], number][]) {
        Jrow[0] = d[1] * -y[2] + d[2] * y[1];
        Jrow[1] = d[0] * y[2] + d[2] * -y[0];
        Jrow[2] = d[0] * -y[1] + d[1] * y[0];
        Jrow[3] = d[0];
        Jrow[4] = d[1];
        Jrow[5] = d[2];
        for (let a = 0; a < 6; a++) {
          g[a] += Jrow[a] * r;
          for (let b = 0; b < 6; b++) JtJ[a * 6 + b] += Jrow[a] * Jrow[b];
        }
      }
    }
    let accepted = false;
    let stepNorm = 0;
    for (let tries = 0; tries < 10 && !accepted; tries++) {
      const A = JtJ.slice();
      for (let a = 0; a < 6; a++) A[a * 6 + a] += mu * (JtJ[a * 6 + a] + 1e-12);
      const delta = solveLinear(A, g.map((x) => -x), 6, 1e-15);
      if (!delta) { mu *= 10; continue; }
      stepNorm = Math.hypot(...delta);
      const Rn = mat3Mul(rotationFromVector([delta[0], delta[1], delta[2]]), R);
      const tn: Vec3 = [t[0] + delta[3], t[1] + delta[4], t[2] + delta[5]];
      const cn = cost(K, { R: Rn, t: tn }, objectPts, imagePts);
      if (cn < c) {
        R = Rn; t = tn; c = cn;
        mu = Math.max(mu / 10, 1e-12);
        accepted = true;
      } else {
        mu *= 10;
      }
    }
    if (!accepted || stepNorm < stepTol) break;
  }
  return { R, t, rvec: vectorFromRotation(R), rmsPx: Math.sqrt(c / n), iterations: it };
}
