import { describe, expect, it } from 'vitest';
import {
  type Mat3, det3, inv3, jacobiEigenSymmetric, mat3Mul, nearestRotation, solveLinear, svd3, transpose3,
} from './linalg';
import { rotationFromVector } from './rotation';
import { gaussian, rng } from './testing/synth';

const maxAbsDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const diag3 = (s: number[]): Mat3 => [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]];

describe('solveLinear (Gaussian elimination, partial pivoting)', () => {
  it('solves a system that needs pivoting (zero leading entry)', () => {
    const A = [0, 2, 1, 1, 1, 1, 2, 1, 0];
    const x = solveLinear(A, [5, 4, 4], 3)!;
    expect(maxAbsDiff(x, [1, 2, 1])).toBeLessThan(1e-12);
  });
  it('returns null for a singular matrix', () => {
    expect(solveLinear([1, 2, 2, 4], [1, 2], 2)).toBeNull();
  });
  it('solves random 8x8 systems to near machine precision', () => {
    const r = rng(1);
    for (let k = 0; k < 20; k++) {
      const A = Array.from({ length: 64 }, () => gaussian(r));
      const x0 = Array.from({ length: 8 }, () => gaussian(r));
      const b = Array.from({ length: 8 }, (_, i) => x0.reduce((s, xj, j) => s + A[i * 8 + j] * xj, 0));
      const x = solveLinear(A, b, 8)!;
      expect(maxAbsDiff(x, x0)).toBeLessThan(1e-9);
    }
  });
});

describe('jacobiEigenSymmetric', () => {
  it('diagonalises a random symmetric 9x9 matrix', () => {
    const r = rng(2);
    const n = 9;
    const B = Array.from({ length: n * n }, () => gaussian(r));
    const A = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) A[i * n + j] += B[k * n + i] * B[k * n + j];
    const { values, vectors } = jacobiEigenSymmetric(A, n);
    for (let j = 0; j < n; j++) {
      // A v = lambda v
      for (let i = 0; i < n; i++) {
        let av = 0;
        for (let k = 0; k < n; k++) av += A[i * n + k] * vectors[k * n + j];
        expect(Math.abs(av - values[j] * vectors[i * n + j])).toBeLessThan(1e-9);
      }
    }
    for (let j = 1; j < n; j++) expect(values[j]).toBeGreaterThanOrEqual(values[j - 1]);
  });
});

describe('svd3 / nearestRotation', () => {
  it('reconstructs random matrices with orthogonal U, V and sorted singular values', () => {
    const r = rng(3);
    for (let k = 0; k < 200; k++) {
      const A = Array.from({ length: 9 }, () => gaussian(r));
      const { U, S, V } = svd3(A);
      const rec = mat3Mul(U, mat3Mul(diag3(S), transpose3(V)));
      expect(maxAbsDiff(rec, A)).toBeLessThan(1e-12);
      expect(maxAbsDiff(mat3Mul(transpose3(U), U), diag3([1, 1, 1]))).toBeLessThan(1e-12);
      expect(maxAbsDiff(mat3Mul(transpose3(V), V), diag3([1, 1, 1]))).toBeLessThan(1e-12);
      expect(S[0]).toBeGreaterThanOrEqual(S[1]);
      expect(S[1]).toBeGreaterThanOrEqual(S[2]);
      expect(S[2]).toBeGreaterThanOrEqual(0);
    }
  });
  it('handles rank-deficient input', () => {
    const A = [1, 2, 3, 2, 4, 6, 1, 1, 1]; // rank 2
    const { U, S, V } = svd3(A);
    expect(S[2]).toBeLessThan(1e-12);
    expect(maxAbsDiff(mat3Mul(U, mat3Mul(diag3(S), transpose3(V))), A)).toBeLessThan(1e-12);
    expect(Math.abs(Math.abs(det3(U)) - 1)).toBeLessThan(1e-12);
  });
  it('nearestRotation returns R exactly for R * (symmetric positive definite) and is a proper rotation', () => {
    const r = rng(4);
    for (let k = 0; k < 100; k++) {
      const R0 = rotationFromVector([gaussian(r), gaussian(r), gaussian(r)]);
      const Pm: Mat3 = [1.2, 0.1, -0.05, 0.1, 0.9, 0.02, -0.05, 0.02, 1.05]; // SPD
      const R = nearestRotation(mat3Mul(R0, Pm));
      expect(maxAbsDiff(R, R0)).toBeLessThan(1e-12);
      // Noisy near-rotation -> proper rotation close to R0.
      const noisy = R0.map((x) => x + 0.01 * gaussian(r));
      const Rn = nearestRotation(noisy);
      expect(maxAbsDiff(mat3Mul(transpose3(Rn), Rn), diag3([1, 1, 1]))).toBeLessThan(1e-12);
      expect(det3(Rn)).toBeCloseTo(1, 12);
      expect(maxAbsDiff(Rn, R0)).toBeLessThan(0.05);
    }
  });
  it('nearestRotation fixes a reflection to det +1', () => {
    const Rn = nearestRotation(diag3([1, 1, -1]));
    expect(det3(Rn)).toBeCloseTo(1, 12);
  });
  it('inv3 inverts', () => {
    const A = [2, 1, 0, 0, 3, 1, 1, 0, 4];
    expect(maxAbsDiff(mat3Mul(A, inv3(A)!), diag3([1, 1, 1]))).toBeLessThan(1e-14);
  });
});
