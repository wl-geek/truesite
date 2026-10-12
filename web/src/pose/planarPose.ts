/**
 * The two-fold ambiguity of a small planar target, handled with IPPE:
 * T. Collins and A. Bartoli, "Infinitesimal Plane-Based Pose Estimation",
 * IJCV 109(3), 2014. (Same maths as OpenCV's SOLVEPNP_IPPE_SQUARE.)
 *
 * A small, tilted square seen in perspective has two poses that reproject
 * almost equally well: the true one and one whose normal is "reflected" about
 * the line of sight (the "flip"). A single homography decomposition returns
 * whichever one the noise favours. IPPE returns both in closed form:
 *
 *  1. Hn = K^-1 H maps the marker plane (centred on the code centre, which is
 *     the marker-frame origin) to normalised image coordinates. Let
 *     (p, q) = Hn(0, 0) be the image of the centre and J the 2x2 Jacobian of
 *     Hn at (0, 0).
 *  2. Rv is the rotation taking the optical axis e_z to the ray v = (p, q, 1).
 *     With B = [I2 | -(p, q)^T] * Rv[:, 0:2], the true rotation R = Rv * R'
 *     satisfies J = (1/t_z) * B * R'[0:2, 0:2], so R'[0:2, 0:2] = A / gamma
 *     with A = B^-1 J and gamma = largest singular value of A.
 *  3. The third row of R'[:, 0:2] is fixed only up to sign: +-(b0, b1). Each
 *     sign gives one rotation: R_k = Rv * [c1, c2, c1 x c2].
 *  4. For each R_k, t is the linear least-squares solution of the projection
 *     equations [1 0 -x_i; 0 1 -y_i] (R_k X_i + t) = 0 over all points.
 *
 * Both candidates are then refined (refinePose.ts) and chooseCandidate()
 * picks the lower RMS, or, when the two are within `ambiguityTolPx`, the one
 * closer to the previous frame's rotation.
 */
import { type Intrinsics, KInverse, type Pose, normalizePixel } from './camera';
import { type Mat3, type Point2, type Vec3, cross3, fromColumns, identity3, mat3Mul, mat3MulVec, solveLinear } from './linalg';
import { type RefinedPose } from './refinePose';
import { rotationAngleBetween, rotationFromVector } from './rotation';

/** Rotation that maps the unit z axis onto the direction of v. */
function rotationZToVector(v: Vec3): Mat3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  const d: Vec3 = [v[0] / n, v[1] / n, v[2] / n];
  const axis: Vec3 = [-d[1], d[0], 0]; // e_z x d
  const s = Math.hypot(axis[0], axis[1]);
  if (s < 1e-12) return d[2] > 0 ? identity3() : rotationFromVector([Math.PI, 0, 0]);
  const angle = Math.atan2(s, d[2]);
  return rotationFromVector([(axis[0] / s) * angle, (axis[1] / s) * angle, 0]);
}

/** Least-squares translation for a known rotation (step 4 above). */
export function translationForRotation(
  R: Mat3,
  K: Intrinsics,
  objectPts: readonly Vec3[],
  imagePts: readonly Point2[],
): Vec3 | null {
  const AtA = new Array<number>(9).fill(0);
  const Atb = new Array<number>(3).fill(0);
  for (let i = 0; i < objectPts.length; i++) {
    const [x, y] = normalizePixel(K, imagePts[i]);
    const rx = mat3MulVec(R, objectPts[i] as Vec3);
    // rows a = [1, 0, -x], [0, 1, -y]; rhs = -a . rx
    const rows: [number[], number][] = [
      [[1, 0, -x], -(rx[0] - x * rx[2])],
      [[0, 1, -y], -(rx[1] - y * rx[2])],
    ];
    for (const [a, b] of rows) {
      for (let r = 0; r < 3; r++) {
        Atb[r] += a[r] * b;
        for (let c = 0; c < 3; c++) AtA[r * 3 + c] += a[r] * a[c];
      }
    }
  }
  const t = solveLinear(AtA, Atb, 3);
  return t ? [t[0], t[1], t[2]] : null;
}

/**
 * Both IPPE rotation candidates for a homography H (marker plane metres ->
 * pixels) whose plane origin is the marker centre. Returns null if degenerate.
 */
export function ippeRotations(H: Mat3, K: Intrinsics): [Mat3, Mat3] | null {
  const Hn = mat3Mul(KInverse(K), H);
  const w = Hn[8];
  if (Math.abs(w) < 1e-12) return null;
  const h = Hn.map((x) => x / w);
  const p = h[2];
  const q = h[5];
  // Jacobian of (x, y) -> Hn(x, y) at the origin (h33 = 1).
  const j00 = h[0] - h[6] * p, j01 = h[1] - h[7] * p;
  const j10 = h[3] - h[6] * q, j11 = h[4] - h[7] * q;

  const Rv = rotationZToVector([p, q, 1]);
  const b00 = Rv[0] - p * Rv[6], b01 = Rv[1] - p * Rv[7];
  const b10 = Rv[3] - q * Rv[6], b11 = Rv[4] - q * Rv[7];
  const det = b00 * b11 - b01 * b10;
  if (Math.abs(det) < 1e-15) return null;
  const bi00 = b11 / det, bi01 = -b01 / det, bi10 = -b10 / det, bi11 = b00 / det;
  const a00 = bi00 * j00 + bi01 * j10, a01 = bi00 * j01 + bi01 * j11;
  const a10 = bi10 * j00 + bi11 * j10, a11 = bi10 * j01 + bi11 * j11;

  // Largest singular value of the 2x2 A.
  const s00 = a00 * a00 + a01 * a01;
  const s01 = a00 * a10 + a01 * a11;
  const s11 = a10 * a10 + a11 * a11;
  const gamma2 = 0.5 * (s00 + s11 + Math.sqrt((s00 - s11) ** 2 + 4 * s01 * s01));
  if (!(gamma2 > 1e-30)) return null;
  const gamma = Math.sqrt(gamma2);
  const r00 = a00 / gamma, r01 = a01 / gamma, r10 = a10 / gamma, r11 = a11 / gamma;
  const b0 = Math.sqrt(Math.max(0, 1 - r00 * r00 - r10 * r10));
  let b1 = Math.sqrt(Math.max(0, 1 - r01 * r01 - r11 * r11));
  // Columns must be orthogonal: r00 r01 + r10 r11 + b0 b1 = 0.
  if (-r00 * r01 - r10 * r11 < 0) b1 = -b1;

  const make = (sign: number): Mat3 => {
    const c1: Vec3 = [r00, r10, sign * b0];
    const c2: Vec3 = [r01, r11, sign * b1];
    return mat3Mul(Rv, fromColumns(c1, c2, cross3(c1, c2)));
  };
  return [make(1), make(-1)];
}

/** Both IPPE candidate poses (rotation + least-squares translation). */
export function ippeCandidates(
  H: Mat3,
  K: Intrinsics,
  objectPts: readonly Vec3[],
  imagePts: readonly Point2[],
): Pose[] {
  const rots = ippeRotations(H, K);
  if (!rots) return [];
  const out: Pose[] = [];
  for (const R of rots) {
    const t = translationForRotation(R, K, objectPts, imagePts);
    if (t && t[2] > 0) out.push({ R, t });
  }
  return out;
}

/** True when the code's printed face looks toward the camera: dot(R[:,2], t) < 0. */
export function facesCamera(pose: Pose): boolean {
  return pose.R[2] * pose.t[0] + pose.R[5] * pose.t[1] + pose.R[8] * pose.t[2] < 0 && pose.t[2] > 0;
}

export interface ChooseOptions {
  /**
   * If the two candidates' RMS differ by less than this (px), the frame is
   * ambiguous and the previous pose decides (default 1.0 px).
   */
  ambiguityTolPx?: number;
}

export interface Choice {
  best: RefinedPose;
  other: RefinedPose | null;
  /** True when both candidates fit about equally well. */
  ambiguous: boolean;
  /** How the winner was chosen. */
  reason: 'only' | 'rms' | 'previous';
}

/**
 * Pick between refined candidates: lowest RMS, unless the two are within
 * `ambiguityTolPx` and a previous pose is given, in which case the one whose
 * rotation is closer to the previous rotation wins.
 */
export function chooseCandidate(cands: readonly RefinedPose[], prev?: Pose | null, opts: ChooseOptions = {}): Choice | null {
  const tol = opts.ambiguityTolPx ?? 1.0;
  const ok = cands.filter((c) => Number.isFinite(c.rmsPx) && facesCamera(c)).sort((a, b) => a.rmsPx - b.rmsPx);
  if (ok.length === 0) return null;
  if (ok.length === 1) return { best: ok[0], other: null, ambiguous: false, reason: 'only' };
  const [a, b] = ok;
  // Two candidates that converged to the same pose are not an ambiguity.
  if (rotationAngleBetween(a.R, b.R) < (1 * Math.PI) / 180) return { best: a, other: null, ambiguous: false, reason: 'only' };
  const ambiguous = b.rmsPx - a.rmsPx < tol;
  if (ambiguous && prev) {
    const da = rotationAngleBetween(a.R, prev.R);
    const db = rotationAngleBetween(b.R, prev.R);
    if (db < da) return { best: b, other: a, ambiguous, reason: 'previous' };
    return { best: a, other: b, ambiguous, reason: 'previous' };
  }
  return { best: a, other: b, ambiguous, reason: 'rms' };
}
