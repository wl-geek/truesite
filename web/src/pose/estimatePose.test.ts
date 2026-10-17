/**
 * End-to-end single-frame pose accuracy on synthetic data:
 * random poses 0.5-3 m, viewing angle 0-60 deg, any roll, code anywhere in a
 * 1280x720 frame (63 deg horizontal FOV), 0.5 px Gaussian corner noise.
 */
import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { estimatePose, isValidQuad, signedAreaPx } from './estimatePose';
import { type Point2, type Vec3, mat3Mul, norm3, sub3 } from './linalg';
import { rotationAngleBetween, rotationFromVector } from './rotation';
import { gaussian, insideImage, makeMarkerPose, noisyCorners, percentile, randomViewDir, rng, uniform } from './testing/synth';

const W = 1280, H = 720;
const K = centredIntrinsics(focalFromHfov(63, W), W, H);
const DEG = 180 / Math.PI;

function run(s: number, dmin: number, dmax: number, overlayPoint: Vec3, seed: number) {
  const r = rng(seed);
  const tErrMm: number[] = [], tErrRel: number[] = [], rErr: number[] = [], rErrPrev: number[] = [], overlayPx: number[] = [];
  let n = 0, failures = 0, flips = 0, flipsPrev = 0;
  const quality = { good: 0, fair: 0, poor: 0 };
  while (n < 1000) {
    const truth = makeMarkerPose({ distance: uniform(r, dmin, dmax), tiltDeg: uniform(r, 0, 60), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir: randomViewDir(r, K, W, H, 150) });
    const img = noisyCorners(K, truth, s, 0.5, r);
    if (!img || !insideImage(img, W, H, 5)) continue;
    n++;
    const est = estimatePose(img, s, K);
    const prev = { R: mat3Mul(rotationFromVector([0.03 * gaussian(r), 0.03 * gaussian(r), 0.03 * gaussian(r)]), truth.R), t: truth.t };
    const estPrev = estimatePose(img, s, K, prev);
    if (!est || !estPrev) { failures++; continue; }
    quality[est.quality]++;
    const dt = norm3(sub3(est.t, truth.t));
    tErrMm.push(dt * 1000);
    tErrRel.push((dt / norm3(truth.t)) * 100);
    const a = rotationAngleBetween(est.R, truth.R) * DEG;
    const b = rotationAngleBetween(estPrev.R, truth.R) * DEG;
    rErr.push(a); rErrPrev.push(b);
    if (a > 10) flips++;
    if (b > 10) flipsPrev++;
    const p0 = projectPoint(K, truth, overlayPoint), p1 = projectPoint(K, est, overlayPoint);
    if (p0 && p1) overlayPx.push(Math.hypot(p0[0] - p1[0], p0[1] - p1[1]));
  }
  return { n, failures, flips, flipsPrev, quality, tErrMm, tErrRel, rErr, rErrPrev, overlayPx };
}

const fmt = (xs: number[]) => `median ${percentile(xs, 50).toFixed(2)}, p90 ${percentile(xs, 90).toFixed(2)}`;

describe('estimatePose end to end', () => {
  it('room anchor: 25 cm code, 0.5-3 m', () => {
    const m = run(0.25, 0.5, 3, [1.0, 0.5, 0.3], 7);
    console.log(`[e2e room] n=${m.n} failures=${m.failures} | translation error mm: ${fmt(m.tErrMm)} | relative %: ${fmt(m.tErrRel)} | rotation deg: ${fmt(m.rErr)}, >10deg ${m.flips} | with prev: ${fmt(m.rErrPrev)}, >10deg ${m.flipsPrev} | overlay px at (1.0,0.5,0.3) m: ${fmt(m.overlayPx)} | quality ${JSON.stringify(m.quality)}`);
    expect(m.failures).toBe(0);
    expect(percentile(m.tErrMm, 50)).toBeLessThan(6);
    expect(percentile(m.tErrRel, 50)).toBeLessThan(0.5);
    expect(percentile(m.rErr, 50)).toBeLessThan(1.0);
    expect(m.flips).toBeLessThan(0.02 * m.n);
    expect(m.flipsPrev).toBeLessThanOrEqual(m.flips);
  });
  it('desk anchor: 12 cm code, 0.3-1.5 m', () => {
    const m = run(0.12, 0.3, 1.5, [0.15, 0.1, 0.05], 8);
    console.log(`[e2e desk] n=${m.n} failures=${m.failures} | translation error mm: ${fmt(m.tErrMm)} | relative %: ${fmt(m.tErrRel)} | rotation deg: ${fmt(m.rErr)}, >10deg ${m.flips} | with prev: ${fmt(m.rErrPrev)}, >10deg ${m.flipsPrev} | overlay px at (0.15,0.1,0.05) m: ${fmt(m.overlayPx)} | quality ${JSON.stringify(m.quality)}`);
    expect(m.failures).toBe(0);
    expect(percentile(m.tErrRel, 50)).toBeLessThan(0.5);
    expect(percentile(m.rErr, 50)).toBeLessThan(1.0);
  });
  it('rejects bad quads: wrong winding (back face / mirrored order) and non-convex', () => {
    const truth = makeMarkerPose({ distance: 1, tiltDeg: 20 });
    const img = markerCorners(0.2).map((X) => projectPoint(K, truth, X)!) as Point2[];
    expect(isValidQuad(img)).toBe(true);
    expect(estimatePose(img, 0.2, K)).not.toBeNull();
    const reversed = [img[0], img[3], img[2], img[1]];
    expect(estimatePose(reversed, 0.2, K)).toBeNull();
    const bowtie = [img[0], img[2], img[1], img[3]];
    expect(estimatePose(bowtie, 0.2, K)).toBeNull();
  });
  it('reports distance, width and quality consistently', () => {
    const truth = makeMarkerPose({ distance: 1.0, tiltDeg: 10 });
    const img = markerCorners(0.25).map((X) => projectPoint(K, truth, X)!) as Point2[];
    const est = estimatePose(img, 0.25, K)!;
    expect(est.distanceM).toBeCloseTo(1.0, 6);
    expect(est.widthPx).toBeGreaterThan(200);
    expect(est.quality).toBe('good');
    expect(est.rmsPx).toBeLessThan(1e-6);
  });
});

describe('estimatePose input checks (mutation-tested)', () => {
  const sq: Point2[] = [[500, 300], [700, 300], [700, 500], [500, 500]]; // TL, TR, BR, BL: clockwise on screen

  it('accepts a convex quad that winds clockwise on screen, and nothing else', () => {
    expect(isValidQuad(sq)).toBe(true);
    expect(isValidQuad([sq[0], sq[3], sq[2], sq[1]])).toBe(false); // mirrored: the code seen from behind
    expect(isValidQuad(sq.slice(0, 3))).toBe(false);
    expect(isValidQuad([...sq, [600, 400]])).toBe(false);
    expect(isValidQuad([sq[0], sq[1], [NaN, 500], sq[3]])).toBe(false);
    expect(isValidQuad([sq[0], [700, Infinity], sq[2], sq[3]])).toBe(false);
    // a dart: each corner in turn pushed inside the quad
    for (let k = 0; k < 4; k++) {
      const dart = sq.map((p) => [...p] as Point2);
      dart[k] = [600 + (sq[k][0] - 600) * -0.2, 400 + (sq[k][1] - 400) * -0.2];
      expect(isValidQuad(dart), `corner ${k} pushed in`).toBe(false);
    }
    expect(isValidQuad([[500, 300], [600, 300], [700, 300], [500, 500]])).toBe(false); // three in a row
  });

  it('returns null for a bad quad or a code size that is not positive', () => {
    const truth = makeTruth();
    const img = markerCorners(0.2).map((X) => projectPoint(K, truth, X)!) as Point2[];
    expect(estimatePose(img, 0.2, K)).not.toBeNull();
    expect(estimatePose([img[0], img[3], img[2], img[1]], 0.2, K)).toBeNull();
    for (const s of [0, -0.2, NaN]) expect(estimatePose(img, s, K), String(s)).toBeNull();
  });

  it('passes maxIterations on to the refinement', () => {
    const truth = makeTruth();
    const img = markerCorners(0.2).map((X) => projectPoint(K, truth, X)!).map(([u, v], i) => [u + (i % 2 ? 0.7 : -0.6), v + (i < 2 ? 0.5 : -0.4)] as Point2);
    expect(estimatePose(img, 0.2, K, null, { maxIterations: 0 })!.iterations).toBe(0);
    expect(estimatePose(img, 0.2, K)!.iterations).toBeGreaterThan(0);
  });

  function makeTruth() {
    return { R: mat3Mul(rotationFromVector([Math.PI, 0, 0]), rotationFromVector([0.35, 0.2, 0.1])), t: [0.05, -0.03, 0.8] as Vec3 };
  }
});

describe('signedAreaPx (mutation-tested)', () => {
  it('is positive for a clockwise-on-screen polygon and gives its area', () => {
    expect(signedAreaPx([[0, 0], [100, 0], [100, 50], [0, 50]])).toBe(5000);
    expect(signedAreaPx([[0, 0], [0, 50], [100, 50], [100, 0]])).toBe(-5000);
    expect(signedAreaPx([[10, 10], [40, 10], [10, 30]])).toBe(300);
    expect(signedAreaPx([])).toBe(0);
  });
});
