/**
 * Alignment-quality badge (spec section 7.1 step 7):
 *   good: RMS reprojection error < 2 px AND code wider than 120 px
 *   fair: RMS < 4 px AND code wider than 70 px
 *   poor: anything else (the check is still allowed but flagged)
 *
 * Both numbers must be in the SAME pixel units as the pose maths: the video
 * frame (video.videoWidth x videoHeight), not CSS pixels and not the
 * downscaled detection frame. "Code width" is the mean of the four side
 * lengths of the detected quadrilateral.
 */
import { type Point2 } from './linalg';

export type Quality = 'good' | 'fair' | 'poor';

export const QUALITY_THRESHOLDS = {
  good: { maxRmsPx: 2, minWidthPx: 120 },
  fair: { maxRmsPx: 4, minWidthPx: 70 },
} as const;

export function gradeQuality(rmsPx: number, codeWidthPx: number): Quality {
  if (!Number.isFinite(rmsPx) || !Number.isFinite(codeWidthPx)) return 'poor';
  const { good, fair } = QUALITY_THRESHOLDS;
  if (rmsPx < good.maxRmsPx && codeWidthPx > good.minWidthPx) return 'good';
  if (rmsPx < fair.maxRmsPx && codeWidthPx > fair.minWidthPx) return 'fair';
  return 'poor';
}

/** Mean side length (px) of the corner quadrilateral TL, TR, BR, BL. */
export function codeWidthPx(corners: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum / 4;
}
