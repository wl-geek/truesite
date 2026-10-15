import { describe, expect, it } from 'vitest'
import type { Scene, WebGLRenderer } from 'three'
import type { Anchor, Element } from '../api/types'
import type { LoadedModel } from '../scene/loadModel'
import { evalRunStatus, sampleCheckInput } from './sampleRun'
import type { SampleMeta } from './sampleMeta'

const META: SampleMeta = { sample_id: 'room1-door', project_id: 'room1', anchor_id: 'A1', label: 'Door', video_w: 1920, video_h: 1080,
  K: { f: 1500, cx: 960, cy: 540 }, pose: { R: [1, 0, 0, 0, -1, 0, 0, 0, -1], t: [0, 0, 1.5] }, captured_at: '2026-10-15T10:00:00Z' }
const ANCHOR = { anchor_id: 'A1', project_id: 'room1' } as Anchor
const WALL = { guid: 'g1', ifc_class: 'IfcWall' } as Element

describe('sample checks', () => {
  it('sends the sample id, so the server keeps this run as the sample\'s saved result', () => {
    const photo = new Blob(['jpeg'])
    const loaded = { model: {} as LoadedModel, scene: {} as Scene, renderer: {} as WebGLRenderer, project: { elements: [WALL] } }
    const input = sampleCheckInput(META, photo, { width: 1600, height: 900 }, ANCHOR, loaded)
    expect(input.sampleId).toBe('room1-door')
    expect(input).toMatchObject({ photo, photoW: 1600, photoH: 900, videoW: 1920, videoH: 1080, K: META.K, pose: META.pose,
      anchor: ANCHOR, poseQuality: 'good' })
    expect(input.elements.get('g1')).toBe(WALL)
  })

  it('reports which samples did not run, so the eval table is not published short', () => {
    const samples = [{ sample_id: 's1' }, { sample_id: 's2' }, { sample_id: 's3' }]
    expect(evalRunStatus(samples, { s1: {}, s2: {}, s3: {} }, {})).toBe('Checked all 3 samples. results.json is downloading.')
    expect(evalRunStatus(samples, { s1: {} }, { s2: 'Too many checks.', s3: 'HTTP 404' }))
      .toBe('Checked 1 of 3 samples. Not run: s2 (Too many checks.), s3 (HTTP 404). Run all again later to retry just those; '
        + 'results.json is downloading with the 1 done so far.')
  })
})
