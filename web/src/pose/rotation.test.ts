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

describe('rotation edge cases (mutation-tested)', () => {
  const close = (a: readonly number[], b: readonly number[], tol: number) => expect(maxAbsDiff([...a], [...b])).toBeLessThan(tol);

  it('round-trips rotation vectors below the small-angle switch exactly', () => {
    for (const w of [[1e-7, 2e-7, -3e-7], [-4e-8, 0, 9e-8]] as [number, number, number][]) {
      close(vectorFromRotation(rotationFromVector(w)), w, 1e-15);
    }
  });

  it('round-trips rotations within 1e-4 rad of a half turn, about each axis and a diagonal', () => {
    const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0, 0.8], [0, -0.8, 0.6], [0.48, 0.6, -0.64]];
    for (const a of axes) {
      for (const th of [Math.PI - 5e-5, Math.PI - 1e-6]) {
        const w = a.map((x) => x * th) as [number, number, number];
        close(vectorFromRotation(rotationFromVector(w)), w, 1e-6);
      }
    }
  });

  it('turns every rotation into the quaternion three.js would give (up to sign), on every branch', async () => {
    const { Matrix4, Quaternion } = await import('three');
    const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.6, 0.8, 0], [0, 0.6, -0.8], [0.48, -0.6, 0.64]];
    for (const a of axes) {
      for (const th of [0.3, 2.2, 3.0, Math.PI - 1e-3, Math.PI]) {
        const R = rotationFromVector(a.map((x) => x * th) as [number, number, number]);
        const q = quatFromRotation(R);
        const m = new Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
        const t = new Quaternion().setFromRotationMatrix(m);
        const s = Math.sign(q[0] * t.x + q[1] * t.y + q[2] * t.z + q[3] * t.w) || 1;
        close(q, [t.x * s, t.y * s, t.z * s, t.w * s], 1e-9);
        close(rotationFromQuat(q), R, 1e-12);
      }
    }
  });

  it('normalises: a scaled rotation gives a unit quaternion, a scaled quaternion a rotation', () => {
    const R = rotationFromVector([0.3, -1.2, 2.5]).map((x) => x * 1.02);
    const q = quatFromRotation(R);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    close(rotationFromQuat([0, 0, 2, 0]), [-1, 0, 0, 0, -1, 0, 0, 0, 1], 1e-15);
    close(rotationFromQuat([0, 0, 0, 3]), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-15);
  });
});
