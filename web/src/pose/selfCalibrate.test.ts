import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { homographyDLT } from './homography';
import { type Point2, median } from './linalg';
import { focalFromHomography, selfCalibrateFocal, viewTiltDeg } from './selfCalibrate';
import { insideImage, makeMarkerPose, noisyCorners, randomViewDir, rng, uniform } from './testing/synth';

const W = 1280, H = 720;
const fGuess = focalFromHfov(63, W); // the app's default prior (spec 7.2)

/**
 * Random views. tilt is measured from the line of sight. With `centred`, the
 * code sits within ~40 px of the image centre, so its line of sight is the
 * optical axis and a small tilt really means "code plane parallel to the
 * image plane" (the degenerate case). An OFF-centre code seen square-on is
 * not degenerate: its plane is not parallel to the image plane.
 */
function makeViews(K: ReturnType<typeof centredIntrinsics>, n: number, seed: number, opts: { s: number; dmin: number; dmax: number; tmin: number; tmax: number; sigma: number; centred?: boolean }) {
  const r = rng(seed);
  const views: Point2[][] = [];
  while (views.length < n) {
    const truth = makeMarkerPose({ distance: uniform(r, opts.dmin, opts.dmax), tiltDeg: uniform(r, opts.tmin, opts.tmax), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir: opts.centred ? randomViewDir(r, K, W, H, 0).map((x, i) => (i < 2 ? x * (40 / (W / 2)) : x)) as [number, number, number] : randomViewDir(r, K, W, H, 200) });
    const img = noisyCorners(K, truth, opts.s, opts.sigma, r);
    if (img && insideImage(img, W, H, 5)) views.push(img);
  }
  return views;
}

describe('focal constraints', () => {
  it('a single noise-free tilted view gives f exactly', () => {
    const K = centredIntrinsics(900, W, H);
    const truth = makeMarkerPose({ distance: 0.6, tiltDeg: 35, tiltAzDeg: 20, rollDeg: 15, dir: [0.1, -0.05, 1] });
    const obj = markerCorners(0.15);
    const img = obj.map((X) => projectPoint(K, truth, X)!) as Point2[];
    const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!;
    expect(focalFromHomography(Hm, K.cx, K.cy)).toBeCloseTo(900, 4);
  });
  it('near-fronto-parallel views are uninformative (and the tilt gate sees them)', () => {
    const K = centredIntrinsics(900, W, H);
    const r = rng(50);
    const perTilt = (tilt: number) => {
      const errs: number[] = [];
      for (let k = 0; k < 200; k++) {
        const truth = makeMarkerPose({ distance: 0.5, tiltDeg: tilt, tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180) });
        const img = noisyCorners(K, truth, 0.15, 0.5, r)!;
        const Hm = homographyDLT(markerCorners(0.15).map((p) => [p[0], p[1]] as Point2), img)!;
        const tiltEst = viewTiltDeg(Hm, { f: fGuess, cx: K.cx, cy: K.cy })!;
        expect(Math.abs(tiltEst - tilt)).toBeLessThan(6); // the gate only needs a rough angle; f here is 16% off
        const f = focalFromHomography(Hm, K.cx, K.cy);
        errs.push(f === null ? 1 : Math.abs(f / 900 - 1));
      }
      return median(errs);
    };
    const e3 = perTilt(3), e35 = perTilt(35);
    console.log(`[calib] median per-view |f error|: tilt 3 deg ${(e3 * 100).toFixed(1)}%, tilt 35 deg ${(e35 * 100).toFixed(1)}%`);
    expect(e3).toBeGreaterThan(5 * e35);
  });
});

describe('selfCalibrateFocal', () => {
  const cams = [
    { name: '70 deg hFOV', f: focalFromHfov(70, W) },
    { name: '55 deg hFOV', f: focalFromHfov(55, W) },
  ];
  for (const cam of cams) {
    it(`30 tilted views, 0.5 px noise -> f within 3% (${cam.name}, prior 63 deg), 10 seeds`, () => {
      const K = centredIntrinsics(cam.f, W, H);
      const errs: number[] = [];
      const errsCF: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const views = makeViews(K, 30, seed * 7919, { s: 0.15, dmin: 0.3, dmax: 0.8, tmin: 20, tmax: 50, sigma: 0.5 });
        const res = selfCalibrateFocal(views, 0.15, W / 2, H / 2, { fGuess })!;
        expect(res).not.toBeNull();
        errs.push(Math.abs(res.f / cam.f - 1));
        errsCF.push(Math.abs(res.fClosedForm / cam.f - 1));
        expect(Math.abs(res.f / cam.f - 1)).toBeLessThan(0.03);
        expect(Math.abs(res.fClosedForm / cam.f - 1)).toBeLessThan(0.03);
      }
      console.log(`[calib] ${cam.name} (f=${cam.f.toFixed(0)} px, prior ${fGuess.toFixed(0)}): max |error| closed-form median ${(Math.max(...errsCF) * 100).toFixed(2)}%, after ML refinement ${(Math.max(...errs) * 100).toFixed(2)}%`);
    });
  }
  it('skips near-head-on views and survives gross outliers', () => {
    const K = centredIntrinsics(focalFromHfov(70, W), W, H);
    const good = makeViews(K, 24, 99, { s: 0.15, dmin: 0.3, dmax: 0.8, tmin: 20, tmax: 50, sigma: 0.5 });
    const headOn = makeViews(K, 6, 98, { s: 0.15, dmin: 0.3, dmax: 0.8, tmin: 0, tmax: 5, sigma: 0.5, centred: true });
    // 3 corrupted views: one corner off by 15 px (a bad detection).
    const corrupted = makeViews(K, 3, 97, { s: 0.15, dmin: 0.3, dmax: 0.8, tmin: 20, tmax: 50, sigma: 0.5 }).map((v) => {
      const c = v.map((p) => [...p] as Point2);
      c[1][0] += 15;
      return c;
    });
    const res = selfCalibrateFocal([...good, ...headOn, ...corrupted], 0.15, W / 2, H / 2, { fGuess })!;
    console.log(`[calib] mixed set: used ${res.viewsUsed}, skipped (tilt) ${res.viewsSkippedTilt}, rejected ${res.viewsRejected}, f error ${((res.f / K.f - 1) * 100).toFixed(2)}%`);
    expect(res.viewsSkippedTilt).toBeGreaterThanOrEqual(6);
    expect(Math.abs(res.f / K.f - 1)).toBeLessThan(0.03);
  });
  it('returns null with too few informative views', () => {
    const K = centredIntrinsics(900, W, H);
    const headOn = makeViews(K, 10, 5, { s: 0.15, dmin: 0.3, dmax: 0.8, tmin: 0, tmax: 4, sigma: 0.5, centred: true });
    expect(selfCalibrateFocal(headOn, 0.15, W / 2, H / 2, { fGuess })).toBeNull();
  });
});
