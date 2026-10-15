// Camera calibration (spec 7.2): collect ~30 tilted views of the code while the user slowly
// tilts the phone, then solve for the focal length (planar self-calibration, pose module).
import { centredIntrinsics, focalFromHfov, homographyDLT, markerCorners, selfCalibrateFocal, viewTiltDeg, type CalibrationResult, type Point2 } from '../pose'
import { DEFAULT_HFOV_DEG, QR_SCALE_LIMITS } from '../camera/intrinsics'

export const TARGET_VIEWS = 30
export const MIN_TILT_DEG = 15
/** A view must differ from every accepted view by at least this mean corner shift (video px). */
export const MIN_CORNER_SHIFT_PX = 12

export type OfferResult = 'accepted' | 'flat' | 'duplicate' | 'full' | 'invalid'

export class ViewCollector {
  readonly views: Point2[][] = []
  readonly s: number
  readonly width: number
  readonly height: number
  private readonly prior
  private readonly plane: Point2[]

  constructor(s: number, width: number, height: number) {
    this.s = s
    this.width = width
    this.height = height
    this.prior = centredIntrinsics(focalFromHfov(DEFAULT_HFOV_DEG, Math.max(width, height)), width, height)
    this.plane = markerCorners(s).map((p) => [p[0], p[1]] as Point2)
  }

  get done(): boolean {
    return this.views.length >= TARGET_VIEWS
  }

  /** Corners (TL, TR, BR, BL; video px) of one frame. Only informative, new views are kept. */
  offer(corners: readonly Point2[]): OfferResult {
    if (this.done) return 'full'
    const H = corners.length === 4 ? homographyDLT(this.plane, corners) : null
    const tilt = H ? viewTiltDeg(H, this.prior) : null
    if (tilt === null) return 'invalid'
    if (tilt < MIN_TILT_DEG) return 'flat'
    const close = this.views.some((v) => v.reduce((sum, p, i) => sum + Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]), 0) / 4 < MIN_CORNER_SHIFT_PX)
    if (close) return 'duplicate'
    this.views.push(corners.map((p) => [p[0], p[1]] as Point2))
    return 'accepted'
  }

  solve(): CalibrationResult | null {
    return selfCalibrateFocal(this.views, this.s, this.width / 2, this.height / 2, { fGuess: this.prior.f })
  }
}

/** Print-scale correction from the measured 10 cm check bar (mm); throws when the print is unusable. */
export function scaleFactorFromBar(measuredMm: number): number {
  const factor = measuredMm / 100
  if (!(factor >= QR_SCALE_LIMITS[0] && factor <= QR_SCALE_LIMITS[1])) {
    throw new Error('That is too far from 100 mm: reprint the sheet at 100% (no "fit to page").')
  }
  return factor
}
