/**
 * Shared camera and marker conventions for the TrueSite pose pipeline.
 *
 * IMAGE PIXELS: u right, v down, origin at the top-left corner of the frame.
 *   Pixel coordinates are in the coordinate system of the video frame used for
 *   pose (video.videoWidth x video.videoHeight). If QR detection ran on a
 *   downscaled copy, scale the corners back up before calling the pose code.
 *
 * INTRINSICS K: square pixels, zero skew, fx = fy = f (pixels), principal point
 *   (cx, cy), by default the image centre (W/2, H/2).
 *       [ f 0 cx ]
 *   K = [ 0 f cy ]
 *       [ 0 0  1 ]
 *
 * CAMERA FRAME (computer-vision convention): x right, y down, z forward (out of
 *   the lens into the scene). Visible points have z > 0.
 *
 * MARKER (QR) FRAME: origin at the code centre; +x toward the code's right
 *   edge, +y toward its top edge, +z out of the printed face toward the viewer
 *   (right-handed). Corners of a code of printed side s (metres):
 *     TL(-s/2, +s/2, 0)  TR(+s/2, +s/2, 0)  BR(+s/2, -s/2, 0)  BL(-s/2, -s/2, 0)
 *   Detectors must give image corners in the order TL, TR, BR, BL of the code's
 *   OWN orientation (from its finder patterns), not of the screen.
 *
 * POSE (R, t): maps marker points to the camera frame, Xc = R * Xm + t.
 *   A visible code has t_z > 0 and its +z axis (column 3 of R) pointing back
 *   toward the camera: dot(R[:,2], t) < 0.
 */
import { type Mat3, type Point2, type Vec3, mat3MulVec } from './linalg';

export interface Intrinsics {
  /** Focal length in pixels (fx = fy). */
  f: number;
  /** Principal point in pixels. */
  cx: number;
  cy: number;
}

export interface Pose {
  /** Row-major rotation, marker -> camera. */
  R: Mat3;
  /** Translation in metres (camera frame): the marker centre in camera coordinates. */
  t: Vec3;
}

/** Intrinsics with the principal point at the image centre. */
export function centredIntrinsics(f: number, width: number, height: number): Intrinsics {
  return { f, cx: width / 2, cy: height / 2 };
}

/** Focal length (px) for a horizontal field of view (degrees) and image width (px). */
export function focalFromHfov(hfovDeg: number, width: number): number {
  return width / 2 / Math.tan((hfovDeg * Math.PI) / 360);
}

export function KMatrix(K: Intrinsics): Mat3 {
  return [K.f, 0, K.cx, 0, K.f, K.cy, 0, 0, 1];
}

export function KInverse(K: Intrinsics): Mat3 {
  const i = 1 / K.f;
  return [i, 0, -K.cx * i, 0, i, -K.cy * i, 0, 0, 1];
}

/** Pixel -> normalised image coordinates (x/z, y/z). */
export function normalizePixel(K: Intrinsics, p: Point2): Point2 {
  return [(p[0] - K.cx) / K.f, (p[1] - K.cy) / K.f];
}

/** Project a camera-frame point to pixels; null when it is not in front (z <= 0). */
export function projectCamPoint(K: Intrinsics, Xc: Vec3): Point2 | null {
  if (!(Xc[2] > 0)) return null;
  return [K.f * (Xc[0] / Xc[2]) + K.cx, K.f * (Xc[1] / Xc[2]) + K.cy];
}

/** Marker -> camera -> pixels. */
export function projectPoint(K: Intrinsics, pose: Pose, Xm: Vec3): Point2 | null {
  const y = mat3MulVec(pose.R, Xm);
  return projectCamPoint(K, [y[0] + pose.t[0], y[1] + pose.t[1], y[2] + pose.t[2]]);
}

/** Marker-frame corners in detector order TL, TR, BR, BL for a code of side s. */
export function markerCorners(s: number): Vec3[] {
  const h = s / 2;
  return [
    [-h, +h, 0],
    [+h, +h, 0],
    [+h, -h, 0],
    [-h, -h, 0],
  ];
}

/** RMS reprojection error in pixels (Infinity if any point is behind the camera). */
export function reprojectionRms(K: Intrinsics, pose: Pose, objectPts: readonly Vec3[], imagePts: readonly Point2[]): number {
  let sse = 0;
  for (let i = 0; i < objectPts.length; i++) {
    const p = projectPoint(K, pose, objectPts[i]);
    if (!p) return Infinity;
    sse += (p[0] - imagePts[i][0]) ** 2 + (p[1] - imagePts[i][1]) ** 2;
  }
  return Math.sqrt(sse / objectPts.length);
}
