/**
 * Holds the QR code's corners steady while the camera is still (a phone on a stand, a steady hand).
 * The QR reader gives whole pixels of what it reads, so the corners of a still code flicker by a pixel or more, and
 * the pose turns that flicker into a visible shake of a model that reaches metres from the code (measured on the
 * ray-traced videos: 44 px per frame at 1.5 m without the motion sensors). While every corner stays within the
 * flicker band of its running average, the running average is used: an exponential mean over about `tauS`, which
 * converges to well under a pixel. A corner moving further than the band (the camera moved) resets to the new corners
 * at once, so a real move is never smoothed away. The band scales with how coarse the read was (`noisePx`, video px:
 * half a pixel of the read). The longer the code stays still, the longer the average (up to TAU_MAX_S): on a stand the
 * corners settle to a hundredth of a pixel. stillFor() says how long that has been: the overlay then also holds the
 * motion sensors' reading still (the camera can't have turned while the code didn't move).
 */
import type { Point2 } from '../pose'

/** The flicker band is this many times the read's corner noise, and at least MIN_BAND_PX. */
const BAND_PER_NOISE = 6
const MIN_BAND_PX = 2.5
/** The averaging time grows by this much per second of stillness, up to TAU_MAX_S. */
const TAU_GROWTH = 1
const TAU_MAX_S = 2

export class CornerStabilizer {
  private avg: Point2[] | null = null
  private tSec = 0
  private stillSince: number | null = null
  private readonly tauS: number

  constructor(tauS = 0.35) {
    this.tauS = tauS
  }

  /** The corners to use for this frame's pose (TL, TR, BR, BL; video px). */
  update(corners: readonly Point2[], tSec: number, noisePx: number): Point2[] {
    const band = Math.max(MIN_BAND_PX, BAND_PER_NOISE * noisePx)
    const avg = this.avg
    if (!avg || avg.length !== corners.length || corners.some((p, i) => Math.hypot(p[0] - avg[i][0], p[1] - avg[i][1]) > band)) {
      this.avg = corners.map((p) => [p[0], p[1]] as Point2)
      this.tSec = tSec
      this.stillSince = tSec
      return corners.map((p) => [p[0], p[1]] as Point2)
    }
    const tau = Math.min(TAU_MAX_S, this.tauS + TAU_GROWTH * this.stillFor(tSec))
    const k = 1 - Math.exp(-Math.max(0, tSec - this.tSec) / tau)
    this.tSec = tSec
    this.avg = avg.map((a, i) => [a[0] + k * (corners[i][0] - a[0]), a[1] + k * (corners[i][1] - a[1])] as Point2)
    return this.avg.map((p) => [p[0], p[1]] as Point2)
  }

  /** How long (s) the code has stayed within the flicker band, as of tSec; 0 right after a move or a reset. */
  stillFor(tSec: number): number {
    return this.stillSince === null ? 0 : Math.max(0, tSec - this.stillSince)
  }

  reset(): void {
    this.avg = null
    this.stillSince = null
  }
}
