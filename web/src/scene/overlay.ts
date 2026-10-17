/**
 * Live AR overlay: the camera <video> under a transparent WebGL canvas.
 *
 * Every video frame: grab a ~640 px frame -> zxing worker (skipped while busy: latest frame wins)
 * -> corners back to video pixels -> PoseTracker (IPPE + previous-pose prior + One Euro smoothing).
 * With the motion sensors on, each detection feeds PoseFusion (fusion.ts) and every frame is posed from it and the
 * device rotation at that frame's capture time: the model holds still in the world instead of shaking with the QR
 * pose's noise, and turns with the device without waiting for a detection. Without sensors, the smoothed QR pose
 * is used directly. ifcRoot.matrix = modelMatrixIfc(anchor, pose). The AR camera sits at the origin with an
 * identity world matrix; only its projection changes (projectionMatrixGL, object-fit: cover).
 */
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import type { Anchor as ApiAnchor } from '../api/types'
import { grabFrame } from '../camera/camera'
import { loadIntrinsics } from '../camera/intrinsics'
import { modelMatrixIfc, PoseSmoother, PoseTracker, projectionMatrixGL, type Intrinsics, type Mat3, type OneEuroParams, type Point2, type Pose, type Quality } from '../pose'
import { parseAnchorLink } from '../qr/link'
import type { QrResponse } from '../qr/protocol'
import type { QrWorkerClient } from '../qr/qrClient'
import { applyProjection } from './arCamera'
import { effectiveQrSize, poseAnchor, searchingSeconds, toVideoPixels } from './arMath'
import { releaseRenderer, watchContextLoss } from './glContext'
import type { LoadedModel } from './loadModel'
import { PoseFusion } from './fusion'
import { applyConstructionLook, type ConstructionLook } from './look'
import { type Paint } from './palette'
import { levelModelMatrix, upInGlCamera } from './level'
import { deviceRotation, deviceStill, lookAroundPose, LOOK_AROUND_MAX_S, nextLock, type MotionLock, type MotionSample } from './motion'
import { createFrameWatchdog } from './watchdog'

/** Edges live on their own layer so the ID-buffer render (layer 0 only) never sees them. */
export const EDGE_LAYER = 1
const DETECT_WIDTH = 640
const ORIGIN = new Vector3()
const LOST_AFTER_S = 0.5
/** Detections this old are stale: the sensors hold the model from here on, well before LOST_AFTER_S (audit B-03). */
const HOLD_AFTER_S = 0.15
const NEAR_M = 0.02
const FAR_M = 100
/**
 * Camera-to-screen delay of a video frame (ms), used when the browser doesn't stamp frames with their capture time:
 * the model is posed with the device rotation of that moment. Tune on a device with ?arlag=<ms>.
 */
export const DEFAULT_FRAME_LAG_MS = 60
// QR-only smoothing (no motion sensors): steadier at rest than the pose module's defaults, at a little more lag.
const QR_ONLY_TRANSLATION: OneEuroParams = { minCutoff: 0.6, beta: 4, dCutoff: 1 }
const QR_ONLY_ROTATION: OneEuroParams = { minCutoff: 0.4, beta: 0.8, dCutoff: 1 }

/** ?arlag=<ms> (0-300) overrides DEFAULT_FRAME_LAG_MS for tuning on a device. */
export function frameLagMs(search: string): number {
  const v = Number(new URLSearchParams(search).get('arlag'))
  return Number.isFinite(v) && v > 0 && v <= 300 ? v : DEFAULT_FRAME_LAG_MS
}

export type OverlayState = {
  tracking: boolean
  quality: Quality | null
  provisional: boolean
  distanceM: number | null
  detectMs: number | null
  /** A different anchor's code is in view (its corners are ignored: its printed size may differ). */
  otherAnchor: { projectId: string; anchorId: string } | null
  /** code: aligned by the QR code · motion: held by the motion sensors (look-around) · lost: hidden */
  mode: 'code' | 'motion' | 'lost'
  /** Seconds without the code since it was last seen or tracking (re)started; 0 while tracking (coach tips after 5 s). */
  searchingS: number
  /** The QR reader can't decode (its .wasm or worker didn't load). */
  qrFailed: boolean
  /** Look-around ran out (LOOK_AROUND_MAX_S without the code): the model is hidden until the code is back in view. */
  lookAroundExpired: boolean
}

/** The latest raw (unsmoothed) pose: the snapshot's flip prior and the pose used for a check. */
export type LastPose = { pose: Pose; K: Intrinsics; quality: Quality; corners: Point2[]; videoW: number; videoH: number; tSec: number }

export type Overlay = {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly model: LoadedModel
  readonly look: ConstructionLook
  start(): void
  stop(): void
  onState(cb: (s: OverlayState) => void): () => void
  lastRaw(): LastPose | null
  intrinsics(): Intrinsics
  setIntrinsics(K: Intrinsics): void
  /** Apply a new print-scale correction (check-bar step); restarts tracking. */
  setQrSizeCorrection(factor: number): void
  /** Every detection of THIS anchor's code: corners in video px (used by calibration). */
  onCorners(cb: (corners: Point2[], videoW: number, videoH: number) => void): () => void
  dispose(): void
}

export type OverlayOptions = {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  model: LoadedModel
  anchor: ApiAnchor
  qr: QrWorkerClient
  /** Print-scale correction for this anchor (check-bar step), 1 when unknown. */
  qrSizeCorrection: number
  origin: string
  /** IFC class of an element, for the construction look's layers (and its colour when paintOf is absent). */
  classOf: (guid: string) => string
  /** Element kind for the colour by type (palette.js), from its elements.json row. */
  paintOf?: (guid: string) => Paint | undefined
  /** Hold the model with the motion sensors when the code leaves the view (permission already granted). */
  motion: boolean
  /** The WebGL context was lost and not restored (glContext.ts); detection has already stopped. */
  onContextDead?: () => void
}

/**
 * Whether this frame poses the model by the motion sensors (audit B-03): in look-around mode, and as soon as the
 * code's detections go stale, so the model doesn't ride along with the device until look-around starts at
 * LOST_AFTER_S and then snap back. Needs the sensors on and a lock within LOOK_AROUND_MAX_S. The emitted state
 * doesn't change: the 0.5 s rule still decides when the model is hidden (no lock) or the mode turns to motion.
 */
export function holdBySensors(mode: OverlayState['mode'], nowS: number, lastSeenS: number, lock: Pick<MotionLock, 'tSec'> | null, motion: boolean): boolean {
  if (!lock || !motion) return false
  if (mode === 'motion') return true
  return mode === 'code' && nowS - lastSeenS > HOLD_AFTER_S && nowS - lock.tSec < LOOK_AROUND_MAX_S
}

/**
 * Look-around ran out (audit C-14): the motion sensors held the model, and the code has been out of view for
 * LOOK_AROUND_MAX_S. The coach then says so instead of giving the search tips. `held`: there was a lock or a fused pose.
 */
export function lookAroundExpired(motion: boolean, held: boolean, nowS: number, lastSeenS: number): boolean {
  return motion && held && nowS - lastSeenS >= LOOK_AROUND_MAX_S
}

export function createOverlay(o: OverlayOptions): Overlay {
  const { video, canvas, model, anchor, qr } = o
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  camera.matrixAutoUpdate = false
  camera.layers.enable(EDGE_LAYER)
  scene.add(model.ifcRoot)
  model.ifcRoot.visible = false

  // Construction look + transparency, section and layers (scene/look.ts); restored on dispose.
  renderer.localClippingEnabled = true
  const look = applyConstructionLook(model, o.classOf, EDGE_LAYER, o.paintOf)

  // Look-around: latest device rotation, the last second of rotations (is the device still?), and the pose + rotation
  // when the code was last seen.
  let deviceR: Mat3 | null = null
  const recent: MotionSample[] = []
  let lock: MotionLock | null = null
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return
    deviceR = deviceRotation(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? 0)
    const tMs = performance.now()
    fusion?.addOrientation(deviceR, tMs)
    recent.push({ tMs, D: deviceR })
    while (recent.length > 2 && recent[1].tMs < tMs - 1000) recent.shift()
  }
  if (o.motion) window.addEventListener('deviceorientation', onOrientation)

  const fusion = o.motion ? new PoseFusion() : null
  const lagMs = frameLagMs(window.location.search)
  const pAnchor = poseAnchor(anchor)
  // Gravity levelling (scene/level.ts): with the motion sensors on, the model's up is the real up, rotated about the code.
  const pivot = anchor.position_m
  const levelledBy = (m: number[], D: Mat3 | null): number[] => (o.motion && D ? levelModelMatrix(m, pivot, upInGlCamera(D)) ?? m : m)
  const levelled = (m: number[]): number[] => levelledBy(m, deviceR)
  /** Posed by the fusion this frame: sensors live, a trusted estimate, and the code seen within LOOK_AROUND_MAX_S. */
  const fused = (nowMs: number): boolean => fusion !== null && fusion.hasEstimate() && fusion.trusted(nowMs)
    && fusion.orientationAt(nowMs) !== null && nowMs / 1000 - lastSeen < LOOK_AROUND_MAX_S
  let s = effectiveQrSize(anchor, o.qrSizeCorrection)
  const cornerListeners = new Set<(corners: Point2[], videoW: number, videoH: number) => void>()
  let K: Intrinsics = loadIntrinsics(video.videoWidth || 1280, video.videoHeight || 720)
  let kSize = `${video.videoWidth}x${video.videoHeight}`
  const newTracker = () => new PoseTracker(s, K, { smoother: new PoseSmoother(QR_ONLY_TRANSLATION, QR_ONLY_ROTATION) })
  let tracker = newTracker()
  const grabCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!grabCtx) throw new Error('2D canvas is not available')

  let running = false
  let disposed = false
  let contextDead = false
  let startedSec = 0
  let rafHandle = 0
  let vfcHandle = 0
  let last: LastPose | null = null
  let lastSeen = -Infinity
  let projKey = ''
  const listeners = new Set<(s: OverlayState) => void>()
  let state: OverlayState = {
    tracking: false, quality: null, provisional: true, distanceM: null, detectMs: null, otherAnchor: null, mode: 'lost', searchingS: 0, qrFailed: false,
    lookAroundExpired: false,
  }
  let lastEmit = 0

  function emit(next: OverlayState): void {
    const now = performance.now()
    const changed = next.tracking !== state.tracking || next.quality !== state.quality || next.provisional !== state.provisional
      || next.mode !== state.mode || next.qrFailed !== state.qrFailed || next.lookAroundExpired !== state.lookAroundExpired
      || (next.otherAnchor?.anchorId ?? null) !== (state.otherAnchor?.anchorId ?? null)
    state = next
    if (changed || now - lastEmit > 250) {
      lastEmit = now
      listeners.forEach((cb) => cb(next))
    }
  }

  function ensureIntrinsics(vw: number, vh: number): void {
    const size = `${vw}x${vh}`
    if (size === kSize) return
    kSize = size // the frame size changed (rotation): reload K for this size and restart tracking
    K = loadIntrinsics(vw, vh)
    tracker = newTracker()
    fusion?.reset()
    projKey = ''
  }

  /** `frameMs`: when the detected frame was captured (performance.now() time), for the fusion. */
  function onDetection(res: QrResponse, fw: number, fh: number, vw: number, vh: number, frameMs: number): void {
    if (!running) return
    if (`${vw}x${vh}` !== kSize) return // grabbed before a rotation: K and the tracker are for the new size now
    const tSec = performance.now() / 1000
    let corners: Point2[] | null = null
    let otherAnchor: OverlayState['otherAnchor'] = null
    if (res.detection) {
      const link = parseAnchorLink(res.detection.text, o.origin)
      if (link && (link.projectId !== anchor.project_id || link.anchorId !== anchor.anchor_id)) otherAnchor = link
      else if (link) corners = toVideoPixels(res.detection.corners, fw, fh, vw, vh)
    }
    if (corners) cornerListeners.forEach((cb) => cb(corners!, vw, vh))
    const tracked = tracker.update(corners, tSec)
    if (tracked) {
      lastSeen = tSec
      last = { pose: { R: tracked.raw.R, t: tracked.raw.t }, K, quality: tracked.quality, corners: corners!, videoW: vw, videoH: vh, tSec }
      fusion?.addDetection(tracked.raw, tracked.quality, tracked.provisional, tracked.raw.distanceM, frameMs)
      if (!fused(tSec * 1000)) { // posed every frame in tick() when fused
        model.ifcRoot.matrix.fromArray(levelled(modelMatrixIfc(pAnchor, tracked.smoothed)))
        model.ifcRoot.matrixWorldNeedsUpdate = true
      }
      model.ifcRoot.visible = true
      if (deviceR && !tracked.provisional) lock = nextLock(lock, tracked.smoothed, deviceR, tSec, deviceStill(recent))
      emit({ tracking: true, quality: tracked.quality, provisional: tracked.provisional, distanceM: tracked.raw.distanceM, detectMs: res.ms, otherAnchor, mode: 'code', searchingS: 0, qrFailed: qr.failed,
        lookAroundExpired: false })
    } else if (tSec - lastSeen > LOST_AFTER_S) {
      const canLookAround = fused(tSec * 1000) || (o.motion && lock !== null && deviceR !== null && tSec - lock.tSec < LOOK_AROUND_MAX_S)
      model.ifcRoot.visible = canLookAround
      emit({ tracking: false, quality: null, provisional: true, distanceM: null, detectMs: res.ms, otherAnchor, mode: canLookAround ? 'motion' : 'lost',
        searchingS: searchingSeconds(tSec, lastSeen, startedSec), qrFailed: qr.failed,
        lookAroundExpired: !canLookAround && lookAroundExpired(o.motion, lock !== null || !!fusion?.hasEstimate(), tSec, lastSeen) })
    }
  }

  // No video frames for 1 s (a call, an app switch, another app took the camera): hide the model and say so,
  // instead of freezing on the last "Good" state with Check enabled.
  const watchdog = createFrameWatchdog(() => {
    model.ifcRoot.visible = false
    emit({ tracking: false, quality: null, provisional: true, distanceM: null, detectMs: null, otherAnchor: null, mode: 'lost',
      searchingS: searchingSeconds(performance.now() / 1000, lastSeen, startedSec), qrFailed: qr.failed, lookAroundExpired: false })
    render()
  })

  function render(): void {
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!cw || !ch || !vw || !vh) return
    const key = `${vw}x${vh}@${cw}x${ch}@${K.f}`
    if (key !== projKey) {
      projKey = key
      renderer.setSize(cw, ch, false)
      applyProjection(camera, projectionMatrixGL({ K, videoW: vw, videoH: vh, viewW: cw, viewH: ch, near: NEAR_M, far: FAR_M, fit: 'cover' }))
    }
    look.update(ORIGIN) // the AR camera sits at the world origin
    renderer.render(scene, camera)
  }

  function tick(now: number = performance.now(), meta?: VideoFrameCallbackMetadata): void {
    if (!running) return
    // When the frame on screen was captured: its own stamp where the browser gives one, else an estimate.
    const frameMs = meta?.captureTime ?? now - lagMs
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw && vh && video.readyState >= 2) {
      watchdog.frame()
      ensureIntrinsics(vw, vh)
      if (!qr.busy) {
        const img = grabFrame(video, grabCtx!, DETECT_WIDTH)
        const fw = img.width
        const fh = img.height
        qr.detect(img).then((res) => onDetection(res, fw, fh, vw, vh, frameMs)).catch(() => undefined)
      }
    }
    const pose = fused(now) && model.ifcRoot.visible ? fusion!.poseAt(frameMs) : null
    if (pose) {
      model.ifcRoot.matrix.fromArray(levelledBy(modelMatrixIfc(pAnchor, pose), fusion!.orientationAt(frameMs)))
      model.ifcRoot.matrixWorldNeedsUpdate = true
    } else if (lock && deviceR && holdBySensors(state.mode, performance.now() / 1000, lastSeen, lock, o.motion)) {
      model.ifcRoot.matrix.fromArray(levelled(modelMatrixIfc(pAnchor, lookAroundPose(lock, deviceR))))
      model.ifcRoot.matrixWorldNeedsUpdate = true
    }
    render()
    schedule()
  }

  function schedule(): void {
    if (!running) return
    if ('requestVideoFrameCallback' in video) vfcHandle = video.requestVideoFrameCallback(tick)
    else rafHandle = requestAnimationFrame(tick)
  }

  const overlay: Overlay = {
    renderer, scene, camera, model, look,
    start() {
      if (running || disposed || contextDead) return
      running = true
      startedSec = performance.now() / 1000
      watchdog.start()
      schedule()
    },
    stop() {
      running = false
      watchdog.stop()
      if (vfcHandle && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(vfcHandle)
      if (rafHandle) cancelAnimationFrame(rafHandle)
    },
    onState(cb) {
      listeners.add(cb)
      cb(state)
      return () => listeners.delete(cb)
    },
    lastRaw: () => last,
    intrinsics: () => K,
    setIntrinsics(next) {
      K = next
      tracker = newTracker()
      fusion?.reset()
      projKey = ''
    },
    setQrSizeCorrection(factor) {
      s = effectiveQrSize(anchor, factor)
      tracker = newTracker()
      fusion?.reset()
    },
    onCorners(cb) {
      cornerListeners.add(cb)
      return () => cornerListeners.delete(cb)
    },
    dispose() {
      this.stop()
      disposed = true
      stopWatch()
      listeners.clear()
      cornerListeners.clear()
      window.removeEventListener('deviceorientation', onOrientation)
      look.dispose()
      scene.remove(model.ifcRoot)
      releaseRenderer(renderer)
    },
  }
  // A lost context that three can't restore leaves a blank canvas: stop detecting and let the page offer a reload.
  const stopWatch = watchContextLoss(canvas, () => {
    contextDead = true // a check's finally{} must not restart detection either
    overlay.stop()
    o.onContextDead?.()
  })
  return overlay
}
