import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import type { Anchor } from '../api/types'
import { modelMatrixIfc, type Pose } from '../pose'
import { poseAnchor } from '../scene/arMath'
import { buildLoadedModel } from '../scene/loadModel'
import { applyConstructionLook } from '../scene/look'
import { stubRenderer } from '../test-support/stubRenderer'
import { idBufferSize, poseDistance, runCheck, shouldUseSaved } from './runCheck'
import { photoSize } from './snapshot'

describe('runCheck helpers', () => {
  it('falls back to the saved result only for samples and only on transient failures', () => {
    for (const status of [0, 429, 502, 503]) expect(shouldUseSaved(new ApiError('x', status), 'room1-door')).toBe(true)
    expect(shouldUseSaved(new ApiError('x', 503))).toBe(false)
    for (const status of [400, 404, 413, 422, 500]) expect(shouldUseSaved(new ApiError('x', status), 'room1-door')).toBe(false)
  })

  it('sizes the ID buffer at 640 px wide with the video aspect', () => {
    expect(idBufferSize(1920, 1080)).toEqual({ w: 640, h: 360 })
    expect(idBufferSize(1080, 1920)).toEqual({ w: 640, h: 1138 })
  })

  it('keeps the photo long side at 1600 px or less, same aspect', () => {
    expect(photoSize(1920, 1080)).toEqual({ w: 1600, h: 900 })
    expect(photoSize(1280, 720)).toEqual({ w: 1280, h: 720 })
    expect(photoSize(1080, 1920)).toEqual({ w: 900, h: 1600 })
  })

  it('reports the camera-to-code distance, clamped for the API', () => {
    expect(poseDistance({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0.3, 0.4, 1.2] })).toBe(1.3)
    expect(poseDistance({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 80] })).toBe(50)
  })
})

describe('runCheck judges what is shown', () => {
  const COL = 'C'.repeat(22)
  const BAR = 'R'.repeat(22)
  const cls: Record<string, string> = { [COL]: 'IfcColumn', [BAR]: 'IfcReinforcingBar' }
  const A1: Anchor = { anchor_id: 'A1', project_id: 'room1', qr_size_m: 0.23, position_m: [0.1, 1.5, 1.35], normal: [1, 0, 0], up: [0, 0, 1], scale: 1, label: 'Wall' }
  const pose: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 1.5] }

  function setup() {
    const g = new Group()
    for (const name of [COL, BAR]) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      mesh.name = name
      g.add(mesh)
    }
    const model = buildLoadedModel(g, new Set([COL, BAR]))
    const scene = new Scene()
    scene.add(model.ifcRoot)
    const look = applyConstructionLook(model, (guid) => cls[guid], 1)
    return { model, scene, look, ...stubRenderer() }
  }

  const input = (s: ReturnType<typeof setup>) => ({
    photo: new Blob(), photoW: 160, photoH: 90, videoW: 1920, videoH: 1080, K: { f: 1500, cx: 960, cy: 540 }, pose,
    anchor: A1, poseQuality: 'good' as const, model: s.model, scene: s.scene, renderer: s.renderer, elements: new Map(),
  })

  it('applies the cut at the snapshot pose, leaves hidden layers out and notes the view', async () => {
    const s = setup()
    s.look.setSection(1)
    s.look.setLayerVisible('rebar', false)
    s.look.update() // the live pose (identity here), not the snapshot pose
    const res = await runCheck({ ...input(s), look: s.look })
    expect(res.error?.code).toBe('nothing_visible') // the stub reads back an empty buffer
    expect(res.viewNote).toBe('Checked as shown: Rebar hidden; cut above 1.0 m.')
    expect(s.drawn.map((d) => d.name)).toEqual([COL])
    const atSnapshot = new Matrix4().fromArray(modelMatrixIfc(poseAnchor(A1), pose))
    const plane = s.drawn[0].clip[0]
    expect(plane).toBeDefined()
    expect(plane.distanceToPoint(new Vector3(0, 0, 1).applyMatrix4(atSnapshot))).toBeCloseTo(0, 6)
    expect(plane.distanceToPoint(new Vector3(0, 0, 0.5).applyMatrix4(atSnapshot))).toBeGreaterThan(0) // kept
    expect(plane.distanceToPoint(new Vector3(0, 0, 1.5).applyMatrix4(atSnapshot))).toBeLessThan(0) // cut
  })

  it('applies the view distance from the camera at the snapshot pose, then puts the live view back', async () => {
    const s = setup()
    const atSnapshot = new Matrix4().fromArray(modelMatrixIfc(poseAnchor(A1), pose))
    const far = new Vector3().applyMatrix4(atSnapshot).length() // both boxes sit at the IFC origin
    expect(far).toBeGreaterThan(1.5)
    s.look.setSection(1)
    s.look.setRadius(1)
    s.look.update(new Vector3()) // live: ifcRoot is identity, so both boxes are at the viewer and shown
    expect(s.model.meshes.every((m) => m.visible)).toBe(true)
    const res = await runCheck({ ...input(s), look: s.look })
    expect(s.drawn).toEqual([]) // too far from the camera at the snapshot pose
    expect(res.viewNote).toBe('Checked as shown: cut above 1.0 m; view distance 1 m.')
    expect(s.model.meshes.every((m) => m.visible)).toBe(true)
    expect(s.look.clipPlanes()[0].distanceToPoint(new Vector3(0, 0, 1))).toBeCloseTo(0, 6) // the cut is back at the live pose
  })

  it('has no view note and no cut when nothing is hidden or cut', async () => {
    const s = setup()
    const res = await runCheck({ ...input(s), look: s.look })
    expect(res.viewNote).toBeNull()
    expect(s.drawn.map((d) => d.name).sort()).toEqual([COL, BAR].sort())
    expect(s.drawn.every((d) => d.clip.length === 0)).toBe(true)
  })
})
