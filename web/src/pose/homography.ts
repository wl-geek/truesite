/**
 * Planar homography by the normalised Direct Linear Transform
 * (Hartley & Zisserman, "Multiple View Geometry", 2nd ed., Alg. 4.2).
 *
 * H maps source points to destination points in homogeneous coordinates:
 *   [u v 1]^T ~ H [x y 1]^T.
 * In the pose pipeline the source is the marker plane (metres, marker frame,
 * z = 0) and the destination is image pixels (u right, v down, origin top-left).
 *
 * Both point sets are first normalised (Hartley): translated so their centroid
 * is at the origin and scaled so the mean distance from it is sqrt(2).
 *  - exactly 4 pairs: h33 = 1 in normalised coordinates and the 8x8 linear
 *    system is solved by Gaussian elimination with partial pivoting. h33 = 0
 *    would mean the centroid of the code maps to infinity, which cannot happen
 *    for a visible code, so fixing it is safe;
 *  - more than 4 pairs: total least squares, the eigenvector of A^T A with the
 *    smallest eigenvalue (A is the 2n x 9 DLT matrix), via Jacobi.
 * The result is de-normalised and scaled so that H[8] = 1.
 */
import { type Mat3, type Point2, inv3, jacobiEigenSymmetric, mat3Mul, solveLinear } from './linalg';

/** Similarity T (row-major) such that T * [x y 1]^T is Hartley-normalised. */
export function hartleyNormalizer(pts: readonly Point2[]): Mat3 | null {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let meanDist = 0;
  for (const [x, y] of pts) meanDist += Math.hypot(x - mx, y - my);
  meanDist /= n;
  if (!(meanDist > 0) || !Number.isFinite(meanDist)) return null;
  const s = Math.SQRT2 / meanDist;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

function applyAffine(T: Mat3, p: Point2): Point2 {
  return [T[0] * p[0] + T[1] * p[1] + T[2], T[3] * p[0] + T[4] * p[1] + T[5]];
}

/** Apply H to a 2D point (with the perspective divide). */
export function applyHomography(H: Mat3, p: Point2): Point2 {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

/**
 * Normalised DLT homography from >= 4 correspondences src[i] -> dst[i].
 * Returns null for degenerate input (e.g. three collinear points among four).
 */
export function homographyDLT(src: readonly Point2[], dst: readonly Point2[]): Mat3 | null {
  const n = src.length;
  if (n < 4 || dst.length !== n) return null;
  const Ts = hartleyNormalizer(src);
  const Td = hartleyNormalizer(dst);
  if (!Ts || !Td) return null;
  const s = src.map((p) => applyAffine(Ts, p));
  const d = dst.map((p) => applyAffine(Td, p));

  let h: number[];
  if (n === 4) {
    // Unknowns h11..h32 (h33 = 1):
    //   x h11 + y h12 + h13 - u x h31 - u y h32 = u
    //   x h21 + y h22 + h23 - v x h31 - v y h32 = v
    const A = new Array<number>(64).fill(0);
    const b = new Array<number>(8).fill(0);
    for (let i = 0; i < 4; i++) {
      const [x, y] = s[i];
      const [u, v] = d[i];
      const r0 = 2 * i * 8;
      const r1 = (2 * i + 1) * 8;
      A[r0 + 0] = x; A[r0 + 1] = y; A[r0 + 2] = 1; A[r0 + 6] = -u * x; A[r0 + 7] = -u * y;
      A[r1 + 3] = x; A[r1 + 4] = y; A[r1 + 5] = 1; A[r1 + 6] = -v * x; A[r1 + 7] = -v * y;
      b[2 * i] = u;
      b[2 * i + 1] = v;
    }
    const sol = solveLinear(A, b, 8, 1e-10);
    if (!sol) return null;
    h = [...sol, 1];
  } else {
    // Accumulate A^T A (9x9) for rows
    //   [x y 1 0 0 0 -ux -uy -u] and [0 0 0 x y 1 -vx -vy -v].
    const AtA = new Array<number>(81).fill(0);
    const row = new Array<number>(9);
    const addRow = () => {
      for (let i = 0; i < 9; i++) {
        if (row[i] === 0) continue;
        for (let j = 0; j < 9; j++) AtA[i * 9 + j] += row[i] * row[j];
      }
    };
    for (let i = 0; i < n; i++) {
      const [x, y] = s[i];
      const [u, v] = d[i];
      row[0] = x; row[1] = y; row[2] = 1; row[3] = 0; row[4] = 0; row[5] = 0;
      row[6] = -u * x; row[7] = -u * y; row[8] = -u;
      addRow();
      row[0] = 0; row[1] = 0; row[2] = 0; row[3] = x; row[4] = y; row[5] = 1;
      row[6] = -v * x; row[7] = -v * y; row[8] = -v;
      addRow();
    }
    const { values, vectors } = jacobiEigenSymmetric(AtA, 9);
    // Degenerate if the two smallest eigenvalues are both ~0 (a 2-D null space).
    if (values[1] <= 1e-12 * Math.max(values[8], 1e-300)) return null;
    h = Array.from({ length: 9 }, (_, k) => vectors[k * 9 + 0]);
  }

  const TdInv = inv3(Td);
  if (!TdInv) return null;
  const H = mat3Mul(TdInv, mat3Mul(h, Ts));
  const scale = Math.abs(H[8]) > 1e-12 ? 1 / H[8] : 1 / Math.hypot(...H);
  const out = H.map((x) => x * scale);
  return out.every(Number.isFinite) ? out : null;
}
