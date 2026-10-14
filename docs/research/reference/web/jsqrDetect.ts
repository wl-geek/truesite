import jsQR from 'jsqr'

/**
 * Pixel coordinates use the "pixel-edge" convention that jsQR uses internally:
 * pixel (i, j) covers [i, i+1) x [j, j+1), so its centre is (i + 0.5, j + 0.5)
 * and the image spans [0, width] x [0, height].
 */
export interface Pt {
  x: number
  y: number
}

/** A point in the image whose position on the symbol is known exactly, in module units. */
export interface QrCorrespondence {
  /** symbol coordinates in modules: (0,0) is the outer top-left corner, (N,N) the outer bottom-right */
  module: Pt
  image: Pt
}

export interface QrDetection {
  data: string
  version: number
  /** modules per side, N = 17 + 4 * version */
  dimension: number
  /**
   * Outer corners of the symbol (not the quiet zone), in SYMBOL order:
   * [topLeft, topRight, bottomRight, bottomLeft] where "top-left" is the corner
   * with the finder pattern that is diagonally opposite the corner without one.
   * The order follows the code's own orientation, not the image's, so a code
   * held upside down returns topLeft near the image's bottom-right.
   * NOTE: jsQR extrapolates these from a homography through the 4 points below;
   * they carry no extra information beyond `points`.
   */
  corners: [Pt, Pt, Pt, Pt]
  /**
   * The 4 points jsQR actually measured (3 finder-pattern centres + the
   * bottom-right alignment pattern), with their exact symbol coordinates.
   * For version 1 (N = 21) the alignment point is a parallelogram guess, not a
   * measurement, so the payload should force version >= 2.
   */
  points: QrCorrespondence[]
}

export type InversionAttempts = 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst'

/**
 * Detect one QR code in an RGBA buffer (e.g. ImageData.data).
 *
 * jsQR gotcha: in 1.4.0 the options object MUTATES a shared module-level
 * default, so a value passed once sticks for later calls that omit it.
 * Always pass inversionAttempts explicitly.
 */
export function detectQr(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  inversionAttempts: InversionAttempts = 'dontInvert',
): QrDetection | null {
  const code = jsQR(rgba, width, height, { inversionAttempts })
  if (!code) return null
  const L = code.location
  const N = 17 + 4 * code.version
  const points: QrCorrespondence[] = [
    { module: { x: 3.5, y: 3.5 }, image: L.topLeftFinderPattern },
    { module: { x: N - 3.5, y: 3.5 }, image: L.topRightFinderPattern },
    { module: { x: 3.5, y: N - 3.5 }, image: L.bottomLeftFinderPattern },
  ]
  if (L.bottomRightAlignmentPattern) {
    points.push({ module: { x: N - 6.5, y: N - 6.5 }, image: L.bottomRightAlignmentPattern })
  }
  return {
    data: code.data,
    version: code.version,
    dimension: N,
    corners: [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner],
    points,
  }
}

/** Scale detections made on a downscaled frame back to full-resolution pixel-edge coordinates. */
export function scaleDetection(det: QrDetection, sx: number, sy: number): QrDetection {
  const s = (p: Pt): Pt => ({ x: p.x * sx, y: p.y * sy })
  return {
    ...det,
    corners: det.corners.map(s) as QrDetection['corners'],
    points: det.points.map((c) => ({ module: c.module, image: s(c.image) })),
  }
}
