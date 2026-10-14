// Rear-camera startup for iOS Safari and Android Chrome.
// Requirements: secure context (HTTPS or localhost), call from a user gesture (tap),
// <video playsinline muted autoplay> (iOS goes fullscreen without playsinline).

export interface CameraStart {
  stream: MediaStream
  track: MediaStreamTrack
  /** what the browser reports for the track (sensor orientation on iOS; may be landscape in portrait) */
  settings: MediaTrackSettings
  /** actual frame size delivered to <video>, already rotated for display: use THIS for intrinsics */
  width: number
  height: number
}

export class CameraError extends Error {
  readonly kind: 'insecure' | 'denied' | 'notfound' | 'overconstrained' | 'other'
  constructor(kind: CameraError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' }, // `exact` throws OverconstrainedError on laptops
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  },
}

export async function startRearCamera(video: HTMLVideoElement, constraints = REAR_CAMERA_CONSTRAINTS): Promise<CameraStart> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    // In insecure contexts navigator.mediaDevices is undefined.
    throw new CameraError('insecure', 'Camera needs HTTPS (or localhost).')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    const name = (e as DOMException).name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied', 'Camera permission denied.')
    if (name === 'NotFoundError') throw new CameraError('notfound', 'No camera found.')
    if (name === 'OverconstrainedError') throw new CameraError('overconstrained', 'Camera cannot satisfy the requested settings.')
    throw new CameraError('other', String(e))
  }
  video.setAttribute('playsinline', '') // iOS: inline, not fullscreen
  video.setAttribute('autoplay', '')
  video.muted = true // autoplay without a further gesture
  video.srcObject = stream
  await new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve()
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true })
  })
  await video.play()
  const [track] = stream.getVideoTracks()
  return { stream, track, settings: track.getSettings(), width: video.videoWidth, height: video.videoHeight }
}

export function stopCamera(cam: CameraStart | null, video?: HTMLVideoElement): void {
  cam?.stream.getTracks().forEach((t) => t.stop())
  if (video) video.srcObject = null
}

/** Grab a downscaled frame for detection. Area-averaged downscaling also suppresses sensor noise (helps jsQR a lot). */
export function grabFrame(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, targetWidth = 640): ImageData {
  const w = targetWidth
  const h = Math.round((video.videoHeight / video.videoWidth) * w)
  if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx.canvas.width = w
    ctx.canvas.height = h
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}
