import { describe, expect, it } from 'vitest';
import { det3, mat3Mul, transpose3 } from './linalg';
import { OneEuroFilter, type OneEuroParams, OneEuroQuaternion, OneEuroVector, PoseSmoother } from './oneEuro';
import { type Quat, quatFromRotation, rotationAngleBetween, rotationFromQuat, rotationFromVector } from './rotation';
import { gaussian, rng } from './testing/synth';

const FPS = 30;
const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
// Translation-like parameters (metres): jitter at rest ~2 mm, motions ~0.1-1 m/s.
const P: OneEuroParams = { minCutoff: 1.0, beta: 20, dCutoff: 1.0 };
const EMA: OneEuroParams = { minCutoff: 1.0, beta: 0, dCutoff: 1.0 }; // same rest cutoff, no speed adaptation

function framesTo90(params: OneEuroParams, step: number) {
  const f = new OneEuroFilter(params);
  for (let i = 0; i < 30; i++) f.filter(0, i / FPS);
  for (let k = 0; k < 300; k++) {
    if (f.filter(step, (30 + k) / FPS) >= 0.9 * step) return k + 1;
  }
  return Infinity;
}

describe('OneEuroFilter (scalar)', () => {
  it('reduces jitter at rest', () => {
    const r = rng(60);
    const f = new OneEuroFilter(P);
    const raw: number[] = [], out: number[] = [];
    for (let i = 0; i < 600; i++) {
      const x = 1.5 + 0.002 * gaussian(r);
      const y = f.filter(x, i / FPS);
      if (i > 60) { raw.push(x); out.push(y); }
    }
    const ratio = std(out) / std(raw);
    console.log(`[1euro] jitter at rest: std ratio filtered/raw = ${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThan(0.45);
  });
  it('follows a step much faster than a plain low-pass with the same rest cutoff', () => {
    const one = framesTo90(P, 0.1);
    const ema = framesTo90(EMA, 0.1);
    console.log(`[1euro] 10 cm step at 30 fps: frames to 90% -> One Euro ${one}, plain EMA ${ema}`);
    expect(one).toBeLessThanOrEqual(3);
    expect(ema).toBeGreaterThan(10);
  });
  it('small lag on a constant-velocity ramp', () => {
    const run = (p: OneEuroParams) => {
      const f = new OneEuroFilter(p);
      let lag = 0;
      for (let i = 0; i < 90; i++) { const x = 0.5 * (i / FPS); lag = x - f.filter(x, i / FPS); }
      return lag;
    };
    const one = run(P), ema = run(EMA);
    console.log(`[1euro] 0.5 m/s ramp: steady lag One Euro ${(one * 1000).toFixed(1)} mm, plain EMA ${(ema * 1000).toFixed(1)} mm`);
    expect(one).toBeLessThan(ema / 5);
  });
  it('ignores non-increasing timestamps and resets after a gap', () => {
    const f = new OneEuroFilter(P);
    f.filter(0, 0);
    f.filter(0, 1 / FPS);
    expect(f.filter(5, 1 / FPS)).toBe(0); // dt = 0: ignored
    expect(f.filter(5, 2)).toBe(5); // gap > 0.5 s: reset
  });
});

describe('OneEuroVector', () => {
  it('reduces 3-D jitter (one cutoff driven by the 3-D speed)', () => {
    const r = rng(61);
    const f = new OneEuroVector(P);
    const errRaw: number[] = [], errOut: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = [0.2 + 0.002 * gaussian(r), -0.1 + 0.002 * gaussian(r), 1.5 + 0.002 * gaussian(r)];
      const y = f.filter(x, i / FPS);
      if (i > 60) { errRaw.push(Math.hypot(x[0] - 0.2, x[1] + 0.1, x[2] - 1.5)); errOut.push(Math.hypot(y[0] - 0.2, y[1] + 0.1, y[2] - 1.5)); }
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const ratio = mean(errOut) / mean(errRaw);
    console.log(`[1euro] 3-D jitter 2 mm/axis: mean error ratio filtered/raw = ${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThan(0.55);
  });
  it('keeps the direction of a step (shared alpha across components)', () => {
    const f = new OneEuroVector(P);
    for (let i = 0; i < 30; i++) f.filter([0, 0, 1], i / FPS);
    for (let k = 0; k < 5; k++) {
      const y = f.filter([0.1, 0.05, 1], (30 + k) / FPS);
      expect(y[1] / y[0]).toBeCloseTo(0.5, 12);
      expect(y[2]).toBeCloseTo(1, 12);
    }
  });
});

describe('OneEuroQuaternion', () => {
  const RP: OneEuroParams = { minCutoff: 1.0, beta: 2, dCutoff: 1.0 }; // radians
  it('reduces rotational jitter and stays unit length', () => {
    const r = rng(62);
    const R0 = rotationFromVector([0.3, -0.2, 0.1]);
    const f = new OneEuroQuaternion(RP);
    const raw: number[] = [], out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const sigma = (0.5 * Math.PI) / 180; // 0.5 deg jitter per axis
      const Rn = mat3Mul(rotationFromVector([sigma * gaussian(r), sigma * gaussian(r), sigma * gaussian(r)]), R0);
      const q = f.filter(quatFromRotation(Rn), i / FPS);
      expect(Math.hypot(...q)).toBeCloseTo(1, 12);
      if (i > 60) { raw.push(rotationAngleBetween(Rn, R0)); out.push(rotationAngleBetween(rotationFromQuat(q), R0)); }
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const ratio = mean(out) / mean(raw);
    console.log(`[1euro] rotation jitter 0.5 deg/axis: mean angular error ratio filtered/raw = ${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThan(0.45);
  });
  it('sign continuity: q and -q inputs give a steady output', () => {
    const R0 = rotationFromVector([0.1, 2.0, -0.4]);
    const q0 = quatFromRotation(R0);
    const f = new OneEuroQuaternion(RP);
    let last: Quat = f.filter(q0, 0);
    for (let i = 1; i < 60; i++) {
      const qi: Quat = i % 2 ? [-q0[0], -q0[1], -q0[2], -q0[3]] : q0;
      last = f.filter(qi, i / FPS);
      expect(rotationAngleBetween(rotationFromQuat(last), R0)).toBeLessThan(1e-9);
    }
  });
  it('follows a 30 deg rotation step within a few frames', () => {
    const R0 = rotationFromVector([0, 0, 0]);
    const R1 = rotationFromVector([0, (30 * Math.PI) / 180, 0]);
    const f = new OneEuroQuaternion(RP);
    for (let i = 0; i < 30; i++) f.filter(quatFromRotation(R0), i / FPS);
    let k = 0;
    for (; k < 100; k++) {
      const q = f.filter(quatFromRotation(R1), (30 + k) / FPS);
      if (rotationAngleBetween(rotationFromQuat(q), R1) < 0.1 * (30 * Math.PI) / 180) break;
    }
    console.log(`[1euro] 30 deg rotation step: frames to 90% = ${k + 1}`);
    expect(k + 1).toBeLessThanOrEqual(4);
  });
});

describe('PoseSmoother', () => {
  it('returns a proper rotation and smooths translation', () => {
    const r = rng(63);
    const sm = new PoseSmoother();
    const R0 = rotationFromVector([0.2, 0.1, -0.3]);
    let out = sm.filter({ R: R0, t: [0, 0, 1] }, 0);
    for (let i = 1; i < 120; i++) {
      out = sm.filter({ R: mat3Mul(rotationFromVector([0.01 * gaussian(r), 0.01 * gaussian(r), 0.01 * gaussian(r)]), R0), t: [0.002 * gaussian(r), 0.002 * gaussian(r), 1 + 0.002 * gaussian(r)] }, i / FPS);
    }
    const I = mat3Mul(transpose3(out.R), out.R);
    expect(Math.abs(I[0] - 1) + Math.abs(I[1]) + Math.abs(I[4] - 1) + Math.abs(I[8] - 1)).toBeLessThan(1e-12);
    expect(det3(out.R)).toBeCloseTo(1, 12);
    expect(Math.abs(out.t[2] - 1)).toBeLessThan(0.003);
  });
});
