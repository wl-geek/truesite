import { describe, expect, it } from 'vitest';
import { type Intrinsics, projectCamPoint } from './camera';
import { type Vec3, mat3MulVec } from './linalg';
import { CV_TO_GL } from './modelMatrix';
import { type ObjectFit, applyMat4ColumnMajor, fitTransform, ndcToViewport, projectionMatrixGL, videoToViewport, viewportToVideo } from './projection';
import { rng, uniform } from './testing/synth';

const configs: { name: string; W: number; H: number; Vw: number; Vh: number; K: Intrinsics; fit: ObjectFit }[] = [
  { name: 'landscape video in portrait phone (cover, heavy side crop)', W: 1280, H: 720, Vw: 390, Vh: 844, K: { f: 1000, cx: 640, cy: 360 }, fit: 'cover' },
  { name: 'portrait video (iOS) in portrait phone', W: 720, H: 1280, Vw: 390, Vh: 844, K: { f: 1010, cx: 360, cy: 640 }, fit: 'cover' },
  { name: '1080p in tablet landscape, NON-centred principal point', W: 1920, H: 1080, Vw: 1024, Vh: 768, K: { f: 1500, cx: 1000, cy: 520 }, fit: 'cover' },
  { name: 'contain (letterbox) with non-centred pp', W: 1280, H: 720, Vw: 800, Vh: 800, K: { f: 950, cx: 610, cy: 380 }, fit: 'contain' },
];

describe('projectionMatrixGL', () => {
  for (const c of configs) {
    it(`matches the CV projection through the ${c.fit} transform: ${c.name}`, () => {
      const r = rng(70);
      const P = projectionMatrixGL({ K: c.K, videoW: c.W, videoH: c.H, viewW: c.Vw, viewH: c.Vh, near: 0.05, far: 50, fit: c.fit });
      const m = fitTransform(c.W, c.H, c.Vw, c.Vh, c.fit);
      let worst = 0;
      for (let k = 0; k < 500; k++) {
        const Xc: Vec3 = [uniform(r, -2, 2), uniform(r, -2, 2), uniform(r, 0.2, 10)];
        const px = videoToViewport(m, projectCamPoint(c.K, Xc)!); // (a) CV
        const ndc = applyMat4ColumnMajor(P, mat3MulVec(CV_TO_GL, Xc)); // (b) GL
        const q = ndcToViewport(ndc, c.Vw, c.Vh);
        worst = Math.max(worst, Math.hypot(px[0] - q[0], px[1] - q[1]));
      }
      expect(worst).toBeLessThan(1e-9);
    });
  }
  it('maps near and far to NDC z = -1 and +1', () => {
    const P = projectionMatrixGL({ K: { f: 1000, cx: 640, cy: 360 }, videoW: 1280, videoH: 720, viewW: 390, viewH: 844, near: 0.1, far: 20 });
    expect(applyMat4ColumnMajor(P, [0, 0, -0.1])[2]).toBeCloseTo(-1, 12);
    expect(applyMat4ColumnMajor(P, [0, 0, -20])[2]).toBeCloseTo(1, 12);
  });
  it('cover crops: the video centre stays at the viewport centre and the scale fills the taller side', () => {
    const m = fitTransform(1280, 720, 390, 844, 'cover');
    expect(m.scale).toBeCloseTo(844 / 720, 12);
    const c = videoToViewport(m, [640, 360]);
    expect(c[0]).toBeCloseTo(195, 9);
    expect(c[1]).toBeCloseTo(422, 9);
    expect(m.offsetX).toBeLessThan(0); // cropped left/right
    const back = viewportToVideo(m, [100, 200]);
    const again = videoToViewport(m, back);
    expect(again[0]).toBeCloseTo(100, 9);
    expect(again[1]).toBeCloseTo(200, 9);
  });
});
