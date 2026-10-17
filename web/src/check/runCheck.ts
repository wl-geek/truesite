/**
 * The as-built check in the browser (spec 4.2 step 4, 7.3):
 * pose -> ID buffer (~640 px) -> numbered marks -> design render at the photo size with marks, and the photo with each
 * marked element's outline (check/outlines.ts) -> POST /api/check. For sample photos, a failed check falls back to the sample's saved result.
 */
import { PerspectiveCamera, Vector3, type Plane, type Scene, type WebGLRenderer } from 'three'
import { ApiError, getSavedResult, postCheck } from '../api/client'
import type { Anchor, CheckContext, CheckResponse, CheckResult, Element, MarkedElement, PoseQuality } from '../api/types'
import { modelMatrixIfc, projectionMatrixGL, type Intrinsics, type Pose } from '../pose'
import { applyProjection } from '../scene/arCamera'
import { poseAnchor } from '../scene/arMath'
import { visibleFromIdBuffer } from '../scene/elements'
import { designColourOfClass, renderDesignImage, renderIdBuffer } from '../scene/idBuffer'
import { KIND_COLOURS, paintOf } from '../scene/palette'
import type { LoadedModel } from '../scene/loadModel'
import { viewNote, type ConstructionLook } from '../scene/look'
import { drawMarks, markCentres, selectMarks } from './marks'
import { paintMask, ringMask, ringSize } from './outlines'
import { canvasToJpeg, canvasToPng } from './snapshot'

export const ID_BUFFER_WIDTH = 640

export type CheckInput = {
  photo: Blob
  photoW: number
  photoH: number
  videoW: number
  videoH: number
  K: Intrinsics
  pose: Pose
  anchor: Anchor
  poseQuality: PoseQuality
  model: LoadedModel
  scene: Scene
  renderer: WebGLRenderer
  elements: ReadonlyMap<string, Element>
  sampleId?: string
  /**
   * The view controls in use (live AR). The check judges what is shown: hidden layers stay out, and the cut
   * and view distance are applied at the snapshot pose. Without it (sample photos) the whole model is used.
   */
  look?: ConstructionLook
}

export type CheckOutcome = {
  response: CheckResponse | null
  saved: CheckResult | null
  error: ApiError | null
  marks: MarkedElement[]
  render: Blob | null
  /** "Checked as shown: ..." when part of the model was hidden or cut (look.viewNote), else null. */
  viewNote: string | null
}

/**
 * Sample photos show their saved result when the live check couldn't run: no connection or timeout (0),
 * rate limit or cap (429), or a server or model failure (5xx, including a revoked key or retired model).
 */
export function shouldUseSaved(err: ApiError, sampleId?: string): boolean {
  return !!sampleId && (err.status === 0 || err.status === 429 || err.status >= 500)
}

/** The run id to attach issues to: only a run the server stored (saved: false means POST /api/issues would 404 unknown_run). */
export function storedRunId(response: Pick<CheckResponse, 'run_id' | 'saved'> | null): string | null {
  return response?.saved ? response.run_id : null
}

export function idBufferSize(videoW: number, videoH: number, width = ID_BUFFER_WIDTH): { w: number; h: number } {
  return { w: width, h: Math.max(1, Math.round((videoH / videoW) * width)) }
}

/** Camera-to-code distance in metres, clamped to the API's 0..50 range. */
export function poseDistance(pose: Pose): number {
  return Math.min(50, Math.round(Math.hypot(...pose.t) * 100) / 100)
}

function cameraFor(K: Intrinsics, videoW: number, videoH: number, w: number, h: number): PerspectiveCamera {
  const cam = new PerspectiveCamera()
  cam.matrixAutoUpdate = false
  applyProjection(cam, projectionMatrixGL({ K, videoW, videoH, viewW: w, viewH: h, near: 0.02, far: 100, fit: 'cover' }))
  return cam
}

/** The AR camera sits at the world origin (as in overlay.ts): the look's view distance is measured from there. */
const CAMERA_AT = new Vector3()

export async function runCheck(input: CheckInput): Promise<CheckOutcome> {
  const { model, renderer, scene, K, videoW, videoH, photoW, photoH, look } = input
  const note = look ? viewNote(look.state()) : null
  const prevMatrix = model.ifcRoot.matrix.clone()
  const prevVisible = model.ifcRoot.visible
  // Finding pins from an earlier check live under ifcRoot: keep them out of both renders.
  const pins = model.ifcRoot.getObjectByName('finding-pins')
  const pinsVisible = pins?.visible ?? false
  if (pins) pins.visible = false
  let marks: MarkedElement[] = []
  let render: Blob
  let overlay: Blob | null = null
  try {
    model.ifcRoot.matrix.fromArray(modelMatrixIfc(poseAnchor(input.anchor), input.pose))
    model.ifcRoot.visible = true
    model.ifcRoot.updateMatrixWorld(true)
    look?.update(CAMERA_AT) // the cut plane and view distance at the snapshot pose
    const clip = look?.clipPlanes() ?? []
    const { w: iw, h: ih } = idBufferSize(videoW, videoH)
    const ids = await renderIdBuffer(renderer, scene, model, cameraFor(K, videoW, videoH, iw, ih), iw, ih, clip)
    const visible = visibleFromIdBuffer(ids.buf, iw, ih)
    marks = selectMarks(visible, ids.indexToGuid, input.elements)
    if (!marks.length) {
      return { response: null, saved: null, error: new ApiError('nothing_visible', 0, 'nothing_visible'), marks, render: null, viewNote: note }
    }
    const photoCamera = cameraFor(K, videoW, videoH, photoW, photoH)
    const design = await renderDesignImage(renderer, scene, model, photoCamera, photoW, photoH,
      (guid) => designColour(input.elements.get(guid)), clip)
    const canvas = document.createElement('canvas')
    canvas.width = photoW
    canvas.height = photoH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is not available')
    ctx.putImageData(design, 0, 0)
    const centres = markCentres(marks, visible, ids.indexToGuid, iw, ih)
    drawMarks(ctx, centres, photoW, photoH)
    render = await canvasToPng(canvas)
    try {
      overlay = await outlineImage(renderer, scene, model, photoCamera, input.photo, photoW, photoH, marks, centres, clip)
    } catch {
      overlay = null // the check still runs on IMAGE 1 and 2
    }
  } finally {
    model.ifcRoot.matrix.copy(prevMatrix)
    model.ifcRoot.visible = prevVisible
    model.ifcRoot.matrixWorldNeedsUpdate = true
    if (pins) pins.visible = pinsVisible
    look?.update(CAMERA_AT) // back to the live pose
  }

  const context: CheckContext = {
    project_id: input.anchor.project_id, anchor_id: input.anchor.anchor_id, pose_quality: input.poseQuality,
    distance_m: poseDistance(input.pose), visible: marks, sample_id: input.sampleId ?? null,
  }
  try {
    return { response: await postCheck(input.photo, render, context, overlay), saved: null, error: null, marks, render, viewNote: note }
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), 0)
    if (shouldUseSaved(err, input.sampleId)) {
      try {
        return { response: null, saved: await getSavedResult(input.sampleId!), error: err, marks, render, viewNote: note }
      } catch {
        /* no saved result yet: report the original error */
      }
    }
    return { response: null, saved: null, error: err, marks, render, viewNote: note }
  }
}

/**
 * IMAGE 3: the photo with a magenta ring just outside each marked element's design position and smaller mark numbers,
 * from an ID buffer at the photo size (the same camera as the design render, so the rings sit where IMAGE 2 has them).
 */
async function outlineImage(renderer: WebGLRenderer, scene: Scene, model: LoadedModel, camera: PerspectiveCamera, photo: Blob,
  w: number, h: number, marks: readonly MarkedElement[], centres: ReadonlyMap<number, [number, number]>,
  clip: readonly Plane[]): Promise<Blob> {
  const ids = await renderIdBuffer(renderer, scene, model, camera, w, h, clip)
  const indexOf = new Map(ids.indexToGuid.map((g, i) => [g, i]))
  const ringed = new Set(marks.map((m) => indexOf.get(m.guid)).filter((i): i is number => i !== undefined))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available')
  const bitmap = await createImageBitmap(photo)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const img = ctx.getImageData(0, 0, w, h)
  const { gap, line } = ringSize(w)
  paintMask(img, ringMask(ids.buf, w, h, ringed, gap, line))
  ctx.putImageData(img, 0, 0)
  drawMarks(ctx, centres, w, h, 0.7)
  return canvasToJpeg(canvas)
}

/** An element's colour in the design render: its palette type colour (the 3D viewer's key), else by IFC class. */
function designColour(el: Element | undefined): number {
  if (!el) return designColourOfClass('')
  const { kind } = paintOf(el)
  return kind === 'other' || kind === 'opening' ? designColourOfClass(el.ifc_class) : KIND_COLOURS[kind]
}
