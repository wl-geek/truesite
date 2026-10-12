/**
 * The full model -> three.js-camera transform for the live overlay
 * (spec 7.1 step 5: camera<-model = camera<-QR x QR<-model).
 *
 * Frames:
 *  - MODEL: IFC model coordinates, metres, Z up (all JSON files, spec 6).
 *  - glTF: the mesh file's own coordinates, Y up. GLTF_FROM_IFC below says
 *    how they relate; it is a named constant so the BIM pipeline can change it.
 *  - MARKER: the QR frame (camera.ts).
 *  - CV camera: x right, y down, z forward (camera.ts).
 *  - GL camera (three.js): x right, y up, looking down -z.
 *
 * Anchor (anchors.json): position_m = code centre in model coords; normal =
 * out of the code toward the viewer; up = the code's top-edge direction;
 * scale = physical metres per model metre (1 for the room, 0.05 at 1:20).
 * Marker axes in model coords: z = normal, y = up (made orthogonal to z),
 * x = y x z. With Rqm = [x y z] (columns),
 *     p_marker = scale * Rqm^T (p_model - position_m).
 *
 * Composition (CV): Xc = R p_marker + t = A p_model + b with
 *     A = scale * R Rqm^T,  b = t - A position_m.
 * Then X_gl = CV_TO_GL X_c, and for glTF meshes p_model = IFC_FROM_GLTF p_gltf.
 *
 * three.js usage (camera at the origin with identity world matrix):
 *     camera.projectionMatrix.fromArray(projectionMatrixGL(...));
 *     camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
 *     ifcRoot.matrixAutoUpdate = false;
 *     ifcRoot.matrix.fromArray(modelMatrixIfc(anchor, pose));  // pins, boxes (IFC coords)
 *     gltfScene.matrixAutoUpdate = false;                       // child of ifcRoot
 *     gltfScene.matrix.fromArray(IFC_FROM_GLTF_MAT4);
 * (equivalently, a glTF scene alone: matrix.fromArray(modelMatrixGltf(anchor, pose))).
 */
import { type Pose } from './camera';
import { type Mat3, type Vec3, cross3, dot3, mat3Mul, mat3MulVec, normalize3, scale3, sub3, transpose3, fromColumns } from './linalg';

export interface Anchor {
  position_m: Vec3;
  normal: Vec3;
  up: Vec3;
  scale: number;
}

/** CV camera (y down, z forward) -> three.js camera (y up, looking down -z). */
export const CV_TO_GL: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/**
 * IFC (X, Y, Z; Z up) -> glTF (x, y, z; Y up): glTF (x, y, z) = IFC (X, Z, -Y).
 * This is the usual Z-up -> Y-up conversion (rotate -90 deg about X). If the
 * BIM converter is found to export differently, change ONLY this constant;
 * the 1 m reference-cube test in the pipeline pins it.
 */
export const GLTF_FROM_IFC: Mat3 = [
  1, 0, 0,
  0, 0, 1,
  0, -1, 0,
];
export const IFC_FROM_GLTF: Mat3 = transpose3(GLTF_FROM_IFC);

/** Column-major 4x4 from a row-major 3x3 A and translation b. */
export function mat4FromAffine(A: Mat3, b: Vec3): number[] {
  return [
    A[0], A[3], A[6], 0,
    A[1], A[4], A[7], 0,
    A[2], A[5], A[8], 0,
    b[0], b[1], b[2], 1,
  ];
}

/** Column-major 4x4 of IFC_FROM_GLTF (for the glTF scene node under ifcRoot). */
export const IFC_FROM_GLTF_MAT4: number[] = mat4FromAffine(IFC_FROM_GLTF, [0, 0, 0]);

/** Marker axes in model coordinates as the columns of Rqm (Gram-Schmidt on up). */
export function markerAxesInModel(anchor: Anchor): Mat3 {
  const z = normalize3(anchor.normal);
  const upPerp = sub3(anchor.up, scale3(z, dot3(anchor.up, z)));
  const y = normalize3(upPerp);
  if (!(Math.hypot(...y) > 0.5)) throw new Error('anchor.up must not be parallel to anchor.normal');
  const x = cross3(y, z);
  return fromColumns(x, y, z);
}

/** p_marker = A p_model + b. */
export function markerFromModel(anchor: Anchor): { A: Mat3; b: Vec3 } {
  const RqmT = transpose3(markerAxesInModel(anchor));
  const A = RqmT.map((v) => v * anchor.scale);
  const b = scale3(mat3MulVec(A, anchor.position_m), -1);
  return { A, b };
}

/** X_cv = A p_model + b. */
export function cvCameraFromModel(anchor: Anchor, pose: Pose): { A: Mat3; b: Vec3 } {
  const m = markerFromModel(anchor);
  const A = mat3Mul(pose.R, m.A);
  const Rb = mat3MulVec(pose.R, m.b);
  return { A, b: [Rb[0] + pose.t[0], Rb[1] + pose.t[1], Rb[2] + pose.t[2]] };
}

/** Column-major 4x4: IFC model coords (metres, Z up) -> three.js camera frame. */
export function modelMatrixIfc(anchor: Anchor, pose: Pose): number[] {
  const { A, b } = cvCameraFromModel(anchor, pose);
  return mat4FromAffine(mat3Mul(CV_TO_GL, A), mat3MulVec(CV_TO_GL, b));
}

/** Column-major 4x4: glTF mesh coords (Y up) -> three.js camera frame. */
export function modelMatrixGltf(anchor: Anchor, pose: Pose): number[] {
  const { A, b } = cvCameraFromModel(anchor, pose);
  return mat4FromAffine(mat3Mul(CV_TO_GL, mat3Mul(A, IFC_FROM_GLTF)), mat3MulVec(CV_TO_GL, b));
}
