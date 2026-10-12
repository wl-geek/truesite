/**
 * Per-frame pose tracking: estimatePose with the previous frame as the
 * flip tie-break, One Euro smoothing, and loss handling.
 *
 *  - `prev` for the tie-break is the previous RAW estimate (not the smoothed
 *    one, which lags during fast motion).
 *  - A flip that persists can only be corrected by a frame whose two
 *    candidates differ clearly in RMS (close or steep views). Until such an
 *    unambiguous frame has been seen since (re)acquisition, results are
 *    marked `provisional` and their quality is capped at 'fair'.
 *  - If the chosen rotation jumps by more than `jumpResetDeg` (a flip being
 *    corrected, or a different code), the smoother is reset so the overlay
 *    snaps instead of swinging through the jump.
 *  - No detection for `lostAfterSec`: everything resets.
 */
import { type Intrinsics } from './camera';
import { type EstimateOptions, type PoseEstimate, estimatePose } from './estimatePose';
import { type Point2 } from './linalg';
import { PoseSmoother } from './oneEuro';
import { type Quality } from './quality';
import { rotationAngleBetween } from './rotation';
import { type Pose } from './camera';

export interface TrackerOptions extends EstimateOptions {
  lostAfterSec?: number;
  jumpResetDeg?: number;
  smoother?: PoseSmoother;
}

export interface TrackedPose {
  raw: PoseEstimate;
  smoothed: Pose;
  quality: Quality;
  provisional: boolean;
}

export class PoseTracker {
  private prev: PoseEstimate | null = null;
  private lastSeen = -Infinity;
  private trusted = false;
  private smoother: PoseSmoother;

  s: number;
  K: Intrinsics;
  private opts: TrackerOptions;

  constructor(s: number, K: Intrinsics, opts: TrackerOptions = {}) {
    this.s = s;
    this.K = K;
    this.opts = opts;
    this.smoother = opts.smoother ?? new PoseSmoother();
  }

  reset(): void {
    this.prev = null;
    this.trusted = false;
    this.smoother.reset();
  }

  /** Feed one frame: detected corners (TL, TR, BR, BL; video px) or null if no code was found. */
  update(corners: readonly Point2[] | null, tSec: number): TrackedPose | null {
    if (tSec - this.lastSeen > (this.opts.lostAfterSec ?? 0.5)) this.reset();
    if (!corners) return null;
    const est = estimatePose(corners, this.s, this.K, this.prev, this.opts);
    if (!est) return null;
    this.lastSeen = tSec;
    if (this.prev && rotationAngleBetween(this.prev.R, est.R) > ((this.opts.jumpResetDeg ?? 30) * Math.PI) / 180) {
      this.smoother.reset();
    }
    if (!est.ambiguous) this.trusted = true;
    this.prev = est;
    const smoothed = this.smoother.filter(est, tSec);
    const provisional = !this.trusted;
    const quality: Quality = provisional && est.quality === 'good' ? 'fair' : est.quality;
    return { raw: est, smoothed, quality, provisional };
  }
}
