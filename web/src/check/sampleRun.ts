// Running the as-built check on a sample photo (contract section 8), for one tap or for the dev eval run.
import type { Scene, WebGLRenderer } from 'three'
import type { Anchor, Element } from '../api/types'
import type { LoadedModel } from '../scene/loadModel'
import type { CheckInput } from './runCheck'
import type { SampleMeta } from './sampleMeta'

type SampleScene = { model: LoadedModel; scene: Scene; renderer: WebGLRenderer; project: { elements: readonly Element[] } }

/**
 * runCheck input for a sample photo: the stored camera and pose, and the sample id, so the server keeps a good
 * run as the sample's saved result (the fallback when Gemini or the cap is unavailable).
 */
export function sampleCheckInput(meta: SampleMeta, photo: Blob, size: { width: number; height: number }, anchor: Anchor,
  loaded: SampleScene): CheckInput {
  return {
    photo, photoW: size.width, photoH: size.height, videoW: meta.video_w, videoH: meta.video_h, K: meta.K, pose: meta.pose,
    anchor, poseQuality: 'good', model: loaded.model, scene: loaded.scene, renderer: loaded.renderer,
    elements: new Map(loaded.project.elements.map((e) => [e.guid, e])), sampleId: meta.sample_id,
  }
}

/** One line after "Run all samples": what made it into results.json, and which samples did not run and why. */
export function evalRunStatus(samples: readonly { sample_id: string }[], results: Readonly<Record<string, unknown>>,
  failed: Readonly<Record<string, string>>): string {
  const done = samples.filter((s) => s.sample_id in results).length
  const notRun = samples.filter((s) => s.sample_id in failed).map((s) => `${s.sample_id} (${failed[s.sample_id]})`)
  if (!notRun.length) return `Checked all ${done} samples. results.json is downloading.`
  return `Checked ${done} of ${samples.length} samples. Not run: ${notRun.join(', ')}. `
    + `Run all again later to retry just those; results.json is downloading with the ${done} done so far.`
}
