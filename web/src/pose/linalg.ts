/**
 * Small dense linear algebra for the pose pipeline. No dependencies, no DOM.
 *
 * Storage conventions used everywhere in src/pose:
 *  - Vec3 = [x, y, z]; Point2 = [u, v].
 *  - Mat3 = 9 numbers, ROW-MAJOR: m[r * 3 + c].
 *  - General n x n matrices are row-major number[] with an explicit n.
 *  - Only the 16-number outputs meant for three.js (projection.ts,
 *    modelMatrix.ts) are column-major, and they say so.
 */
export type Vec3 = [number, number, number];
export type Point2 = [number, number];
export type Mat3 = number[];

export const identity3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, i: number,
): Mat3 {
  return [a, b, c, d, e, f, g, h, i];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export function mat3MulVec(a: Mat3, v: Vec3): Vec3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

export function transpose3(a: Mat3): Mat3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function det3(a: Mat3): number {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}

export function inv3(a: Mat3): Mat3 | null {
  const d = det3(a);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-300) return null;
  const id = 1 / d;
  return [
    (a[4] * a[8] - a[5] * a[7]) * id,
    (a[2] * a[7] - a[1] * a[8]) * id,
    (a[1] * a[5] - a[2] * a[4]) * id,
    (a[5] * a[6] - a[3] * a[8]) * id,
    (a[0] * a[8] - a[2] * a[6]) * id,
    (a[2] * a[3] - a[0] * a[5]) * id,
    (a[3] * a[7] - a[4] * a[6]) * id,
    (a[1] * a[6] - a[0] * a[7]) * id,
    (a[0] * a[4] - a[1] * a[3]) * id,
  ];
}

export function scaleMat3(a: Mat3, s: number): Mat3 {
  return a.map((x) => x * s);
}

/** Column j of a row-major Mat3. */
export function col3(m: Mat3, j: number): Vec3 {
  return [m[j], m[3 + j], m[6 + j]];
}

/** Build a row-major Mat3 from three column vectors. */
export function fromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const norm3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize3(a: Vec3): Vec3 {
  const n = norm3(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/**
 * Solve A x = b for square A (row-major n x n) by Gaussian elimination with
 * partial pivoting. Inputs are not modified. Returns null if A is singular
 * (pivot below `singularTol` relative to the largest entry of A).
 */
export function solveLinear(A: ArrayLike<number>, b: ArrayLike<number>, n: number, singularTol = 1e-12): number[] | null {
  const M = Array.from(A);
  const x = Array.from(b);
  let maxAbs = 0;
  for (let i = 0; i < n * n; i++) maxAbs = Math.max(maxAbs, Math.abs(M[i]));
  if (!(maxAbs > 0) || !Number.isFinite(maxAbs)) return null;
  const tol = singularTol * maxAbs;
  for (let k = 0; k < n; k++) {
    // Partial pivoting: largest |entry| in column k at or below row k.
    let p = k;
    let best = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > best) { best = v; p = i; }
    }
    if (best <= tol) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = M[k * n + j]; M[k * n + j] = M[p * n + j]; M[p * n + j] = tmp;
      }
      const tb = x[k]; x[k] = x[p]; x[p] = tb;
    }
    const pivot = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const factor = M[i * n + k] / pivot;
      if (factor === 0) continue;
      M[i * n + k] = 0;
      for (let j = k + 1; j < n; j++) M[i * n + j] -= factor * M[k * n + j];
      x[i] -= factor * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Cyclic Jacobi eigen-decomposition of a real symmetric n x n matrix.
 * Returns eigenvalues in ASCENDING order and the matching eigenvectors as the
 * COLUMNS of `vectors` (row-major n x n): vectors[k * n + j] is component k of
 * eigenvector j.
 */
export function jacobiEigenSymmetric(Ain: ArrayLike<number>, n: number, maxSweeps = 60): { values: number[]; vectors: number[] } {
  const A = Array.from(Ain);
  const V = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    let diag = 0;
    for (let p = 0; p < n; p++) {
      diag += A[p * n + p] * A[p * n + p];
      for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    }
    if (off <= 1e-30 * (diag + 1e-300)) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p];
        const aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        // A <- A P (columns p, q)
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p];
          const akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        // A <- P^T A (rows p, q)
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k];
          const aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        // V <- V P
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p];
          const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i * n + i] - A[j * n + j]);
  const values = order.map((i) => A[i * n + i]);
  const vectors = new Array<number>(n * n);
  for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) vectors[k * n + j] = V[k * n + order[j]];
  return { values, vectors };
}

/**
 * SVD of a 3x3 matrix by one-sided (Hestenes) Jacobi: A = U diag(S) V^T with
 * S descending and non-negative, U and V orthogonal (det may be -1).
 * Accurate for the near-rotation matrices used here and robust to rank loss
 * (missing columns of U are completed with cross products).
 */
export function svd3(A: Mat3): { U: Mat3; S: Vec3; V: Mat3 } {
  // Work on columns of W = A (W[k][j]); rotate column pairs until orthogonal.
  const W = A.slice();
  const V = identity3();
  for (let sweep = 0; sweep < 30; sweep++) {
    let rotated = false;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        let alpha = 0, beta = 0, gamma = 0;
        for (let k = 0; k < 3; k++) {
          const wp = W[k * 3 + p];
          const wq = W[k * 3 + q];
          alpha += wp * wp; beta += wq * wq; gamma += wp * wq;
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let k = 0; k < 3; k++) {
          const wp = W[k * 3 + p];
          const wq = W[k * 3 + q];
          W[k * 3 + p] = c * wp - s * wq;
          W[k * 3 + q] = s * wp + c * wq;
          const vp = V[k * 3 + p];
          const vq = V[k * 3 + q];
          V[k * 3 + p] = c * vp - s * vq;
          V[k * 3 + q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }
  const sig = [0, 1, 2].map((j) => Math.hypot(W[j], W[3 + j], W[6 + j]));
  const order = [0, 1, 2].sort((i, j) => sig[j] - sig[i]);
  const S: Vec3 = [sig[order[0]], sig[order[1]], sig[order[2]]];
  const Vs = fromColumns(col3(V, order[0]), col3(V, order[1]), col3(V, order[2]));
  const scaleRef = S[0] > 0 ? S[0] : 1;
  const u: Vec3[] = [];
  for (let j = 0; j < 3; j++) {
    const c = col3(W, order[j]);
    if (S[j] > 1e-13 * scaleRef) u.push(scale3(c, 1 / S[j]));
    else if (j === 0) u.push([1, 0, 0]);
    else if (j === 1) {
      // any unit vector orthogonal to u0
      const a: Vec3 = Math.abs(u[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      u.push(normalize3(cross3(u[0], a)));
    } else u.push(normalize3(cross3(u[0], u[1])));
  }
  return { U: fromColumns(u[0], u[1], u[2]), S, V: Vs };
}

/**
 * Closest rotation (Frobenius norm) to A: R = U diag(1, 1, det(U V^T)) V^T.
 * This is the orthogonal polar factor with the determinant forced to +1.
 */
export function nearestRotation(A: Mat3): Mat3 {
  const { U, V } = svd3(A);
  const d = det3(U) * det3(V) < 0 ? -1 : 1;
  const Ud = fromColumns(col3(U, 0), col3(U, 1), scale3(col3(U, 2), d));
  return mat3Mul(Ud, transpose3(V));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}
