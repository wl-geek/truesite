import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { type Point2, norm3, sub3 } from './linalg';
import { rotationAngleBetween } from './rotation';
import { makeMarkerPose, noisyCorners, rng } from './testing/synth';
import { PoseTracker } from './tracker';

const W = 1280, H = 720;
const K = centredIntrinsics(focalFromHfov(63, W), W, H);
const DEG = 180 / Math.PI;
const FPS = 30;

describe('PoseTracker', () => {
  it('approach from close range: trusted after an unambiguous frame, smoothing reduces jitter', () => {
    const r = rng(90);
    const tr = new PoseTracker(0.25, K);
    const rawErr: number[] = [], smErr: number[] = [], rawT: number[] = [], smT: number[] = [];
    let provisionalAfterStart = 0;
    for (let i = 0; i < 300; i++) {
      // hold still at 1.2 m, 35 deg, with 1 px corner noise (a shaky detector)
      const truth = makeMarkerPose({ distance: 1.2, tiltDeg: 35, tiltAzDeg: 20, rollDeg: 5 });
      const out = tr.update(noisyCorners(K, truth, 0.25, 1.0, r), i / FPS)!;
      if (i > 30) {
        if (out.provisional) provisionalAfterStart++;
        rawErr.push(rotationAngleBetween(out.raw.R, truth.R) * DEG);
        smErr.push(rotationAngleBetween(out.smoothed.R, truth.R) * DEG);
        rawT.push(norm3(sub3(out.raw.t, truth.t)) * 1000);
        smT.push(norm3(sub3(out.smoothed.t, truth.t)) * 1000);
      }
    }
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    console.log(`[tracker] 25 cm code at 1.2 m, 1 px noise, at rest: rotation error raw ${mean(rawErr).toFixed(2)} deg -> smoothed ${mean(smErr).toFixed(2)} deg; translation raw ${mean(rawT).toFixed(1)} mm -> smoothed ${mean(smT).toFixed(1)} mm`);
    expect(provisionalAfterStart).toBe(0);
    expect(mean(smErr)).toBeLessThan(0.6 * mean(rawErr));
    expect(mean(smT)).toBeLessThan(0.6 * mean(rawT));
  });

  it('starting far away (every frame ambiguous): stays provisional and never reports good', () => {
    const r = rng(91);
    const tr = new PoseTracker(0.12, K);
    for (let i = 0; i < 60; i++) {
      const truth = makeMarkerPose({ distance: 2.5, tiltDeg: 25, tiltAzDeg: 60 });
      const out = tr.update(noisyCorners(K, truth, 0.12, 0.5, r), i / FPS);
      if (out) {
        expect(out.provisional).toBe(true);
        expect(out.quality).not.toBe('good');
      }
    }
  });

  it('losing the code for longer than lostAfterSec resets trust', () => {
    const r = rng(92);
    const near = makeMarkerPose({ distance: 0.6, tiltDeg: 40, tiltAzDeg: 10 });
    // An ambiguous far frame (25 cm code at 3 m, small tilt).
    let farCorners: Point2[] | null = null;
    for (let k = 0; k < 50 && !farCorners; k++) {
      const c = noisyCorners(K, makeMarkerPose({ distance: 3.0, tiltDeg: 12, tiltAzDeg: 10 }), 0.25, 0.5, r)!;
      const probe = new PoseTracker(0.25, K).update(c, 0)!;
      if (probe.raw.ambiguous) farCorners = c;
    }
    expect(farCorners).not.toBeNull();
    const continuous = new PoseTracker(0.25, K);
    const afterGap = new PoseTracker(0.25, K);
    for (let i = 0; i < 10; i++) {
      const c = noisyCorners(K, near, 0.25, 0.5, r);
      expect(continuous.update(c, i / FPS)!.provisional).toBe(false);
      expect(afterGap.update(c, i / FPS)!.provisional).toBe(false);
    }
    expect(afterGap.update(null, 0.5)).toBeNull();
    // Same ambiguous frame: still trusted without a gap, provisional after a 1.2 s gap.
    expect(continuous.update(farCorners, 11 / FPS)!.provisional).toBe(false);
    expect(afterGap.update(farCorners, 1.5)!.provisional).toBe(true);
  });

  it('a large rotation jump snaps the smoothed pose instead of swinging', () => {
    const tr = new PoseTracker(0.25, K);
    const a = makeMarkerPose({ distance: 1.0, tiltDeg: 40, tiltAzDeg: 0 });
    const b = makeMarkerPose({ distance: 1.0, tiltDeg: 40, tiltAzDeg: 180 }); // 80 deg away
    const img = (p: typeof a) => markerCorners(0.25).map((X) => projectPoint(K, p, X)!) as Point2[];
    for (let i = 0; i < 30; i++) tr.update(img(a), i / FPS);
    const out = tr.update(img(b), 30 / FPS)!;
    expect(rotationAngleBetween(out.smoothed.R, b.R) * DEG).toBeLessThan(0.01);
  });
});
