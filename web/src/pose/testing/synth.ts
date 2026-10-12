/**
 * Synthetic cameras, poses and noisy corners for the pose tests.
 * Deterministic: everything takes a seeded PRNG.
 */
import { type Intrinsics, type Pose, markerCorners, projectPoint } from '../camera';
import { type Mat3, type Point2, type Vec3, cross3, fromColumns, mat3Mul, normalize3, scale3 } from '../linalg';
import { rotationFromVector } from '../rotation';

/** mulberry32: small, fast, deterministic PRNG returning [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const uniform = (r: () => number, a: number, b: number): number => a + (b - a) * r();

/**
 * A marker pose seen by the camera:
 *  - the code centre is at `distance` along the unit ray `dir` (camera frame);
 *  - its normal makes `tiltDeg` with the direction back to the camera, tilted
 *    about an axis perpendicular to that line of sight at angle `tiltAzDeg`;
 *  - `rollDeg` rotates the code about its own normal.
 * tiltDeg = 0 means the code faces the camera squarely.
 */
export function makeMarkerPose(opts: {
  distance: number;
  dir?: Vec3;
  tiltDeg: number;
  tiltAzDeg?: number;
  rollDeg?: number;
}): Pose {
  const d = normalize3(opts.dir ?? [0, 0, 1]);
  const t = scale3(d, opts.distance);
  // Base frame: marker z points back at the camera (-d); marker y roughly
  // "up" in the image (camera -y), x completes a right-handed frame.
  const z0 = scale3(d, -1);
  let y0 = normalize3(cross3(z0, [1, 0, 0]));
  if (y0[1] > 0) y0 = scale3(y0, -1);
  const x0 = cross3(y0, z0);
  const base = fromColumns(x0, y0, z0);
  const deg = Math.PI / 180;
  const roll = rotationFromVector([0, 0, (opts.rollDeg ?? 0) * deg]);
  const az = (opts.tiltAzDeg ?? 0) * deg;
  const tilt = rotationFromVector([Math.cos(az) * opts.tiltDeg * deg, Math.sin(az) * opts.tiltDeg * deg, 0]);
  // R = base * tilt * roll : roll about the code normal, tilt about an
  // in-plane axis, then place in the camera frame.
  const R: Mat3 = mat3Mul(base, mat3Mul(tilt, roll));
  return { R, t };
}

/** Project the 4 corners of a code of side s, adding N(0, sigma^2) px noise per coordinate. */
export function noisyCorners(K: Intrinsics, pose: Pose, s: number, sigma: number, r: () => number): Point2[] | null {
  const out: Point2[] = [];
  for (const X of markerCorners(s)) {
    const p = projectPoint(K, pose, X);
    if (!p) return null;
    out.push([p[0] + sigma * gaussian(r), p[1] + sigma * gaussian(r)]);
  }
  return out;
}

export function insideImage(pts: readonly Point2[], W: number, H: number, margin = 0): boolean {
  return pts.every(([u, v]) => u >= margin && v >= margin && u <= W - margin && v <= H - margin);
}

/** Random unit direction inside the camera's field of view (with a margin). */
export function randomViewDir(r: () => number, K: Intrinsics, W: number, H: number, marginPx: number): Vec3 {
  const u = uniform(r, marginPx, W - marginPx);
  const v = uniform(r, marginPx, H - marginPx);
  return normalize3([(u - K.cx) / K.f, (v - K.cy) / K.f, 1]);
}

export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
