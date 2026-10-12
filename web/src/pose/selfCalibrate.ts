/**
 * Focal-length self-calibration from views of a planar code (spec 7.2).
 *
 * Model: square pixels, zero skew, principal point (cx, cy) known (image
 * centre), so f is the only unknown. Shift pixels so the principal point is
 * the origin: H' = T H with T = [[1,0,-cx],[0,1,-cy],[0,0,1]]. Then
 * H' ~ diag(f, f, 1) [r1 r2 t], and with omega = K'^-T K'^-1 =
 * diag(1/f^2, 1/f^2, 1) the orthonormality of r1, r2 gives (Zhang 2000):
 *     h1^T omega h2 = 0             -> (h11 h12 + h21 h22) w + h31 h32 = 0
 *     h1^T omega h1 = h2^T omega h2 -> (h11^2 + h21^2 - h12^2 - h22^2) w + (h31^2 - h32^2) = 0
 * with w = 1/f^2: two equations linear in w per view. (Pixels are divided by
 * fGuess first so w is ~1; this is only for conditioning.)
 *
 * Near-fronto-parallel views carry no information: if the code plane is
 * parallel to the image, h31 = h32 = 0 and both equations read 0 = 0. The
 * gate: decompose H with the rough fGuess and skip the view if the angle
 * between the code normal and the optical axis is below `minTiltDeg`
 * (default 15 deg). The gate only needs a rough angle: with fGuess 16% off
 * the estimated tilt was within 6 deg in tests. NOTE: "head-on" means the code
 * plane is parallel to the IMAGE plane, not that the code faces the viewer: an
 * off-centre code seen square-on is tilted relative to the optical axis and
 * is informative.
 *
 * Estimator:
 *   1. per view: least-squares w from its two equations, f_i = fGuess/sqrt(w);
 *      views with w <= 0 are dropped;
 *   2. robust start: median of f_i; inliers within +-15% of it; then drop
 *      views whose reprojection RMS at the median f is an outlier (a bad
 *      corner can still give a plausible f_i);
 *   3. maximum-likelihood refinement (default on): golden-section search for
 *      the f that minimises the total corner reprojection error over the
 *      inlier views, re-estimating every view's pose (IPPE + LM) at each f.
 */
import { type Intrinsics, type Pose, markerCorners } from './camera';
import { homographyDLT } from './homography';
import { type Mat3, type Point2, median } from './linalg';
import { chooseCandidate, ippeCandidates } from './planarPose';
import { poseFromHomography } from './poseFromHomography';
import { refinePose } from './refinePose';

export interface CalibrationOptions {
  /** Rough focal length (px), e.g. from a 63 deg horizontal FOV. Used for the tilt gate, conditioning and the search bracket. */
  fGuess: number;
  /** Skip views whose code plane is within this angle of fronto-parallel (default 15). */
  minTiltDeg?: number;
  /** Maximum-likelihood refinement of f over reprojection error (default true). */
  refine?: boolean;
  /** Inlier band around the median, as a fraction (default 0.15). */
  inlierBand?: number;
  /** Views fitting worse than max(this, 3 x median) px RMS at the median f are dropped (default 1.5). */
  maxViewRmsPx?: number;
}

export interface CalibrationResult {
  /** Final focal length (px). */
  f: number;
  /** Median of the per-view closed-form estimates (px). */
  fClosedForm: number;
  perViewF: number[];
  viewsUsed: number;
  viewsSkippedTilt: number;
  viewsRejected: number;
  /** RMS corner reprojection error at f over the inlier views (px). */
  rmsPx: number;
}

/** The two linear constraints a*w + b = 0 of one view (pixels pre-divided by `unit`). */
export function focalConstraints(H: Mat3, cx: number, cy: number, unit: number): { a: [number, number]; b: [number, number] } {
  // H' = diag(1/unit, 1/unit, 1) * T * H
  const r0 = [(H[0] - cx * H[6]) / unit, (H[1] - cx * H[7]) / unit];
  const r1 = [(H[3] - cy * H[6]) / unit, (H[4] - cy * H[7]) / unit];
  const r2 = [H[6], H[7]];
  const a1 = r0[0] * r0[1] + r1[0] * r1[1];
  const b1 = r2[0] * r2[1];
  const a2 = r0[0] * r0[0] + r1[0] * r1[0] - r0[1] * r0[1] - r1[1] * r1[1];
  const b2 = r2[0] * r2[0] - r2[1] * r2[1];
  return { a: [a1, a2], b: [b1, b2] };
}

/** Closed-form focal length (px) from one homography, or null if the view gives w <= 0. */
export function focalFromHomography(H: Mat3, cx: number, cy: number, unit = 1000): number | null {
  const { a, b } = focalConstraints(H, cx, cy, unit);
  const den = a[0] * a[0] + a[1] * a[1];
  if (!(den > 0)) return null;
  const w = -(a[0] * b[0] + a[1] * b[1]) / den;
  if (!(w > 0) || !Number.isFinite(w)) return null;
  return unit / Math.sqrt(w);
}

/** Angle (deg) between the code normal and the optical axis, using a rough f. */
export function viewTiltDeg(H: Mat3, K: Intrinsics): number | null {
  const pose = poseFromHomography(H, K);
  if (!pose) return null;
  return (Math.acos(Math.min(1, Math.abs(pose.R[8]))) * 180) / Math.PI;
}

/** Per-view RMS reprojection error (px) at focal length f, each view's pose re-estimated (IPPE + LM). */
function perViewRms(f: number, cx: number, cy: number, views: readonly Point2[][], s: number): number[] {
  const K: Intrinsics = { f, cx, cy };
  const obj = markerCorners(s);
  const obj2 = obj.map((p) => [p[0], p[1]] as Point2);
  return views.map((img) => {
    const H = homographyDLT(obj2, img);
    if (!H) return Infinity;
    let inits: Pose[] = ippeCandidates(H, K, obj, img);
    if (inits.length === 0) {
      const p = poseFromHomography(H, K);
      if (p) inits = [p];
    }
    const choice = chooseCandidate(inits.map((p) => refinePose(p, obj, img, K)));
    return choice ? choice.best.rmsPx : Infinity;
  });
}

/** Total squared reprojection error (px^2) over views at focal length f. */
function totalSse(f: number, cx: number, cy: number, views: readonly Point2[][], s: number): number {
  return perViewRms(f, cx, cy, views, s).reduce((acc, r) => acc + r * r * 4, 0);
}

/**
 * Estimate f from several views of one code. `views[i]` are the detected
 * corners (TL, TR, BR, BL, pixels) of view i; `s` is the printed code size (m).
 */
export function selfCalibrateFocal(
  views: readonly Point2[][],
  s: number,
  cx: number,
  cy: number,
  opts: CalibrationOptions,
): CalibrationResult | null {
  const minTilt = opts.minTiltDeg ?? 15;
  const band = opts.inlierBand ?? 0.15;
  const Kguess: Intrinsics = { f: opts.fGuess, cx, cy };
  const obj2 = markerCorners(s).map((p) => [p[0], p[1]] as Point2);
  let skippedTilt = 0;
  let rejected = 0;
  const cand: { f: number; img: Point2[] }[] = [];
  for (const img of views) {
    const H = homographyDLT(obj2, img);
    if (!H) { rejected++; continue; }
    const tilt = viewTiltDeg(H, Kguess);
    if (tilt === null || tilt < minTilt) { skippedTilt++; continue; }
    const f = focalFromHomography(H, cx, cy, opts.fGuess);
    if (f === null) { rejected++; continue; }
    cand.push({ f, img });
  }
  if (cand.length < 3) return null;
  const fMed = median(cand.map((c) => c.f));
  const inliers = cand.filter((c) => Math.abs(c.f - fMed) <= band * fMed);
  rejected += cand.length - inliers.length;
  if (inliers.length < 3) return null;
  // A bad corner can still give a plausible f_i. Such views fit badly at
  // fMed: drop views whose RMS exceeds max(maxViewRmsPx, 3 x median RMS).
  const rmsAtMed = perViewRms(fMed, cx, cy, inliers.map((c) => c.img), s);
  const rmsGate = Math.max(opts.maxViewRmsPx ?? 1.5, 3 * median(rmsAtMed));
  const kept = inliers.filter((_, i) => rmsAtMed[i] <= rmsGate);
  rejected += inliers.length - kept.length;
  if (kept.length < 3) return null;
  const imgs = kept.map((c) => c.img);

  let f = fMed;
  if (opts.refine ?? true) {
    // Golden-section search on [0.85, 1.15] * fMed.
    let lo = 0.85 * fMed, hi = 1.15 * fMed;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
    let f1 = totalSse(x1, cx, cy, imgs, s), f2 = totalSse(x2, cx, cy, imgs, s);
    for (let it = 0; it < 40 && hi - lo > 1e-4 * fMed; it++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = totalSse(x1, cx, cy, imgs, s); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = totalSse(x2, cx, cy, imgs, s); }
    }
    f = 0.5 * (lo + hi);
  }
  const rmsPx = Math.sqrt(totalSse(f, cx, cy, imgs, s) / (imgs.length * 4));
  return {
    f,
    fClosedForm: fMed,
    perViewF: cand.map((c) => c.f),
    viewsUsed: imgs.length,
    viewsSkippedTilt: skippedTilt,
    viewsRejected: rejected,
    rmsPx,
  };
}
