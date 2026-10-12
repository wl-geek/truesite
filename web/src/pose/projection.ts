/**
 * OpenGL / three.js projection matrix from pinhole intrinsics, accounting for
 * how the <video> is fitted into the viewport by CSS object-fit.
 *
 * Inputs:
 *  - K = (f, cx, cy) in VIDEO pixels (video.videoWidth x video.videoHeight =
 *    W x H; u right, v down, origin top-left; see camera.ts);
 *  - the viewport (the canvas drawn over the video) is Vw x Vh CSS pixels and
 *    the video element fills it with `object-fit: cover` (default) or
 *    `contain`, centred (object-position: 50% 50%).
 *
 * Fit: scale c = max(Vw/W, Vh/H) for cover (min for contain); the video is
 * drawn at W*c x H*c, offset by ox = (Vw - W c)/2, oy = (Vh - H c)/2 (negative
 * = cropped). A video pixel (u, v) appears at viewport pixel
 * (ox + c u, oy + c v), so the viewport intrinsics are
 *   f' = c f,  cx' = ox + c cx,  cy' = oy + c cy.
 *
 * three.js camera frame: x right, y up, looking down -z. A CV camera point
 * (x, y, z) is the GL point (x, -y, -z) (see modelMatrix.CV_TO_GL). With
 * clip w = -z_gl, NDC x = 2u'/Vw - 1 and NDC y = 1 - 2v'/Vh:
 *
 *       [ 2f'/Vw   0        1 - 2cx'/Vw       0          ]
 *   P = [ 0        2f'/Vh   2cy'/Vh - 1       0          ]
 *       [ 0        0        -(F+N)/(F-N)     -2FN/(F-N)  ]
 *       [ 0        0        -1                0          ]
 *
 * Returned COLUMN-MAJOR (16 numbers) for three.js Matrix4.fromArray. Device
 * pixel ratio does not matter: NDC is resolution independent.
 */
import { type Intrinsics } from './camera';
import { type Point2 } from './linalg';

export type ObjectFit = 'cover' | 'contain';

export interface FitTransform {
  /** Video pixel -> viewport pixel scale. */
  scale: number;
  /** Viewport position of video pixel (0, 0). */
  offsetX: number;
  offsetY: number;
}

export function fitTransform(W: number, H: number, Vw: number, Vh: number, fit: ObjectFit = 'cover'): FitTransform {
  const scale = fit === 'cover' ? Math.max(Vw / W, Vh / H) : Math.min(Vw / W, Vh / H);
  return { scale, offsetX: (Vw - W * scale) / 2, offsetY: (Vh - H * scale) / 2 };
}

export function videoToViewport(m: FitTransform, p: Point2): Point2 {
  return [m.offsetX + m.scale * p[0], m.offsetY + m.scale * p[1]];
}

/** Inverse of videoToViewport, e.g. for taps on the screen. */
export function viewportToVideo(m: FitTransform, p: Point2): Point2 {
  return [(p[0] - m.offsetX) / m.scale, (p[1] - m.offsetY) / m.scale];
}

/** Intrinsics of the viewport "camera" (CSS pixels). */
export function viewportIntrinsics(K: Intrinsics, m: FitTransform): Intrinsics {
  return { f: m.scale * K.f, cx: m.offsetX + m.scale * K.cx, cy: m.offsetY + m.scale * K.cy };
}

export interface ProjectionInput {
  K: Intrinsics;
  /** Video frame size (px). */
  videoW: number;
  videoH: number;
  /** Viewport size (CSS px). */
  viewW: number;
  viewH: number;
  near: number;
  far: number;
  fit?: ObjectFit;
}

/** Column-major 4x4 projection matrix for three.js (camera.projectionMatrix.fromArray). */
export function projectionMatrixGL(inp: ProjectionInput): number[] {
  const m = fitTransform(inp.videoW, inp.videoH, inp.viewW, inp.viewH, inp.fit ?? 'cover');
  const Kv = viewportIntrinsics(inp.K, m);
  const { viewW: Vw, viewH: Vh, near: N, far: F } = inp;
  // Row-major entries, then transposed into column-major order.
  const p00 = (2 * Kv.f) / Vw;
  const p02 = 1 - (2 * Kv.cx) / Vw;
  const p11 = (2 * Kv.f) / Vh;
  const p12 = (2 * Kv.cy) / Vh - 1;
  const p22 = -(F + N) / (F - N);
  const p23 = (-2 * F * N) / (F - N);
  // column 0, column 1, column 2, column 3
  return [
    p00, 0, 0, 0,
    0, p11, 0, 0,
    p02, p12, p22, -1,
    0, 0, p23, 0,
  ];
}

/** Apply a column-major 4x4 to (x, y, z, 1) and divide by w (like three.js Vector3.applyMatrix4). */
export function applyMat4ColumnMajor(m: readonly number[], p: readonly number[]): [number, number, number] {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** NDC (x right, y up, -1..1) -> viewport pixels (u right, v down). */
export function ndcToViewport(ndc: readonly number[], Vw: number, Vh: number): Point2 {
  return [((ndc[0] + 1) / 2) * Vw, ((1 - ndc[1]) / 2) * Vh];
}
