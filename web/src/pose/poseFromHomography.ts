/**
 * Classic pose from a plane-to-image homography (Zhang 2000, sec. 2.3/3.1).
 *
 * H maps marker-plane metres (x, y; z = 0) to pixels (conventions in camera.ts):
 *   [u v 1]^T ~ K [r1 r2 t] [x y 1]^T,
 * so M = K^-1 H = lambda [r1 r2 t]. We take
 *   lambda = 2 / (|m1| + |m2|)          (mean column scale),
 * flip its sign if needed so that t_z > 0 (the code is in front of the camera),
 * set r3 = r1 x r2 and replace [r1 r2 r3] by the nearest rotation (SVD polar
 * factor, linalg.nearestRotation). This is the "naive" single solution; it is
 * kept as a fallback and as the baseline for the planar-ambiguity tests. The
 * pipeline prefers IPPE (planarPose.ts), which returns both candidate poses.
 */
import { type Intrinsics, KInverse, type Pose } from './camera';
import { type Mat3, col3, cross3, fromColumns, mat3Mul, nearestRotation, norm3, scale3 } from './linalg';

export function poseFromHomography(H: Mat3, K: Intrinsics): Pose | null {
  const M = mat3Mul(KInverse(K), H);
  const m1 = col3(M, 0);
  const m2 = col3(M, 1);
  const m3 = col3(M, 2);
  const n1 = norm3(m1);
  const n2 = norm3(m2);
  if (!(n1 > 0 && n2 > 0) || !Number.isFinite(n1 + n2)) return null;
  let lambda = 2 / (n1 + n2);
  if (lambda * m3[2] < 0) lambda = -lambda; // choose the sign with t_z > 0
  const r1 = scale3(m1, lambda);
  const r2 = scale3(m2, lambda);
  const r3 = cross3(r1, r2);
  const t = scale3(m3, lambda);
  const R = nearestRotation(fromColumns(r1, r2, r3));
  return { R, t };
}
