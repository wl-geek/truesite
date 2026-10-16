import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubRenderer } from '../test-support/stubRenderer'
import { renderDesignImage, renderIdBuffer } from './idBuffer'
import { buildLoadedModel } from './loadModel'

const BEAM = 'B'.repeat(22)
const REBAR = 'R'.repeat(22)

function model() {
  const g = new Group()
  for (const name of [BEAM, REBAR]) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    m.name = name
    g.add(m)
  }
  return buildLoadedModel(g, new Set([BEAM, REBAR]))
}

function setup() {
  const m = model()
  const scene = new Scene()
  scene.add(m.ifcRoot)
  const camera = new PerspectiveCamera()
  camera.layers.enableAll()
  return { m, scene, camera, ...stubRenderer() }
}

const cut = () => new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 0, -1), new Vector3(0, 0, 3.3))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renderIdBuffer and renderDesignImage judge what is shown', () => {
  it('leave hidden layers out and keep the mesh hidden afterwards', async () => {
    const { m, scene, camera, renderer, drawn } = setup()
    const rebar = m.meshes.find((x) => x.name === REBAR)!
    rebar.visible = false
    await renderIdBuffer(renderer, scene, m, camera, 8, 4)
    expect(drawn.map((d) => d.name)).toEqual([BEAM])
    expect(rebar.visible).toBe(false)
  })

  it('draw the ID buffer with the cut-above plane, then restore the renderer, camera and materials', async () => {
    const { m, scene, camera, renderer, stub, drawn } = setup()
    const originals = m.meshes.map((x) => x.material)
    const maskBefore = camera.layers.mask
    await renderIdBuffer(renderer, scene, m, camera, 8, 4, [cut()])
    const beam = drawn.find((d) => d.name === BEAM)!
    expect(beam.clip).toHaveLength(1)
    expect(beam.clip[0].distanceToPoint(new Vector3(0, 0, 5))).toBeLessThan(0) // above the cut: clipped
    expect(beam.localClipping).toBe(true)
    expect(stub.localClippingEnabled).toBe(false)
    expect(camera.layers.mask).toBe(maskBefore)
    expect(m.meshes.map((x) => x.material)).toEqual(originals)
  })

  it('draw the design render with the same cut', async () => {
    vi.stubGlobal('ImageData', class {
      data: Uint8ClampedArray
      constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4) }
    })
    const { m, scene, camera, renderer, drawn } = setup()
    await renderDesignImage(renderer, scene, m, camera, 8, 4, () => 0x16b9d4, [cut()])
    expect(drawn.every((d) => d.clip.length === 1 && d.localClipping)).toBe(true)
  })

  it('draw with no clip planes when there is no cut', async () => {
    const { m, scene, camera, renderer, drawn } = setup()
    await renderIdBuffer(renderer, scene, m, camera, 8, 4)
    expect(drawn.every((d) => d.clip.length === 0)).toBe(true)
  })
})
