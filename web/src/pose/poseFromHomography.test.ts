import { describe, expect, it } from 'vitest';
import { centredIntrinsics, focalFromHfov, markerCorners, projectPoint } from './camera';
import { homographyDLT } from './homography';
import { type Point2, det3, norm3, sub3 } from './linalg';
import { poseFromHomography } from './poseFromHomography';
import { rotationAngleBetween } from './rotation';
import { makeMarkerPose, rng, uniform } from './testing/synth';

const W = 1280, H = 720;
const K = centredIntrinsics(focalFromHfov(63, W), W, H);

describe('poseFromHomography', () => {
  it('recovers a known pose exactly from noise-free corners', () => {
    const r = rng(20);
    for (let k = 0; k < 100; k++) {
      const truth = makeMarkerPose({
        distance: uniform(r, 0.5, 3), tiltDeg: uniform(r, 0, 60), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180),
        dir: [uniform(r, -0.2, 0.2), uniform(r, -0.1, 0.1), 1],
      });
      const s = 0.25;
      const obj = markerCorners(s);
      const img = obj.map((X) => projectPoint(K, truth, X)!) as Point2[];
      const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!;
      const pose = poseFromHomography(Hm, K)!;
      expect(det3(pose.R)).toBeCloseTo(1, 10);
      expect(pose.t[2]).toBeGreaterThan(0);
      expect(rotationAngleBetween(pose.R, truth.R)).toBeLessThan(1e-7);
      expect(norm3(sub3(pose.t, truth.t))).toBeLessThan(1e-7);
    }
  });
  it('chooses the sign giving t_z > 0 even when H is negated', () => {
    const truth = makeMarkerPose({ distance: 1.2, tiltDeg: 30, tiltAzDeg: 45 });
    const obj = markerCorners(0.2);
    const img = obj.map((X) => projectPoint(K, truth, X)!) as Point2[];
    const Hm = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), img)!.map((x) => -x);
    const pose = poseFromHomography(Hm, K)!;
    expect(pose.t[2]).toBeGreaterThan(0);
    expect(rotationAngleBetween(pose.R, truth.R)).toBeLessThan(1e-7);
  });
});
