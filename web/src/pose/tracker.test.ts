import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { estimatePose } from './estimatePose';
import { type Point2, type Vec3, norm3, sub3 } from './linalg';
import { rotationAngleBetween } from './rotation';
import { makeMarkerPose, noisyCorners, rng, uniform } from './testing/synth';
import { PoseTracker, tiltNoiseRad } from './tracker';

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

describe('PoseTracker edge cases (mutation-tested)', () => {
  const img = (p: { R: number[]; t: Vec3 }, s = 0.25) => markerCorners(s).map((X) => projectPoint(K, p, X)!) as Point2[];

  /** Noisy frames until one whose estimate is ambiguous with the given grade. */
  function ambiguousFrame(s: number, dmin: number, dmax: number, sigma: number, quality: 'good' | 'poor', seed: number): Point2[] {
    const r = rng(seed);
    for (let k = 0; k < 400; k++) {
      const pose = makeMarkerPose({ distance: uniform(r, dmin, dmax), tiltDeg: uniform(r, 5, 25), tiltAzDeg: uniform(r, 0, 360) });
      const c = noisyCorners(K, pose, s, sigma, r);
      const est = c && estimatePose(c, s, K);
      if (c && est && est.ambiguous && est.quality === quality) return c;
    }
    throw new Error(`no ambiguous ${quality} frame found`);
  }

  it('returns null for a frame it cannot solve, without throwing, and carries on', () => {
    const tr = new PoseTracker(0.25, K);
    const a = makeMarkerPose({ distance: 0.8, tiltDeg: 35, tiltAzDeg: 20 });
    const c = img(a);
    expect(tr.update(c, 0)).not.toBeNull();
    expect(tr.update([c[0], c[3], c[2], c[1]], 1 / FPS)).toBeNull(); // mirrored corners
    expect(tr.update([c[0], c[0], c[0], c[0]], 2 / FPS)).toBeNull();
    expect(tr.update(c, 3 / FPS)).not.toBeNull();
  });

  it('caps an ambiguous good frame at fair until trusted, and never raises a poor one', () => {
    const good = ambiguousFrame(0.25, 1.8, 2.2, 1.0, 'good', 11); // a 25 cm code about 2 m away, a shaky detector
    const first = new PoseTracker(0.25, K).update(good, 0)!;
    expect([first.raw.quality, first.provisional, first.quality]).toEqual(['good', true, 'fair']);
    const poor = ambiguousFrame(0.12, 2.8, 3.6, 0.5, 'poor', 12); // a 12 cm code over 3 m away
    const p = new PoseTracker(0.12, K).update(poor, 0)!;
    expect([p.provisional, p.quality]).toEqual([true, 'poor']);
    // once an unambiguous frame was seen, the same good frame keeps its grade
    const trusted = new PoseTracker(0.25, K);
    expect(trusted.update(img(makeMarkerPose({ distance: 0.6, tiltDeg: 40, tiltAzDeg: 10 })), 0)!.provisional).toBe(false);
    const again = trusted.update(good, 1 / FPS)!;
    expect(again.provisional).toBe(false);
    expect(again.quality).toBe(again.raw.quality);
    expect(again.raw.quality).toBe('good');
  });

  it('restarts the smoothing after losing the code for lostAfterSec, even inside the smoother\'s own gap', () => {
    const tr = new PoseTracker(0.25, K, { lostAfterSec: 0.2 });
    const a = makeMarkerPose({ distance: 0.8, tiltDeg: 35, tiltAzDeg: 20 });
    for (let i = 0; i < 15; i++) tr.update(img(a), i / FPS);
    const b = { R: a.R, t: [a.t[0] + 0.1, a.t[1], a.t[2] + 0.2] as Vec3 };
    const out = tr.update(img(b), 14 / FPS + 0.3)!; // a 0.3 s gap: over lostAfterSec, under the smoother's 0.5 s
    expect(norm3(sub3(out.smoothed.t, out.raw.t))).toBeLessThan(1e-12);
  });

  it('keeps easing through a moderate turn below jumpResetDeg', () => {
    const tr = new PoseTracker(0.25, K);
    const a = makeMarkerPose({ distance: 0.8, tiltDeg: 30, tiltAzDeg: 20 });
    const b = makeMarkerPose({ distance: 0.8, tiltDeg: 40, tiltAzDeg: 20 }); // 10 degrees away
    for (let i = 0; i < 30; i++) tr.update(img(a), i / FPS);
    const out = tr.update(img(b), 30 / FPS)!;
    expect(rotationAngleBetween(out.raw.R, b.R) * DEG).toBeLessThan(0.01);
    expect(rotationAngleBetween(out.smoothed.R, b.R) * DEG).toBeGreaterThan(1);
  });

  it("does not trust a pose whose tilt isn't pinned down: head-on and far, until a close look; then it carries on", () => {
    const r = rng(93);
    const s16 = 0.16; // the 16 cm code on a US Letter sheet
    const headOnFar = makeMarkerPose({ distance: 1.5, tiltDeg: 0 });
    const close = makeMarkerPose({ distance: 0.6, tiltDeg: 30, tiltAzDeg: 15 });
    // Without a corner-noise figure (the old rule) a head-on code is trusted: its two mirror poses coincide.
    const old = new PoseTracker(s16, K);
    let oldOut = null;
    for (let i = 0; i < 20; i++) oldOut = old.update(noisyCorners(K, headOnFar, s16, 0.5, r), i / FPS) ?? oldOut;
    expect(oldOut?.provisional).toBe(false);
    // With half-pixel corners the tilt there is uncertain by several degrees: provisional, never good ...
    const tr = new PoseTracker(s16, K);
    let t = 0;
    for (let i = 0; i < 30; i++, t += 1 / FPS) {
      const out = tr.update(noisyCorners(K, headOnFar, s16, 0.5, r), t, 0.5);
      if (out) {
        expect(out.provisional).toBe(true);
        expect(out.quality).not.toBe('good');
      }
    }
    // ... until a close look pins it down; stepping back to the far spot keeps the trust (the tracking goes on).
    for (let i = 0; i < 10; i++, t += 1 / FPS) tr.update(noisyCorners(K, close, s16, 0.5, r), t, 0.5);
    const back = tr.update(noisyCorners(K, headOnFar, s16, 0.5, r), t, 0.5)!;
    expect(back.provisional).toBe(false);
  });

  it('puts a number on how well the tilt is pinned down (P1 from the camera videos)', () => {
    expect(tiltNoiseRad(167, 1.5, 0.16, 0.5) * DEG).toBeCloseTo(3.2, 1); // head-on at the X, read at the camera's resolution
    expect(tiltNoiseRad(330, 0.7, 0.16, 0.77) * DEG).toBeCloseTo(1.17, 1); // 0.7 m from the code, a crop read at 2/3 size
    expect(tiltNoiseRad(330, 0.7, 0.16, 1.5) * DEG).toBeGreaterThan(2); // the same at 640 px for the whole frame
  });
});

