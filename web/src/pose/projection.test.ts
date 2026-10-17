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

describe('fit and helpers (mutation-tested)', () => {
  it('fits the video with cover by default', () => {
    expect(fitTransform(1920, 1080, 800, 800)).toEqual(fitTransform(1920, 1080, 800, 800, 'cover'));
    expect(fitTransform(1920, 1080, 800, 800).scale).toBeCloseTo(800 / 1080, 12);
  });

  it('letterboxes with contain: the whole frame inside the viewport, centred', () => {
    const m = fitTransform(1920, 1080, 800, 800, 'contain');
    expect(m.scale).toBeCloseTo(800 / 1920, 12);
    expect(m.offsetX).toBeCloseTo(0, 12);
    expect(m.offsetY).toBeCloseTo((800 - 1080 * (800 / 1920)) / 2, 12);
    const tall = fitTransform(1080, 1920, 1000, 600, 'contain');
    expect(tall.scale).toBeCloseTo(600 / 1920, 12);
    expect(tall.offsetX).toBeCloseTo((1000 - 1080 * (600 / 1920)) / 2, 12);
  });

  it('maps viewport taps back to video pixels when the frame is cropped top and bottom', () => {
    const m = fitTransform(1280, 720, 1000, 300, 'cover'); // wide viewport: video cropped vertically
    expect(m.offsetY).toBeCloseTo((300 - 720 * (1000 / 1280)) / 2, 12);
    for (const p of [[0, 0], [640, 360], [1280, 720], [100, 650]] as [number, number][]) {
      const back = viewportToVideo(m, videoToViewport(m, p));
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });

  it('applies a projective column-major matrix like three.js', async () => {
    const { Matrix4, Vector3 } = await import('three');
    const m = [1.2, 0.1, -0.3, 0.05, 0.2, 0.9, 0.4, -0.02, -0.1, 0.3, 1.1, 0.03, 0.5, -0.4, 0.2, 1];
    const p = [0.7, -1.3, 2.1];
    const want = new Vector3(...p).applyMatrix4(new Matrix4().fromArray(m));
    const got = applyMat4ColumnMajor(m, p);
    expect(got[0]).toBeCloseTo(want.x, 12);
    expect(got[1]).toBeCloseTo(want.y, 12);
    expect(got[2]).toBeCloseTo(want.z, 12);
  });
});
