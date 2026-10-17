/**
 * Planar ambiguity ("flip") tests. A 12 cm code (the Letter desk sheet) seen at
 * 1.5-3 m with 15-40 deg tilt and 0.5 px corner noise is small in the image
 * (~40-85 px), so its two IPPE poses reproject almost equally well.
 */
import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { type PoseEstimate, estimatePose } from './estimatePose';
import { homographyDLT } from './homography';
import { type Point2, mat3Mul } from './linalg';
import { chooseCandidate, facesCamera, ippeCandidates } from './planarPose';
import { poseFromHomography } from './poseFromHomography';
import { refinePose } from './refinePose';
import { rotationAngleBetween, rotationFromVector } from './rotation';
import { gaussian, makeMarkerPose, noisyCorners, rng, uniform } from './testing/synth';

const W = 1280, H = 720;
const K = centredIntrinsics(focalFromHfov(63, W), W, H);
const DEG = 180 / Math.PI;
const FLIP_DEG = 10;

describe('IPPE candidates', () => {
  it('noise-free: one candidate is exact, the other is the mirror-tilted pose, both face the camera', () => {
    const r = rng(40);
    for (let k = 0; k < 100; k++) {
      const truth = makeMarkerPose({ distance: uniform(r, 0.5, 3), tiltDeg: uniform(r, 5, 60), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir: [uniform(r, -0.3, 0.3), uniform(r, -0.2, 0.2), 1] });
      const s = 0.25;
      const obj = markerCorners(s);
      const img = obj.map((X) => projectPoint(K, truth, X)!) as Point2[];
      const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!;
      const cands = ippeCandidates(Hm, K, obj, img);
      expect(cands.length).toBe(2);
      const errs = cands.map((c) => rotationAngleBetween(c.R, truth.R));
      expect(Math.min(...errs)).toBeLessThan(1e-7);
      expect(Math.max(...errs)).toBeGreaterThan(1e-3); // distinct second solution
      for (const c of cands) expect(facesCamera(c)).toBe(true);
      const exact = cands[errs[0] < errs[1] ? 0 : 1];
      for (let i = 0; i < 3; i++) expect(exact.t[i]).toBeCloseTo(truth.t[i], 7);
    }
  });
});

describe('flip handling at a shallow angle with noise', () => {
  const s = 0.12;
  const N = 1000;
  // Shared simulation: the naive method, lowest-RMS selection, and selection
  // with the previous frame's pose (truth perturbed by ~3 deg) as tie-break.
  const r = rng(100);
  const rows: { naive: number; rmsSel: number; prevSel: number; bestCand: number; naiveRms: number; altRms: number; seedIdx: number }[] = [];
  const cases: { img: Point2[]; truth: ReturnType<typeof makeMarkerPose> }[] = [];
  for (let k = 0; k < N; k++) {
    const truth = makeMarkerPose({ distance: uniform(r, 1.5, 3), tiltDeg: uniform(r, 15, 40), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir: [uniform(r, -0.3, 0.3), uniform(r, -0.2, 0.2), 1] });
    const obj = markerCorners(s);
    const img = noisyCorners(K, truth, s, 0.5, r)!;
    const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!;
    const naive = refinePose(poseFromHomography(Hm, K)!, obj, img, K);
    const cands = ippeCandidates(Hm, K, obj, img).map((p) => refinePose(p, obj, img, K));
    const prev = { R: mat3Mul(rotationFromVector([0.03 * gaussian(r), 0.03 * gaussian(r), 0.03 * gaussian(r)]), truth.R), t: truth.t };
    const byRms = chooseCandidate(cands, null)!;
    const byPrev = chooseCandidate(cands, prev)!;
    rows.push({
      naive: rotationAngleBetween(naive.R, truth.R) * DEG,
      rmsSel: rotationAngleBetween(byRms.best.R, truth.R) * DEG,
      prevSel: rotationAngleBetween(byPrev.best.R, truth.R) * DEG,
      bestCand: Math.min(...cands.map((c) => rotationAngleBetween(c.R, truth.R) * DEG)),
      naiveRms: naive.rmsPx,
      altRms: byRms.other ? byRms.other.rmsPx : NaN,
      seedIdx: k,
    });
    cases.push({ img, truth });
  }
  const count = (f: (x: (typeof rows)[number]) => boolean) => rows.filter(f).length;

  it('the naive homography solution flips on a real share of frames', () => {
    const naiveFlips = count((x) => x.naive > FLIP_DEG);
    const rmsFlips = count((x) => x.rmsSel > FLIP_DEG);
    const prevFlips = count((x) => x.prevSel > FLIP_DEG);
    const candMiss = count((x) => x.bestCand > FLIP_DEG);
    console.log(`[flip] 12 cm code, 1.5-3 m, tilt 15-40 deg, 0.5 px noise, ${N} frames: naive flips ${naiveFlips}, lowest-RMS flips ${rmsFlips}, with-previous flips ${prevFlips}, no candidate within ${FLIP_DEG} deg ${candMiss}`);
    expect(naiveFlips).toBeGreaterThan(0.05 * N); // the problem is real
    expect(candMiss).toBeLessThan(0.01 * N); // IPPE almost always has the right pose among its two
    expect(prevFlips).toBeLessThan(0.01 * N); // and the previous-pose tie-break picks it
    expect(prevFlips).toBeLessThan(naiveFlips / 10);
  });

  it('a concrete frame where the naive solution is flipped and estimatePose(prev) is right', () => {
    const i = rows.findIndex((x) => x.naive > 20 && x.bestCand < 3);
    expect(i).toBeGreaterThanOrEqual(0);
    const { img, truth } = cases[i];
    const prev = { R: mat3Mul(rotationFromVector([0.02, -0.01, 0.015]), truth.R), t: truth.t };
    const est = estimatePose(img, s, K, prev)!;
    const err = rotationAngleBetween(est.R, truth.R) * DEG;
    const altErr = rotationAngleBetween(est.alternative!.R, truth.R) * DEG;
    console.log(`[flip] frame #${i}: naive error ${rows[i].naive.toFixed(1)} deg; chosen error ${err.toFixed(2)} deg (rms ${est.rmsPx.toFixed(3)} px), alternative error ${altErr.toFixed(1)} deg (rms ${est.alternative!.rmsPx.toFixed(3)} px), reason=${est.reason}`);
    expect(err).toBeLessThan(3);
    expect(altErr).toBeGreaterThan(20);
    expect(est.ambiguous).toBe(true);
  });

  it('a clear RMS gap overrides a wrong previous pose (no lock-in of a flip)', () => {
    // Close and steep: perspective makes the wrong candidate fit much worse.
    const truth = makeMarkerPose({ distance: 0.5, tiltDeg: 45, tiltAzDeg: 30, rollDeg: 10 });
    const obj = markerCorners(0.25);
    const img = noisyCorners(K, truth, 0.25, 0.5, rng(41))!;
    const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!;
    const cands = ippeCandidates(Hm, K, obj, img); // unrefined
    const wrong = cands.reduce((a, b) => (rotationAngleBetween(a.R, truth.R) > rotationAngleBetween(b.R, truth.R) ? a : b));
    expect(rotationAngleBetween(wrong.R, truth.R) * DEG).toBeGreaterThan(20);
    const est = estimatePose(img, 0.25, K, wrong)!;
    // Either the wrong candidate refines to a clearly worse RMS ('rms'), or LM
    // slides it onto the true pose so only one distinct pose remains ('only').
    expect(est.reason).not.toBe('previous');
    expect(rotationAngleBetween(est.R, truth.R) * DEG).toBeLessThan(2);
  });
});

describe('tracking sequence (prev = last estimate, not the truth)', () => {
  it('a slow orbit around a far 12 cm code: the previous-pose tie-break suppresses flips', () => {
    const s = 0.12;
    const r = rng(42);
    let flipsNoPrev = 0, flipsTracked = 0;
    let prev: PoseEstimate | null = null;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const ph = i / N;
      // 10 s at 30 fps: the viewer drifts from 20 to 35 deg tilt at 2.0-2.6 m.
      const truth = makeMarkerPose({ distance: 2.0 + 0.6 * ph, tiltDeg: 20 + 15 * ph, tiltAzDeg: 30 + 40 * ph, rollDeg: 5 * Math.sin(6 * ph), dir: [0.05 * Math.sin(4 * ph), 0.03, 1] });
      const img = noisyCorners(K, truth, s, 0.5, r)!;
      const single = estimatePose(img, s, K)!;
      const tracked: PoseEstimate = estimatePose(img, s, K, prev)!;
      if (rotationAngleBetween(single.R, truth.R) * DEG > FLIP_DEG) flipsNoPrev++;
      if (rotationAngleBetween(tracked.R, truth.R) * DEG > FLIP_DEG) flipsTracked++;
      prev = tracked;
    }
    console.log(`[flip] tracked sequence, 12 cm code at 2.0-2.6 m, ${N} frames: flips without prev ${flipsNoPrev}, with prev = last estimate ${flipsTracked}`);
    expect(flipsTracked).toBeLessThan(Math.max(3, flipsNoPrev / 5));
  });
});
