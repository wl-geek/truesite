import { readFileSync } from 'node:fs'
import { Box3, Matrix4, Mesh, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { IFC_FROM_GLTF_MAT4, IFC_TO_THREE, parseModel } from './loadModel'

const SITE = new URL('../../../bim/models/site/', import.meta.url)

function site() {
  const buf = readFileSync(new URL('model.glb', SITE))
  const glb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const elements = JSON.parse(readFileSync(new URL('elements.json', SITE), 'utf8')) as Element[]
  return { glb, elements }
}

describe('fixed IFC <-> glTF <-> three.js conversions', () => {
  it('IFC_FROM_GLTF_MAT4 maps glTF (1, 2, 3) to IFC (1, -3, 2)', () => {
    const p = new Vector3(1, 2, 3).applyMatrix4(new Matrix4().fromArray(IFC_FROM_GLTF_MAT4))
    expect(p.toArray()).toEqual([1, -3, 2])
  })

  it('IFC_TO_THREE maps IFC Z-up to three.js Y-up and undoes IFC_FROM_GLTF', () => {
    const p = new Vector3(2, 1, 0.5).applyMatrix4(IFC_TO_THREE)
    expect([p.x, p.y, p.z].map((v) => +v.toFixed(12))).toEqual([2, 0.5, -1])
    const product = IFC_TO_THREE.clone().multiply(new Matrix4().fromArray(IFC_FROM_GLTF_MAT4))
    product.elements.forEach((v, i) => expect(v).toBeCloseTo(new Matrix4().elements[i], 12))
  })
})

describe('parseModel on the committed site glb', () => {
  it('maps every mesh to its element GUID and puts the model in IFC coordinates under ifcRoot', async () => {
    const { glb, elements } = site()
    const model = await parseModel(glb, new Set(elements.map((e) => e.guid)))
    expect(model.ifcRoot.matrixAutoUpdate).toBe(false)
    expect(model.gltfScene.parent).toBe(model.ifcRoot)
    expect(model.gltfScene.matrix.toArray()).toEqual(IFC_FROM_GLTF_MAT4)
    expect(new Set(model.byGuid.keys())).toEqual(new Set(elements.map((e) => e.guid)))
    expect(model.meshes.length).toBeGreaterThanOrEqual(elements.length)
    for (const mesh of model.meshes) {
      expect(mesh).toBeInstanceOf(Mesh)
      expect(model.meshGuid.has(mesh)).toBe(true)
    }
    const close = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3))
    for (const e of elements) {
      // world = IFC: ifcRoot is identity here. Precise: the braces and truss diagonals are rotated, so their loose box is wider.
      const box = new Box3().setFromObject(model.byGuid.get(e.guid)!, true)
      close(box.min.toArray(), e.bbox_m[0])
      close(box.max.toArray(), e.bbox_m[1])
    }
  })

  it('ignores nodes that are not known elements', async () => {
    const { glb, elements } = site()
    const known = new Set([elements[0].guid])
    const model = await parseModel(glb, known)
    expect([...model.byGuid.keys()]).toEqual([elements[0].guid])
    expect(new Set(model.meshGuid.values())).toEqual(known)
  })
})
