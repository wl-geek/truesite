import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { type Point2, mat3Mul, norm3, sub3 } from './linalg';
import { refinePose } from './refinePose';
import { rotationAngleBetween, rotationFromVector } from './rotation';
import { makeMarkerPose, noisyCorners, rng, uniform } from './testing/synth';

const W = 1280, H = 720;
const K = centredIntrinsics(focalFromHfov(63, W), W, H);

describe('refinePose (Levenberg-Marquardt)', () => {
  it('converges from a perturbed start to the exact pose on noise-free data', () => {
    const r = rng(30);
    for (let k = 0; k < 50; k++) {
      const truth = makeMarkerPose({ distance: uniform(r, 0.5, 3), tiltDeg: uniform(r, 0, 60), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180) });
      const obj = markerCorners(0.25);
      const img = obj.map((X) => projectPoint(K, truth, X)!) as Point2[];
      const init = {
        R: mat3Mul(rotationFromVector([uniform(r, -0.08, 0.08), uniform(r, -0.08, 0.08), uniform(r, -0.08, 0.08)]), truth.R),
        t: [truth.t[0] + 0.03, truth.t[1] - 0.02, truth.t[2] * 1.05] as [number, number, number],
      };
      const p = refinePose(init, obj, img, K);
      expect(p.rmsPx).toBeLessThan(1e-6);
      expect(rotationAngleBetween(p.R, truth.R)).toBeLessThan(1e-6);
      expect(norm3(sub3(p.t, truth.t))).toBeLessThan(1e-6);
    }
  });
  it('with 0.5 px noise the RMS settles near the noise floor (4 points, 6 dof: E[rms] ~ 0.5 * sigma)', () => {
    const r = rng(31);
    const rms: number[] = [];
    for (let k = 0; k < 300; k++) {
      const truth = makeMarkerPose({ distance: uniform(r, 0.5, 1.5), tiltDeg: uniform(r, 0, 45), tiltAzDeg: uniform(r, 0, 360) });
      const obj = markerCorners(0.25);
      const img = noisyCorners(K, truth, 0.25, 0.5, r)!;
      rms.push(refinePose(truth, obj, img, K).rmsPx);
    }
    const meanSq = rms.reduce((s, x) => s + x * x, 0) / rms.length;
    // 8 residuals - 6 params = 2 dof: E[SSE] = 2 sigma^2, rms^2 = SSE / 4 -> sigma^2 / 2.
    expect(Math.sqrt(meanSq)).toBeGreaterThan(0.5 * Math.SQRT1_2 * 0.8);
    expect(Math.sqrt(meanSq)).toBeLessThan(0.5 * Math.SQRT1_2 * 1.2);
  });
});
