/**
 * The as-built check in the browser (spec 4.2 step 4, 7.3):
 * pose -> ID buffer (~640 px) -> numbered marks -> design render at the photo size with marks
 * -> POST /api/check. For sample photos, a failed check falls back to the sample's saved result.
 */
import { PerspectiveCamera, type Scene, type WebGLRenderer } from 'three'
import { ApiError, getSavedResult, postCheck } from '../api/client'
import type { Anchor, CheckContext, CheckResponse, CheckResult, Element, MarkedElement, PoseQuality } from '../api/types'
import { modelMatrixIfc, projectionMatrixGL, type Intrinsics, type Pose } from '../pose'
import { applyProjection } from '../scene/arCamera'
import { poseAnchor } from '../scene/arMath'
import { visibleFromIdBuffer } from '../scene/elements'
import { renderDesignImage, renderIdBuffer } from '../scene/idBuffer'
import type { LoadedModel } from '../scene/loadModel'
import { drawMarks, markCentres, selectMarks } from './marks'
import { canvasToPng } from './snapshot'

export const ID_BUFFER_WIDTH = 640
/** Network failure (0), rate limit or cap (429), model failure (502/503): sample photos show their saved result. */
export const FALLBACK_STATUSES = [0, 429, 502, 503]

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
}

export type CheckOutcome = {
  response: CheckResponse | null
  saved: CheckResult | null
  error: ApiError | null
  marks: MarkedElement[]
  render: Blob | null
}

export function shouldUseSaved(err: ApiError, sampleId?: string): boolean {
  return !!sampleId && FALLBACK_STATUSES.includes(err.status)
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

export async function runCheck(input: CheckInput): Promise<CheckOutcome> {
  const { model, renderer, scene, K, videoW, videoH, photoW, photoH } = input
  const prevMatrix = model.ifcRoot.matrix.clone()
  const prevVisible = model.ifcRoot.visible
  let marks: MarkedElement[] = []
  let render: Blob
  try {
    model.ifcRoot.matrix.fromArray(modelMatrixIfc(poseAnchor(input.anchor), input.pose))
    model.ifcRoot.visible = true
    model.ifcRoot.updateMatrixWorld(true)
    const { w: iw, h: ih } = idBufferSize(videoW, videoH)
    const ids = await renderIdBuffer(renderer, scene, model, cameraFor(K, videoW, videoH, iw, ih), iw, ih)
    const visible = visibleFromIdBuffer(ids.buf, iw, ih)
    marks = selectMarks(visible, ids.indexToGuid, input.elements)
    if (!marks.length) {
      return { response: null, saved: null, error: new ApiError('nothing_visible', 0, 'nothing_visible'), marks, render: null }
    }
    const design = await renderDesignImage(renderer, scene, model, cameraFor(K, videoW, videoH, photoW, photoH), photoW, photoH,
      (guid) => input.elements.get(guid)?.ifc_class ?? '')
    const canvas = document.createElement('canvas')
    canvas.width = photoW
    canvas.height = photoH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is not available')
    ctx.putImageData(design, 0, 0)
    drawMarks(ctx, markCentres(marks, visible, ids.indexToGuid, iw, ih), photoW, photoH)
    render = await canvasToPng(canvas)
  } finally {
    model.ifcRoot.matrix.copy(prevMatrix)
    model.ifcRoot.visible = prevVisible
    model.ifcRoot.matrixWorldNeedsUpdate = true
  }

  const context: CheckContext = {
    project_id: input.anchor.project_id, anchor_id: input.anchor.anchor_id, pose_quality: input.poseQuality,
    distance_m: poseDistance(input.pose), visible: marks, sample_id: input.sampleId ?? null,
  }
  try {
    return { response: await postCheck(input.photo, render, context), saved: null, error: null, marks, render }
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), 0)
    if (shouldUseSaved(err, input.sampleId)) {
      try {
        return { response: null, saved: await getSavedResult(input.sampleId!), error: err, marks, render }
      } catch {
        /* no saved result yet: report the original error */
      }
    }
    return { response: null, saved: null, error: err, marks, render }
  }
}
