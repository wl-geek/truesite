import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from '../scene/loadModel'
import { overlayHighlighter } from './overlayPick'

/** Two 1 m boxes, A at x = -2 and B at x = +2 (the same in IFC and glTF), seen from 10 m away. */
function scene() {
  const g = new Group()
  const names = ['A'.repeat(22), 'B'.repeat(22)]
  names.forEach((name, i) => {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())
    m.name = name
    m.position.set(i ? 2 : -2, 0, 0)
    g.add(m)
  })
  const model = buildLoadedModel(g, new Set(names))
  model.ifcRoot.updateMatrixWorld(true) // the renderer does this each frame
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return { model, camera, names }
}

describe('overlayHighlighter', () => {
  it('paints the picked element orange, drawn over the rest, and gives everything back', () => {
    const { model, names } = scene()
    const [a, b] = model.meshes
    const [matA, matB] = [a.material, b.material]
    const h = overlayHighlighter(model)
    h.set(names[0])
    expect(a.material).not.toBe(matA)
    expect((a.material as MeshStandardMaterial).color.getHex()).toBe(0xff6a13)
    expect(a.renderOrder).toBeGreaterThan(0)
    expect(b.material).toBe(matB)
    h.set(names[1])
    expect(a.material).toBe(matA)
    expect(a.renderOrder).toBe(0)
    expect(b.material).not.toBe(matB)
    h.dispose()
    expect(b.material).toBe(matB)
  })
})
