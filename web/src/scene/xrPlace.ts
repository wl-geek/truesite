/**
 * Android: place the model by the QR code inside a WebXR session, then let ARCore world-tracking
 * hold it, like field AR apps do ("scan the marker, move left and right until the circle fills").
 *
 * Each XR frame: the camera image (WebXR camera-access) is drawn into a small render target and read
 * back -> zxing worker -> corners -> estimatePose with intrinsics from the view's projection -> the
 * model's world transform = view.transform x modelMatrixIfc(anchor, pose). Estimates from many
 * angles are fused (largest rotation-consistent cluster, averaged), then the model is locked in the
 * world: walk under it, look up, it stays.
 */
import {
  Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3,
  WebGLRenderTarget, WebGLRenderer,
} from 'three'
import type { Anchor as ApiAnchor } from '../api/types'
import { estimatePose, modelMatrixIfc, type Anchor as PoseAnchor, type Intrinsics, type Pose } from '../pose'
import { parseAnchorLink } from '../qr/link'
import type { QrWorkerClient } from '../qr/qrClient'
import { effectiveQrSize, poseAnchor, toVideoPixels } from './arMath'
import type { LoadedModel } from './loadModel'
import { applyConstructionLook, type ConstructionLook } from './look'
import { levelledPlacement } from './placement'
import { EDGE_LAYER } from './overlay'

/** CV intrinsics (pixels, top-left origin) of a camera image W x H aligned with a view's GL projection. */
export function intrinsicsFromProjection(P: ArrayLike<number>, W: number, H: number): Intrinsics {
  // u = (W P0 / 2) Xc/Zc + W (1 - P8) / 2,  v = (H P5 / 2) Yc/Zc + H (1 + P9) / 2   (square pixels assumed)
  return { f: (W * P[0]) / 2, cx: (W * (1 - P[8])) / 2, cy: (H * (1 + P[9])) / 2 }
}

/** One view's estimate: the code's world position and the world_from_IFC rotation (scale handled at lock). */
export type WorldEstimate = { position: Vector3; quaternion: Quaternion; weight: number; cameraPos: Vector3 }

export const NEEDED_VIEWS = 12
export const NEEDED_SPREAD_DEG = 25
const CLUSTER_DEG = 6

/** Fuse estimates: largest cluster of rotations within CLUSTER_DEG of each other, weighted average. */
export function fuseEstimates(est: readonly WorldEstimate[]): { position: Vector3; quaternion: Quaternion; used: number } | null {
  if (!est.length) return null
  let best: WorldEstimate[] = []
  for (const e of est) {
    const cluster = est.filter((o) => (e.quaternion.angleTo(o.quaternion) * 180) / Math.PI < CLUSTER_DEG)
    if (cluster.length > best.length) best = cluster
  }
  const ref = best[0].quaternion
  const position = new Vector3()
  const q = { x: 0, y: 0, z: 0, w: 0 }
  let wsum = 0
  for (const e of best) {
    const s = ref.dot(e.quaternion) < 0 ? -1 : 1 // keep quaternions in one hemisphere before averaging
    position.addScaledVector(e.position, e.weight)
    q.x += s * e.quaternion.x * e.weight
    q.y += s * e.quaternion.y * e.weight
    q.z += s * e.quaternion.z * e.weight
    q.w += s * e.quaternion.w * e.weight
    wsum += e.weight
  }
  position.divideScalar(wsum)
  return { position, quaternion: new Quaternion(q.x, q.y, q.z, q.w).normalize(), used: best.length }
}

/** Spread (degrees) of the directions from the code to the camera across views. */
export function viewSpreadDeg(codePos: Vector3, cameras: readonly Vector3[]): number {
  const dirs = cameras.map((c) => c.clone().sub(codePos).normalize())
  let max = 0
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) max = Math.max(max, dirs[i].angleTo(dirs[j]))
  return (max * 180) / Math.PI
}

/** One view's estimate from view.transform x modelMatrixIfc(anchor, pose); position = the code's world point. */
export function toWorldEstimate(viewMatrix: Matrix4, anchor: PoseAnchor, pose: Pose, weight: number): WorldEstimate {
  const m = viewMatrix.clone().multiply(new Matrix4().fromArray(modelMatrixIfc(anchor, pose)))
  const quaternion = new Quaternion()
  m.decompose(new Vector3(), quaternion, new Vector3())
  const position = new Vector3(...anchor.position_m).applyMatrix4(m) // the code itself, so the ring measures angles around it (audit A-02)
  return { position, quaternion, weight, cameraPos: new Vector3().setFromMatrixPosition(viewMatrix) }
}

export type Fused = NonNullable<ReturnType<typeof fuseEstimates>>
export type PlacementProgress = { fused: Fused | null; views: number; spreadDeg: number; progress: number }

/** How far the scan is: enough views from a wide enough spread of angles around the code. */
export function placementProgress(estimates: readonly WorldEstimate[]): PlacementProgress {
  const fused = fuseEstimates(estimates)
  const spreadDeg = fused ? viewSpreadDeg(fused.position, estimates.map((e) => e.cameraPos)) : 0
  const progress = Math.min(1, Math.min(estimates.length / NEEDED_VIEWS, spreadDeg / NEEDED_SPREAD_DEG))
  return { fused, views: estimates.length, spreadDeg, progress }
}

export type XrPlaceState = { phase: 'scanning' | 'locked'; views: number; spreadDeg: number; progress: number; codeSeen: boolean }

export type XrPlaceOptions = {
  model: LoadedModel
  anchor: ApiAnchor
  classOf: (guid: string) => string
  qr: QrWorkerClient
  qrSizeCorrection: number
  overlay: HTMLElement
  onState: (s: XrPlaceState) => void
  onEnd: () => void
}

export type XrPlaceSession = { look: ConstructionLook; rescan(): void; end(): void }

export async function xrCameraAccessSupported(): Promise<boolean> {
  return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false))
}

export async function startXrPlace(o: XrPlaceOptions): Promise<XrPlaceSession> {
  const xr = navigator.xr
  if (!xr) throw new Error('WebXR is not available')
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['camera-access'],
    optionalFeatures: ['dom-overlay', 'local-floor'],
    domOverlay: { root: o.overlay },
  })

  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.localClippingEnabled = true
  renderer.xr.enabled = true
  // Floor-relative space when the AR system offers it: then the floor is world Y = 0.
  const floorOk = ((session as XRSession & { enabledFeatures?: string[] }).enabledFeatures ?? []).includes('local-floor')
  renderer.xr.setReferenceSpaceType(floorOk ? 'local-floor' : 'local')
  await renderer.xr.setSession(session)

  const scene = new Scene()
  o.model.ifcRoot.removeFromParent()
  scene.add(o.model.ifcRoot)
  o.model.ifcRoot.visible = false
  const look = applyConstructionLook(o.model, o.classOf, EDGE_LAYER)
  const baseCamera = new PerspectiveCamera()
  baseCamera.layers.enable(EDGE_LAYER)

  // Camera image -> small render target -> pixels for the QR worker.
  const quadScene = new Scene()
  const quadMat = new MeshBasicMaterial()
  quadScene.add(new Mesh(new PlaneGeometry(2, 2), quadMat))
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  let rt: WebGLRenderTarget | null = null

  const pAnchor = poseAnchor(o.anchor)
  const anchorIfc = new Vector3(...o.anchor.position_m)
  const s = effectiveQrSize(o.anchor, o.qrSizeCorrection)
  const estimates: WorldEstimate[] = []
  let prevPose: Pose | null = null
  let phase: XrPlaceState['phase'] = 'scanning'
  let frameNo = 0
  const world = new Matrix4()
  const viewerPos = new Vector3()

  const emit = (codeSeen: boolean) => {
    const p = placementProgress(estimates)
    o.onState({ phase, views: p.views, spreadDeg: p.spreadDeg, progress: p.progress, codeSeen })
    return p
  }

  function lock(): void {
    const fused = fuseEstimates(estimates)
    if (!fused) return
    // Heading from the code, up from gravity, scale from the anchor; life-size models stand on the detected floor.
    const lifeSize = o.anchor.scale >= 0.999
    world.copy(levelledPlacement(fused.quaternion, fused.position, anchorIfc, o.anchor.scale, floorOk && lifeSize ? 0 : null))
    o.model.ifcRoot.matrixAutoUpdate = false
    o.model.ifcRoot.matrix.copy(world)
    o.model.ifcRoot.matrixWorldNeedsUpdate = true
    o.model.ifcRoot.visible = true
    phase = 'locked'
    emit(true)
  }

  function detect(frame: XRFrame): void {
    const ref = renderer.xr.getReferenceSpace()
    const view = ref ? frame.getViewerPose(ref)?.views[0] : undefined
    const cam = (view as (XRView & { camera?: { width: number; height: number } }) | undefined)?.camera
    if (!view || !cam || o.qr.busy) return
    const tex = renderer.xr.getCameraTexture(cam as unknown as Parameters<typeof renderer.xr.getCameraTexture>[0])
    if (!tex) return
    const W = cam.width
    const H = cam.height
    const k = 800 / Math.max(W, H)
    const w = Math.round(W * k)
    const h = Math.round(H * k)
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose()
      rt = new WebGLRenderTarget(w, h)
    }
    quadMat.map = tex
    quadMat.needsUpdate = true
    const xrEnabled = renderer.xr.enabled
    renderer.xr.enabled = false
    renderer.setRenderTarget(rt)
    renderer.render(quadScene, quadCam)
    renderer.setRenderTarget(null)
    renderer.xr.enabled = xrEnabled
    const buf = new Uint8Array(w * h * 4)
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)
    const img = new ImageData(w, h)
    for (let row = 0; row < h; row++) img.data.set(buf.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4) // GL rows are bottom-up
    const K = intrinsicsFromProjection(view.projectionMatrix, W, H)
    const viewM = new Matrix4().fromArray(view.transform.matrix)
    o.qr.detect(img).then((res) => {
      if (phase !== 'scanning') return
      const link = res.detection ? parseAnchorLink(res.detection.text, window.location.origin) : null
      if (!res.detection || !link || link.anchorId !== o.anchor.anchor_id || link.projectId !== o.anchor.project_id) {
        emit(false)
        return
      }
      const corners = toVideoPixels(res.detection.corners, w, h, W, H)
      const est = estimatePose(corners, s, K, prevPose)
      if (!est || (est.ambiguous && !prevPose)) {
        emit(true)
        return
      }
      prevPose = { R: est.R, t: est.t }
      // Closer, sharper views count more.
      estimates.push(toWorldEstimate(viewM, pAnchor, prevPose, est.widthPx / Math.max(est.rmsPx, 0.5)))
      if (estimates.length > 60) estimates.shift()
      const { progress } = emit(true)
      if (progress >= 1) lock()
    }).catch(() => undefined)
  }

  renderer.setAnimationLoop((_t, frame) => {
    if (frame && phase === 'scanning' && frameNo++ % 2 === 0) detect(frame)
    look.update(renderer.xr.getCamera().getWorldPosition(viewerPos))
    renderer.render(scene, baseCamera)
  })

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null)
    look.dispose()
    rt?.dispose()
    quadMat.dispose()
    o.model.ifcRoot.removeFromParent()
    renderer.dispose()
    o.onEnd()
  })

  emit(false)
  return {
    look,
    rescan() {
      estimates.length = 0
      prevPose = null
      phase = 'scanning'
      o.model.ifcRoot.visible = false
      emit(false)
    },
    end: () => void session.end().catch(() => undefined),
  }
}
