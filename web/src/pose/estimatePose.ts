/**
 * Top-level single-frame pose: corners (TL, TR, BR, BL, pixels) + printed code
 * size s (metres) + intrinsics -> marker pose, RMS, quality, distance.
 *
 * Pipeline (spec section 7.1 steps 2-4, 7):
 *   1. sanity checks on the corner quadrilateral (finite, convex, and
 *      clockwise on screen, i.e. the printed face is toward the camera);
 *   2. 4-point normalised DLT homography (homography.ts);
 *   3. both IPPE candidates (planarPose.ts); if IPPE is degenerate, fall back
 *      to the single homography decomposition (poseFromHomography.ts);
 *   4. Levenberg-Marquardt refinement of every candidate (refinePose.ts);
 *   5. choose: lower RMS, or the one nearer `prev` when ambiguous;
 *   6. quality grade (quality.ts).
 * Conventions: see camera.ts.
 */
import { type Intrinsics, type Pose, markerCorners } from './camera';
import { homographyDLT } from './homography';
import { type Point2, type Vec3, norm3 } from './linalg';
import { chooseCandidate, type ChooseOptions, ippeCandidates } from './planarPose';
import { poseFromHomography } from './poseFromHomography';
import { type RefinedPose, refinePose } from './refinePose';
import { type Quality, codeWidthPx, gradeQuality } from './quality';

export interface PoseEstimate extends RefinedPose {
  quality: Quality;
  /** Straight-line distance from the camera to the code centre, metres. */
  distanceM: number;
  /** Mean side length of the code in pixels. */
  widthPx: number;
  /** Both candidates fit about equally well (see planarPose.chooseCandidate). */
  ambiguous: boolean;
  /** The rejected candidate, if any (useful for debugging the flip). */
  alternative: RefinedPose | null;
  reason: 'only' | 'rms' | 'previous';
}

export interface EstimateOptions extends ChooseOptions {
  maxIterations?: number;
}

/** Signed area (shoelace) of a polygon in pixel coordinates (v down). Positive = clockwise on screen. */
export function signedAreaPx(pts: readonly Point2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Convex quadrilateral with consistent clockwise-on-screen winding. */
export function isValidQuad(c: readonly Point2[]): boolean {
  if (c.length !== 4 || !c.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
    const crossZ = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
    if (!(crossZ > 0)) return false;
  }
  return true;
}

export function estimatePose(
  cornersPx: readonly Point2[],
  s: number,
  K: Intrinsics,
  prev?: Pose | null,
  opts: EstimateOptions = {},
): PoseEstimate | null {
  if (!isValidQuad(cornersPx) || !(s > 0)) return null;
  const obj = markerCorners(s);
  const H = homographyDLT(obj.map((p) => [p[0], p[1]] as Point2), cornersPx);
  if (!H) return null;
  let inits: Pose[] = ippeCandidates(H, K, obj, cornersPx);
  if (inits.length === 0) {
    const p = poseFromHomography(H, K);
    if (p) inits = [p];
  }
  const refined = inits.map((p) => refinePose(p, obj, cornersPx, K, { maxIterations: opts.maxIterations }));
  const choice = chooseCandidate(refined, prev, opts);
  if (!choice) return null;
  const widthPx = codeWidthPx(cornersPx);
  const best = choice.best;
  return {
    ...best,
    quality: gradeQuality(best.rmsPx, widthPx),
    distanceM: norm3(best.t as Vec3),
    widthPx,
    ambiguous: choice.ambiguous,
    alternative: choice.other,
    reason: choice.reason,
  };
}
