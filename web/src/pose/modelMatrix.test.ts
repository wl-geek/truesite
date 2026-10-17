import { describe, expect, it } from 'vitest';
import { type Intrinsics, type Pose, markerCorners, projectCamPoint, projectPoint } from './camera';
import { type Vec3, add3, det3, mat3MulVec, scale3, sub3, transpose3 } from './linalg';
import {
  type Anchor, GLTF_FROM_IFC, IFC_FROM_GLTF, IFC_FROM_GLTF_MAT4, markerAxesInModel, markerFromModel, modelMatrixGltf, modelMatrixIfc,
} from './modelMatrix';
import { applyMat4ColumnMajor, fitTransform, ndcToViewport, projectionMatrixGL, videoToViewport } from './projection';
import { makeMarkerPose, rng, uniform } from './testing/synth';

const room: Anchor = { position_m: [2.4, 0.0, 1.2], normal: [0, -1, 0], up: [0, 0, 1], scale: 1.0 };
const desk: Anchor = { position_m: [1.0, -0.5, 0.0], normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 };

describe('anchor frame', () => {
  it('room anchor on a wall facing -Y: marker x = +X, y = +Z, z = -Y', () => {
    const R = markerAxesInModel(room);
    // row-major; columns x = (1,0,0), y = (0,0,1), z = (0,-1,0)
    [1, 0, 0, 0, 0, -1, 0, 1, 0].forEach((v, i) => expect(R[i]).toBeCloseTo(v, 12));
    expect(det3(R)).toBeCloseTo(1, 12);
  });
  it('up is made orthogonal to the normal (Gram-Schmidt)', () => {
    const R = markerAxesInModel({ ...room, up: [0.1, -0.2, 1] });
    expect(det3(R)).toBeCloseTo(1, 12);
    expect(R[1] * R[2] + R[4] * R[5] + R[7] * R[8]).toBeCloseTo(0, 12); // y . z
  });
  it('desk anchor at 1:20: a model point 1 m from the anchor is 5 cm from the code', () => {
    const { A, b } = markerFromModel(desk);
    const pm = add3(mat3MulVec(A, [2.0, -0.5, 0.0]), b);
    expect(pm[0]).toBeCloseTo(0.05, 12);
    expect(pm[1]).toBeCloseTo(0, 12);
    expect(pm[2]).toBeCloseTo(0, 12);
  });
  it('GLTF_FROM_IFC: IFC Z-up becomes glTF Y-up', () => {
    expect(mat3MulVec(GLTF_FROM_IFC, [0, 0, 1])).toEqual([0, 1, 0]);
    expect(mat3MulVec(GLTF_FROM_IFC, [0, 1, 0]).map((v) => v + 0)).toEqual([0, 0, -1]);
    expect(det3(GLTF_FROM_IFC)).toBe(1);
  });
});

describe('model matrix: CV pipeline == GL pipeline', () => {
  const W = 1280, H = 720, Vw = 390, Vh = 844;
  const K: Intrinsics = { f: 1000, cx: 655, cy: 350 }; // deliberately non-centred
  const P = projectionMatrixGL({ K, videoW: W, videoH: H, viewW: Vw, viewH: Vh, near: 0.01, far: 100 });
  const fit = fitTransform(W, H, Vw, Vh, 'cover');

  // (a) written out independently of modelMatrix.ts
  function cvPixel(anchor: Anchor, pose: Pose, pModel: Vec3) {
    const Rqm = markerAxesInModel(anchor);
    const pMarker = scale3(mat3MulVec(transpose3(Rqm), sub3(pModel, anchor.position_m)), anchor.scale);
    const Xc = add3(mat3MulVec(pose.R, pMarker), pose.t);
    const px = projectCamPoint(K, Xc);
    return px ? videoToViewport(fit, px) : null;
  }

  for (const [name, anchor] of [['room 1:1', room], ['desk 1:20', desk]] as [string, Anchor][]) {
    it(`a model point lands on the same viewport pixel (${name}), via glTF coords and via IFC coords`, () => {
      const r = rng(80);
      let worst = 0, n = 0;
      for (let k = 0; k < 200; k++) {
        const pose = makeMarkerPose({ distance: uniform(r, 0.5, 3), tiltDeg: uniform(r, 0, 60), tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir: [uniform(r, -0.3, 0.3), uniform(r, -0.2, 0.2), 1] });
        const Mg = modelMatrixGltf(anchor, pose);
        const Mi = modelMatrixIfc(anchor, pose);
        for (let j = 0; j < 10; j++) {
          const pModel: Vec3 = [uniform(r, -1, 5), uniform(r, -3, 3), uniform(r, -0.5, 3)];
          const a = cvPixel(anchor, pose, pModel);
          if (!a) continue;
          const g = mat3MulVec(GLTF_FROM_IFC, pModel); // as stored in the .glb
          const eye = applyMat4ColumnMajor(Mg, g);
          const viaGltf = ndcToViewport(applyMat4ColumnMajor(P, eye), Vw, Vh);
          const viaIfc = ndcToViewport(applyMat4ColumnMajor(P, applyMat4ColumnMajor(Mi, pModel)), Vw, Vh);
          worst = Math.max(worst, Math.hypot(a[0] - viaGltf[0], a[1] - viaGltf[1]), Math.hypot(a[0] - viaIfc[0], a[1] - viaIfc[1]));
          expect(eye[2]).toBeLessThan(0); // in front of the three.js camera (looking down -z)
          n++;
        }
      }
      expect(n).toBeGreaterThan(1000);
      expect(worst).toBeLessThan(1e-7);
    });
  }

  it('the anchor point lands on the code centre and a code corner on its image corner', () => {
    const pose = makeMarkerPose({ distance: 1.5, tiltDeg: 35, tiltAzDeg: 60, rollDeg: 20 });
    const s = 0.25;
    const centre = cvPixel(room, pose, room.position_m)!;
    const expected = videoToViewport(fit, projectPoint(K, pose, [0, 0, 0])!);
    expect(centre[0]).toBeCloseTo(expected[0], 9);
    expect(centre[1]).toBeCloseTo(expected[1], 9);
    // TL corner of the code in model coords: position + Rqm * (-s/2, +s/2, 0) / scale
    const Rqm = markerAxesInModel(room);
    const tlModel = add3(room.position_m, scale3(mat3MulVec(Rqm, markerCorners(s)[0]), 1 / room.scale));
    const viaGl = ndcToViewport(applyMat4ColumnMajor(P, applyMat4ColumnMajor(modelMatrixIfc(room, pose), tlModel)), Vw, Vh);
    const tlImg = videoToViewport(fit, projectPoint(K, pose, markerCorners(s)[0])!);
    expect(viaGl[0]).toBeCloseTo(tlImg[0], 7);
    expect(viaGl[1]).toBeCloseTo(tlImg[1], 7);
  });

  it('IFC_FROM_GLTF_MAT4 under modelMatrixIfc equals modelMatrixGltf', () => {
    const pose = makeMarkerPose({ distance: 2, tiltDeg: 20, tiltAzDeg: 10 });
    const g: Vec3 = [0.3, 1.1, -2.2];
    const a = applyMat4ColumnMajor(modelMatrixIfc(room, pose), applyMat4ColumnMajor(IFC_FROM_GLTF_MAT4, g));
    const b = applyMat4ColumnMajor(modelMatrixGltf(room, pose), g);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 12);
    expect(mat3MulVec(IFC_FROM_GLTF, g)).toEqual([0.3, 2.2, 1.1]);
  });
});

describe('anchor axes (mutation-tested)', () => {
  it('refuses an anchor whose up is parallel to its normal', () => {
    expect(() => markerAxesInModel({ ...room, up: [0, -1, 0] })).toThrow('anchor.up must not be parallel to anchor.normal');
    expect(() => markerAxesInModel({ ...room, up: [0, 3, 0] })).toThrow(/parallel/);
    expect(() => markerAxesInModel({ ...room, up: [0, -1, 0.6] })).not.toThrow(); // leaning, but not parallel
  });
});
