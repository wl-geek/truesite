/**
 * Integration check against the real three.js (0.186.1): the column-major
 * outputs of projection.ts and modelMatrix.ts, loaded with Matrix4.fromArray,
 * put a model point on the same viewport pixel as the CV pipeline, through
 * three's own Object3D world matrices, Vector3.project and Raycaster.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Intrinsics, projectCamPoint } from './camera';
import { type Vec3, add3, mat3MulVec, scale3, sub3, transpose3 } from './linalg';
import { type Anchor, GLTF_FROM_IFC, IFC_FROM_GLTF_MAT4, markerAxesInModel, modelMatrixIfc } from './modelMatrix';
import { fitTransform, projectionMatrixGL, videoToViewport } from './projection';
import { makeMarkerPose } from './testing/synth';

const W = 1280, H = 720, Vw = 390, Vh = 844;
const K: Intrinsics = { f: 1000, cx: 655, cy: 350 };
const room: Anchor = { position_m: [2.4, 0.0, 1.2], normal: [0, -1, 0], up: [0, 0, 1], scale: 1.0 };
const pose = makeMarkerPose({ distance: 1.8, tiltDeg: 30, tiltAzDeg: 40, rollDeg: 15, dir: [0.1, 0.05, 1] });
const pModel: Vec3 = [2.9, 0.4, 1.6];

function cvViewportPixel(): [number, number] {
  const Rqm = markerAxesInModel(room);
  const pm = scale3(mat3MulVec(transpose3(Rqm), sub3(pModel, room.position_m)), room.scale);
  const Xc = add3(mat3MulVec(pose.R, pm), pose.t);
  return videoToViewport(fitTransform(W, H, Vw, Vh, 'cover'), projectCamPoint(K, Xc)!);
}

function scene() {
  const camera = new THREE.PerspectiveCamera(); // stays at the origin, identity world matrix
  camera.projectionMatrix.fromArray(projectionMatrixGL({ K, videoW: W, videoH: H, viewW: Vw, viewH: Vh, near: 0.05, far: 50 }));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld(true);
  const ifcRoot = new THREE.Group();
  ifcRoot.matrixAutoUpdate = false;
  ifcRoot.matrix.fromArray(modelMatrixIfc(room, pose));
  const gltfScene = new THREE.Group(); // stands in for gltf.scene
  gltfScene.matrixAutoUpdate = false;
  gltfScene.matrix.fromArray(IFC_FROM_GLTF_MAT4);
  ifcRoot.add(gltfScene);
  const world = new THREE.Scene();
  world.add(ifcRoot);
  world.updateMatrixWorld(true);
  return { camera, ifcRoot, gltfScene, world };
}

describe('three.js integration', () => {
  it('Vector3.project of a glTF-space vertex lands on the CV pixel', () => {
    const { camera, gltfScene } = scene();
    const g = mat3MulVec(GLTF_FROM_IFC, pModel);
    const v = new THREE.Vector3(...g).applyMatrix4(gltfScene.matrixWorld).project(camera);
    const px = [((v.x + 1) / 2) * Vw, ((1 - v.y) / 2) * Vh];
    const cv = cvViewportPixel();
    console.log(`[three] CV pixel (${cv[0].toFixed(4)}, ${cv[1].toFixed(4)}) vs three.js (${px[0].toFixed(4)}, ${px[1].toFixed(4)})`);
    expect(Math.hypot(px[0] - cv[0], px[1] - cv[1])).toBeLessThan(1e-6);
  });
  it('Raycaster.setFromCamera through that pixel hits a mesh placed at the model point', () => {
    const { camera, ifcRoot, world } = scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial());
    box.position.set(...pModel); // IFC coords under ifcRoot
    ifcRoot.add(box);
    world.updateMatrixWorld(true);
    const cv = cvViewportPixel();
    const ndc = new THREE.Vector2((cv[0] / Vw) * 2 - 1, 1 - (cv[1] / Vh) * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(box);
    expect(hits.length).toBeGreaterThan(0);
  });
});
