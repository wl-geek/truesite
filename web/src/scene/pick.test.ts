import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from './loadModel'
import { pickElement, pickPin } from './pick'

const VIEW = { viewW: 1000, viewH: 1000 }
/** NDC per CSS px on the 1000 px test view. */
const px = (n: number) => (2 * n) / 1000

/**
 * Boxes `[guid, x, width, height]` (glTF: width along x, height along y, which the model loader turns into IFC x and z),
 * seen from 10 m out on IFC -y with z up: screen right is IFC x, screen up is IFC z (the height).
 */
function scene(boxes: [string, number, number, number][]) {
  const g = new Group()
  for (const [name, x, w, h] of boxes) {
    const m = new Mesh(new BoxGeometry(w, h, 0.3), new MeshBasicMaterial())
    m.name = name
    m.position.set(x, 0, 0)
    g.add(m)
  }
  const model = buildLoadedModel(g, new Set(boxes.map((b) => b[0])))
  model.ifcRoot.updateMatrixWorld(true)
  return { model, camera: camera() }
}
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 1, 0.1, 100)
  c.up.set(0, 0, 1)
  c.position.set(0, -10, 0)
  c.lookAt(0, 0, 0)
  c.updateMatrixWorld(true)
  return c
}
const A = 'A'.repeat(22)
const B = 'B'.repeat(22)

describe('pickElement', () => {
  it('returns the element drawn under the tap, or null on empty view', () => {
    const { model, camera } = scene([[A, 0, 1, 1]])
    expect(pickElement(model, camera, { x: 0, y: 0 }, VIEW)).toBe(A)
    expect(pickElement(model, camera, { x: 0.8, y: 0.8 }, VIEW)).toBeNull()
  })

  it('takes a tap just beside a thin member as meant for it (a reasonably sized touch target)', () => {
    const { model, camera } = scene([[A, 0, 0.05, 2]]) // a 5 cm bar, about 5 px wide on screen
    const beside = { x: px(10), y: 0 }
    expect(pickElement(model, camera, beside, { ...VIEW, tolerancePx: 0 })).toBeNull()
    expect(pickElement(model, camera, beside, VIEW)).toBe(A)
  })

  it('prefers what is right under the finger to a nearer element beside it', () => {
    const { model, camera } = scene([[A, 0, 0.3, 1], [B, 0.4, 0.3, 1]])
    expect(pickElement(model, camera, { x: 0, y: 0 }, VIEW)).toBe(A)
  })

  it('ignores what is not drawn: hidden layers, a hidden model, and parts above the cut', () => {
    const { model, camera } = scene([[A, 0, 1, 4]]) // the box spans -2..2 m in height
    const top = { x: 0, y: 1.5 / (10 * Math.tan((25 * Math.PI) / 180)) } // 1.5 m up the box
    const cut = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 0, -1), new Vector3(0, 0, 1)) // keep below 1 m
    expect(pickElement(model, camera, top, VIEW)).toBe(A)
    expect(pickElement(model, camera, top, { ...VIEW, clip: [cut] })).toBeNull()
    expect(pickElement(model, camera, { x: 0, y: 0 }, { ...VIEW, clip: [cut] })).toBe(A)
    model.meshes[0].visible = false
    expect(pickElement(model, camera, { x: 0, y: 0 }, VIEW)).toBeNull()
    model.meshes[0].visible = true
    model.ifcRoot.visible = false // tracking lost: the model is hidden
    expect(pickElement(model, camera, { x: 0, y: 0 }, VIEW)).toBeNull()
  })
})

describe('pickPin', () => {
  it("returns the tapped pin's mark, with the same tolerance", () => {
    const pins = new Group()
    const pin = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial())
    pin.userData.mark = 7
    pin.position.set(1, 0, 0)
    pins.add(pin)
    pins.updateMatrixWorld(true)
    const cam = camera()
    const at = 1 / (10 * Math.tan((25 * Math.PI) / 180))
    expect(pickPin(pins, cam, { x: at, y: 0 }, VIEW)).toBe(7)
    expect(pickPin(pins, cam, { x: at + px(15), y: 0 }, VIEW)).toBe(7)
    expect(pickPin(pins, cam, { x: 0, y: 0 }, VIEW)).toBeNull()
    expect(pickPin(null, cam, { x: at, y: 0 }, VIEW)).toBeNull()
  })
})
