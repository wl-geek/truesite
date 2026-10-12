import { describe, expect, it } from 'vitest';
import { applyHomography, homographyDLT } from './homography';
import { type Mat3, type Point2 } from './linalg';
import { gaussian, rng, uniform } from './testing/synth';

const Htrue: Mat3 = [820, -35, 640, 40, -790, 360, 0.08, -0.12, 1];

describe('homographyDLT', () => {
  it('recovers H exactly from 4 points (8x8 solve)', () => {
    const src: Point2[] = [[-0.1, 0.1], [0.1, 0.1], [0.1, -0.1], [-0.1, -0.1]];
    const dst = src.map((p) => applyHomography(Htrue, p));
    const H = homographyDLT(src, dst)!;
    for (let i = 0; i < 9; i++) expect(H[i]).toBeCloseTo(Htrue[i], 6);
  });
  it('least squares with many noisy points beats the noise level', () => {
    const r = rng(5);
    const src: Point2[] = Array.from({ length: 40 }, () => [uniform(r, -0.2, 0.2), uniform(r, -0.2, 0.2)]);
    const dst = src.map((p) => {
      const q = applyHomography(Htrue, p);
      return [q[0] + 0.5 * gaussian(r), q[1] + 0.5 * gaussian(r)] as Point2;
    });
    const H = homographyDLT(src, dst)!;
    // Mean mapping error on a grid vs the truth: below the per-point noise
    // (0.5 px per axis = 0.71 px Euclidean). Grid corners extrapolate, so use the mean.
    let sum = 0, n = 0;
    for (let x = -0.2; x <= 0.2001; x += 0.05) {
      for (let y = -0.2; y <= 0.2001; y += 0.05) {
        const a = applyHomography(H, [x, y]);
        const b = applyHomography(Htrue, [x, y]);
        sum += Math.hypot(a[0] - b[0], a[1] - b[1]);
        n++;
      }
    }
    expect(sum / n).toBeLessThan(0.4);
  });
  it('the >4-point path equals the 4-point path on exact data', () => {
    const src: Point2[] = [[-0.1, 0.1], [0.1, 0.1], [0.1, -0.1], [-0.1, -0.1], [0, 0], [0.05, -0.02]];
    const dst = src.map((p) => applyHomography(Htrue, p));
    const H = homographyDLT(src, dst)!;
    for (let i = 0; i < 9; i++) expect(H[i]).toBeCloseTo(Htrue[i], 5);
  });
  it('rejects degenerate input (3 collinear of 4)', () => {
    const src: Point2[] = [[0, 0], [1, 0], [2, 0], [0, 1]];
    const dst: Point2[] = [[0, 0], [1, 0], [2, 0], [0, 1]].map(([x, y]) => [x * 3 + 1, y * 3 + 2] as Point2);
    expect(homographyDLT(src, dst)).toBeNull();
  });
});
