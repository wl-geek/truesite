/**
 * Live AR overlay: the camera <video> under a transparent WebGL canvas.
 *
 * Every video frame: grab a ~640 px frame -> zxing worker (skipped while busy: latest frame wins)
 * -> corners back to video pixels -> PoseTracker (IPPE + previous-pose prior + One Euro smoothing)
 * -> ifcRoot.matrix = modelMatrixIfc(anchor, pose). The AR camera sits at the origin with an
 * identity world matrix; only its projection changes (projectionMatrixGL, object-fit: cover).
 */
import {
  DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene,
  WebGLRenderer, type Material,
} from 'three'
import type { Anchor as ApiAnchor } from '../api/types'
import { grabFrame } from '../camera/camera'
import { loadIntrinsics } from '../camera/intrinsics'
import { modelMatrixIfc, PoseTracker, projectionMatrixGL, type Intrinsics, type Point2, type Pose, type Quality } from '../pose'
import { parseAnchorLink } from '../qr/link'
import type { QrResponse } from '../qr/protocol'
import type { QrWorkerClient } from '../qr/qrClient'
import { applyProjection } from './arCamera'
import { effectiveQrSize, poseAnchor, toVideoPixels } from './arMath'
import type { LoadedModel } from './loadModel'

/** Edges live on their own layer so the ID-buffer render (layer 0 only) never sees them. */
export const EDGE_LAYER = 1
const DETECT_WIDTH = 640
const LOST_AFTER_S = 0.5
const NEAR_M = 0.02
const FAR_M = 100

export type OverlayState = {
  tracking: boolean
  quality: Quality | null
  provisional: boolean
  distanceM: number | null
  detectMs: number | null
  /** A different anchor's code is in view (its corners are ignored: its printed size may differ). */
  otherAnchor: { projectId: string; anchorId: string } | null
}

/** The latest raw (unsmoothed) pose: the snapshot's flip prior and the pose used for a check. */
export type LastPose = { pose: Pose; K: Intrinsics; quality: Quality; corners: Point2[]; videoW: number; videoH: number; tSec: number }

export type Overlay = {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly model: LoadedModel
  start(): void
  stop(): void
  onState(cb: (s: OverlayState) => void): () => void
  lastRaw(): LastPose | null
  intrinsics(): Intrinsics
  setIntrinsics(K: Intrinsics): void
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

  // Semi-transparent faces + orange edges; original materials are restored on dispose.
  const face = new MeshBasicMaterial({ color: 0x4e7fb3, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide })
  const edgeMat = new LineBasicMaterial({ color: 0xff6a13 })
  const originals = new Map<Mesh, Material | Material[]>()
  const edges: LineSegments[] = []
  for (const mesh of model.meshes) {
    originals.set(mesh, mesh.material)
    mesh.material = face
    const line = new LineSegments(new EdgesGeometry(mesh.geometry, 25), edgeMat)
    line.layers.set(EDGE_LAYER)
    mesh.add(line)
    edges.push(line)
  }

  const pAnchor = poseAnchor(anchor)
  const s = effectiveQrSize(anchor, o.qrSizeCorrection)
  let K: Intrinsics = loadIntrinsics(video.videoWidth || 1280, video.videoHeight || 720)
  let kSize = `${video.videoWidth}x${video.videoHeight}`
  let tracker = new PoseTracker(s, K)
  const grabCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!grabCtx) throw new Error('2D canvas is not available')

  let running = false
  let rafHandle = 0
  let vfcHandle = 0
  let last: LastPose | null = null
  let lastSeen = -Infinity
  let projKey = ''
  const listeners = new Set<(s: OverlayState) => void>()
  let state: OverlayState = { tracking: false, quality: null, provisional: true, distanceM: null, detectMs: null, otherAnchor: null }
  let lastEmit = 0

  function emit(next: OverlayState): void {
    const now = performance.now()
    const changed = next.tracking !== state.tracking || next.quality !== state.quality || next.provisional !== state.provisional
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
    tracker = new PoseTracker(s, K)
    projKey = ''
  }

  function onDetection(res: QrResponse, fw: number, fh: number, vw: number, vh: number): void {
    if (!running) return
    const tSec = performance.now() / 1000
    let corners: Point2[] | null = null
    let otherAnchor: OverlayState['otherAnchor'] = null
    if (res.detection) {
      const link = parseAnchorLink(res.detection.text, o.origin)
      if (link && (link.projectId !== anchor.project_id || link.anchorId !== anchor.anchor_id)) otherAnchor = link
      else if (link) corners = toVideoPixels(res.detection.corners, fw, fh, vw, vh)
    }
    const tracked = tracker.update(corners, tSec)
    if (tracked) {
      lastSeen = tSec
      last = { pose: { R: tracked.raw.R, t: tracked.raw.t }, K, quality: tracked.quality, corners: corners!, videoW: vw, videoH: vh, tSec }
      model.ifcRoot.matrix.fromArray(modelMatrixIfc(pAnchor, tracked.smoothed))
      model.ifcRoot.matrixWorldNeedsUpdate = true
      model.ifcRoot.visible = true
      emit({ tracking: true, quality: tracked.quality, provisional: tracked.provisional, distanceM: tracked.raw.distanceM, detectMs: res.ms, otherAnchor })
    } else if (tSec - lastSeen > LOST_AFTER_S) {
      model.ifcRoot.visible = false
      emit({ tracking: false, quality: null, provisional: true, distanceM: null, detectMs: res.ms, otherAnchor })
    }
  }

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
    renderer.render(scene, camera)
  }

  function tick(): void {
    if (!running) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (vw && vh && video.readyState >= 2) {
      ensureIntrinsics(vw, vh)
      if (!qr.busy) {
        const img = grabFrame(video, grabCtx!, DETECT_WIDTH)
        const fw = img.width
        const fh = img.height
        qr.detect(img).then((res) => onDetection(res, fw, fh, vw, vh)).catch(() => undefined)
      }
    }
    render()
    schedule()
  }

  function schedule(): void {
    if (!running) return
    if ('requestVideoFrameCallback' in video) vfcHandle = video.requestVideoFrameCallback(tick)
    else rafHandle = requestAnimationFrame(tick)
  }

  return {
    renderer, scene, camera, model,
    start() {
      if (running) return
      running = true
      schedule()
    },
    stop() {
      running = false
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
      tracker = new PoseTracker(s, K)
      projKey = ''
    },
    dispose() {
      this.stop()
      listeners.clear()
      for (const line of edges) {
        line.removeFromParent()
        line.geometry.dispose()
      }
      for (const [mesh, mat] of originals) mesh.material = mat
      face.dispose()
      edgeMat.dispose()
      scene.remove(model.ifcRoot)
      renderer.dispose()
    },
  }
}
