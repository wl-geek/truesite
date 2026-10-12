import { describe, expect, it } from 'vitest';
import { det3, mat3Mul, transpose3 } from './linalg';
import { quatFromRotation, rotationAngleBetween, rotationFromQuat, rotationFromVector, vectorFromRotation } from './rotation';
import { gaussian, rng } from './testing/synth';

const maxAbsDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

describe('rotation vector <-> matrix', () => {
  it('round-trips over the full angle range, including near 0 and near pi', () => {
    const r = rng(10);
    const angles = [0, 1e-9, 1e-5, 0.3, 1.5, 3.0, Math.PI - 1e-3, Math.PI - 1e-6];
    for (const th of angles) {
      for (let k = 0; k < 20; k++) {
        const a = [gaussian(r), gaussian(r), gaussian(r)];
        const n = Math.hypot(a[0], a[1], a[2]);
        const w: [number, number, number] = [(a[0] / n) * th, (a[1] / n) * th, (a[2] / n) * th];
        const R = rotationFromVector(w);
        expect(det3(R)).toBeCloseTo(1, 12);
        expect(maxAbsDiff(mat3Mul(transpose3(R), R), [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeLessThan(1e-12);
        const R2 = rotationFromVector(vectorFromRotation(R));
        expect(maxAbsDiff(R2, R)).toBeLessThan(1e-6);
      }
    }
  });
  it('angle between rotations', () => {
    const A = rotationFromVector([0.1, 0.2, 0.3]);
    const B = mat3Mul(A, rotationFromVector([0, 0, 0.25]));
    expect(rotationAngleBetween(A, B)).toBeCloseTo(0.25, 12);
  });
  it('quaternion round trip', () => {
    const r = rng(11);
    for (let k = 0; k < 100; k++) {
      const R = rotationFromVector([2 * gaussian(r), 2 * gaussian(r), 2 * gaussian(r)]);
      expect(maxAbsDiff(rotationFromQuat(quatFromRotation(R)), R)).toBeLessThan(1e-12);
    }
  });
});
