/**
 * Where the QR reader looks in each video frame. Until the code is found it reads the whole frame at 640 px wide.
 * Once found, it reads a crop around the code's last corners at the camera's own resolution (scaled down only past
 * 640 px): the corners come out 2-3x more precise, which matters for the 16 cm code on a US Letter sheet (the pose's
 * angle comes from them), and a crop is less work than the whole frame. Margin: 0.8 code widths each side, room for
 * the code to move between frames and for its quiet zone.
 */
import type { Point2 } from '../pose'
import type { Point } from '../qr/protocol'

/** A rectangle of the video frame (video px, sx/sy/sw/sh) and the size it is read at (outW x outH px). */
export type Region = { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number }

export const FULL_FRAME_PX = 640
const MARGIN = 0.8
const MAX_CROP_PX = 640
/** A crop this much of the frame or more: read the whole frame instead. */
const MOST_OF_FRAME = 0.6

export function fullFrame(videoW: number, videoH: number, width = FULL_FRAME_PX): Region {
  return { sx: 0, sy: 0, sw: videoW, sh: videoH, outW: width, outH: Math.round((videoH / videoW) * width) }
}

/** The crop around the code's last corners (video px), or null when it would be most of the frame anyway. */
export function regionAround(corners: readonly Point2[], videoW: number, videoH: number): Region | null {
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * MARGIN
  const sx = Math.max(0, Math.floor(Math.min(...xs) - pad))
  const sy = Math.max(0, Math.floor(Math.min(...ys) - pad))
  const sw = Math.min(videoW, Math.ceil(Math.max(...xs) + pad)) - sx
  const sh = Math.min(videoH, Math.ceil(Math.max(...ys) + pad)) - sy
  if (sw <= 0 || sh <= 0 || sw * sh >= MOST_OF_FRAME * videoW * videoH) return null
  const k = Math.min(1, MAX_CROP_PX / Math.max(sw, sh))
  return { sx, sy, sw, sh, outW: Math.max(1, Math.round(sw * k)), outH: Math.max(1, Math.round(sh * k)) }
}

/** Corners read in a region (its pixels) back to video pixels, for the pose. */
export function regionToVideo(corners: readonly Point[], r: Region): Point2[] {
  return corners.map((p) => [r.sx + (p.x * r.sw) / r.outW, r.sy + (p.y * r.sh) / r.outH] as Point2)
}
