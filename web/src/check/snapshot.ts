// Full-resolution snapshot of the camera frame for the as-built check (spec 4.2 step 4).
import type { Point } from '../qr/protocol'
import type { QrWorkerClient } from '../qr/qrClient'

export const MAX_PHOTO_SIDE = 1600
export const PHOTO_QUALITY = 0.85

export type Snapshot = { photo: Blob; photoW: number; photoH: number; videoW: number; videoH: number; corners: Point[] | null }

/** Photo size: the video frame scaled so its long side is at most 1600 px (same aspect). */
export function photoSize(videoW: number, videoH: number, maxSide = MAX_PHOTO_SIDE): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(videoW, videoH))
  return { w: Math.round(videoW * k), h: Math.round(videoH * k) }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encoding failed'))), type, quality))
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

  let corners: Point[] | null = null
  if (qr) {
    while (qr.busy) await new Promise((r) => setTimeout(r, 10))
    const res = await qr.detect(fctx.getImageData(0, 0, videoW, videoH))
    corners = res.detection?.corners ?? null
  }
  return { photo, photoW: w, photoH: h, videoW, videoH, corners }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return toBlob(canvas, 'image/png')
}
