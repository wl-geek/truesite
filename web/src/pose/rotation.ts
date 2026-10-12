/**
 * Rotation helpers: rotation vector (axis * angle, radians) <-> matrix,
 * quaternions, and the geodesic angle between two rotations.
 *
 * Quaternions are [x, y, z, w] (the three.js Quaternion order).
 * Matrices are row-major Mat3 (see linalg.ts).
 */
import { type Mat3, type Vec3, mat3Mul, transpose3 } from './linalg';

export type Quat = [number, number, number, number];

/** Rodrigues formula: R = exp([w]x). */
export function rotationFromVector(w: Vec3): Mat3 {
  const th2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
  const th = Math.sqrt(th2);
  let a: number; // sin(th)/th
  let b: number; // (1 - cos(th))/th^2
  if (th < 1e-6) {
    a = 1 - th2 / 6;
    b = 0.5 - th2 / 24;
  } else {
    a = Math.sin(th) / th;
    b = (1 - Math.cos(th)) / th2;
  }
  const [x, y, z] = w;
  return [
    1 - b * (y * y + z * z), -a * z + b * x * y, a * y + b * x * z,
    a * z + b * x * y, 1 - b * (x * x + z * z), -a * x + b * y * z,
    -a * y + b * x * z, a * x + b * y * z, 1 - b * (x * x + y * y),
  ];
}

/** Inverse of rotationFromVector, valid for the whole range [0, pi]. */
export function vectorFromRotation(R: Mat3): Vec3 {
  const tr = R[0] + R[4] + R[8];
  const cosTh = Math.min(1, Math.max(-1, (tr - 1) / 2));
  const th = Math.acos(cosTh);
  const v: Vec3 = [R[7] - R[5], R[2] - R[6], R[3] - R[1]]; // 2 sin(th) * axis
  if (th < 1e-6) return [v[0] / 2, v[1] / 2, v[2] / 2];
  if (Math.PI - th > 1e-4) {
    const k = th / (2 * Math.sin(th));
    return [v[0] * k, v[1] * k, v[2] * k];
  }
  // Near pi: axis from the symmetric part, R + I ~= 2 n n^T.
  const d = [R[0], R[4], R[8]];
  const i = d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2;
  const n: Vec3 = [0, 0, 0];
  n[i] = Math.sqrt(Math.max(0, (d[i] + 1) / 2));
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  n[j] = (R[i * 3 + j] + R[j * 3 + i]) / (4 * n[i]);
  n[k] = (R[i * 3 + k] + R[k * 3 + i]) / (4 * n[i]);
  // Pick the sign consistent with the antisymmetric part (matters when th < pi).
  if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
  const nn = Math.hypot(n[0], n[1], n[2]);
  return [(n[0] / nn) * th, (n[1] / nn) * th, (n[2] / nn) * th];
}

/** Geodesic angle (radians, 0..pi) between two rotations. */
export function rotationAngleBetween(A: Mat3, B: Mat3): number {
  const D = mat3Mul(transpose3(A), B);
  const c = Math.min(1, Math.max(-1, (D[0] + D[4] + D[8] - 1) / 2));
  return Math.acos(c);
}

/** Unit quaternion [x, y, z, w] from a rotation matrix (Shepperd's method). */
export function quatFromRotation(R: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = R;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotation matrix from a quaternion [x, y, z, w] (normalised first). */
export function rotationFromQuat(qIn: Quat): Mat3 {
  const n = Math.hypot(qIn[0], qIn[1], qIn[2], qIn[3]);
  const [x, y, z, w] = [qIn[0] / n, qIn[1] / n, qIn[2] / n, qIn[3] / n];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
