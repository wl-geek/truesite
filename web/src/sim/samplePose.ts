/**
 * Camera pose of a simulated sample photo (scripts/make-samples.mjs): a camera at `eye` (IFC metres) looking along
 * the horizontal direction `look`, tilted up by `pitchDeg`, expressed as the QR marker pose the check expects.
 *
 *   CV camera rows Rc = [right; down; forward] in IFC.  X_cv = Rc (p - eye).
 *   cvCameraFromModel gives X_cv = R Rqm^T (p - position_m) + t, so R = Rc Rqm and t = Rc (position_m - eye).
 */
import { markerAxesInModel, mat3Mul, mat3MulVec, type Anchor, type Mat3, type Pose, type Vec3 } from '../pose'

export function cameraRows(look: [number, number], pitchDeg: number): Mat3 {
  const p = (pitchDeg * Math.PI) / 180
  const h = Math.hypot(look[0], look[1])
  const [lx, ly] = [look[0] / h, look[1] / h]
  const fwd: Vec3 = [Math.cos(p) * lx, Math.cos(p) * ly, Math.sin(p)]
  const right: Vec3 = [ly, -lx, 0] // fwd x Z, normalised (fwd's horizontal part is (lx, ly))
  const down: Vec3 = [
    fwd[1] * right[2] - fwd[2] * right[1],
    fwd[2] * right[0] - fwd[0] * right[2],
    fwd[0] * right[1] - fwd[1] * right[0],
  ]
  return [...right, ...down, ...fwd] as Mat3
}

export function samplePose(anchor: Anchor, eye: Vec3, look: [number, number], pitchDeg: number): Pose {
  const Rc = cameraRows(look, pitchDeg)
  const R = mat3Mul(Rc, markerAxesInModel(anchor))
  const t = mat3MulVec(Rc, [anchor.position_m[0] - eye[0], anchor.position_m[1] - eye[1], anchor.position_m[2] - eye[2]])
  return { R, t: t as Vec3 }
}
