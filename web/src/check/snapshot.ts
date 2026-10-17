// Full-resolution snapshot of the camera frame for the as-built check (spec 4.2 step 4).
import type { Pose, Quality } from '../pose'
import { parseAnchorLink } from '../qr/link'
import type { Point, QrDetection } from '../qr/protocol'
import type { QrWorkerClient } from '../qr/qrClient'

export const MAX_PHOTO_SIDE = 1600
export const PHOTO_QUALITY = 0.85
/** How long the snapshot waits for an in-flight tracking frame before it gives up on the full-frame read. */
export const QR_WAIT_MS = 1000
/** A pose tracked this recently before the tap stands in when the full frame has no usable code. */
export const FALLBACK_POSE_S = 0.5

/** `text` is the decoded payload: use `corners` only when it is this anchor's link (see anchorCorners). */
export type Snapshot = { photo: Blob; photoW: number; photoH: number; videoW: number; videoH: number; corners: Point[] | null; text: string | null }

/** Photo size: the video frame scaled so its long side is at most 1600 px (same aspect). */
export function photoSize(videoW: number, videoH: number, maxSide = MAX_PHOTO_SIDE): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(videoW, videoH))
  return { w: Math.round(videoW * k), h: Math.round(videoH * k) }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encoding failed'))), type, quality))
}

/**
 * Re-detect the code on one frame. Waits at most `waitMs` for the reader to be free (a dead or stuck
 * reader must not hang the check), then gives up with null.
 */
export async function readFullFrame(qr: Pick<QrWorkerClient, 'busy' | 'detect'>, img: ImageData, waitMs = QR_WAIT_MS): Promise<QrDetection | null> {
  const t0 = Date.now()
  while (qr.busy) {
    if (Date.now() - t0 >= waitMs) return null
    await new Promise((r) => setTimeout(r, 10))
  }
  return (await qr.detect(img)).detection
}

/** The snapshot's corners when its code is THIS anchor's link; a permit tag or another anchor's code must not set the pose. */
export function anchorCorners(snap: Pick<Snapshot, 'text' | 'corners'>, anchor: { project_id: string; anchor_id: string }, origin: string): Point[] | null {
  if (!snap.text || !snap.corners) return null
  const link = parseAnchorLink(snap.text, origin)
  return link && link.projectId === anchor.project_id && link.anchorId === anchor.anchor_id ? snap.corners : null
}

/** The last tracked pose if it was seen within 0.5 s of the tap (`tCapture`, taken before any async work), else null. */
export function fallbackPose(last: { pose: Pose; tSec: number } | null, tCapture: number): Pose | null {
  return last && tCapture - last.tSec < FALLBACK_POSE_S ? last.pose : null
}

/**
 * The snapshot estimate's grade. An ambiguous estimate was picked by the tracker's last pose, which may be
 * flipped until the tracker has seen an unambiguous frame: the same cap as PoseTracker (good -> fair).
 */
export function snapshotQuality(est: { quality: Quality; ambiguous: boolean }, priorTrusted: boolean): Quality {
  return est.ambiguous && !priorTrusted && est.quality === 'good' ? 'fair' : est.quality
}

/**
 * Grab the current video frame. When a QR client is given, the code is re-detected on the
 * FULL-resolution frame (more accurate corners than the 640 px tracking frames), in video pixels.
 */
export async function captureSnapshot(video: HTMLVideoElement, qr?: QrWorkerClient): Promise<Snapshot> {
  const videoW = video.videoWidth
  const videoH = video.videoHeight
  if (!videoW || !videoH) throw new Error('The camera is not ready yet.')
  const full = document.createElement('canvas')
  full.width = videoW
  full.height = videoH
  const fctx = full.getContext('2d', { willReadFrequently: true })
  if (!fctx) throw new Error('2D canvas is not available')
  fctx.drawImage(video, 0, 0, videoW, videoH)

  const { w, h } = photoSize(videoW, videoH)
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  const sctx = small.getContext('2d')
  if (!sctx) throw new Error('2D canvas is not available')
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(full, 0, 0, w, h)
  const photo = await toBlob(small, 'image/jpeg', PHOTO_QUALITY)

  const detection = qr ? await readFullFrame(qr, fctx.getImageData(0, 0, videoW, videoH)) : null
  return { photo, photoW: w, photoH: h, videoW, videoH, corners: detection?.corners ?? null, text: detection?.text ?? null }
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = PHOTO_QUALITY): Promise<Blob> {
  return toBlob(canvas, 'image/jpeg', quality)
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return toBlob(canvas, 'image/png')
}
