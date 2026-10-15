import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from './loadModel'
import { applyConstructionLook, layerOf, layerOpacity } from './look'

function model() {
  const g = new Group()
  const add = (name: string) => { const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()); m.name = name; g.add(m) }
  ;['C'.repeat(22), 'R'.repeat(22), 'D'.repeat(22)].forEach(add)
  return buildLoadedModel(g, new Set(['C'.repeat(22), 'R'.repeat(22), 'D'.repeat(22)]))
}
const cls: Record<string, string> = { ['C'.repeat(22)]: 'IfcColumn', ['R'.repeat(22)]: 'IfcReinforcingBar', ['D'.repeat(22)]: 'IfcDoor' }

describe('construction look', () => {
  it('sorts classes into layers', () => {
    expect(layerOf('IfcBeam')).toBe('structure')
    expect(layerOf('IfcWall')).toBe('structure')
    expect(layerOf('IfcReinforcingBar')).toBe('rebar')
    expect(layerOf('IfcPipeSegment')).toBe('openings')
    expect(layerOf('IfcFurniture')).toBe('other')
  })

  it('fades with the transparency slider but never fully disappears', () => {
    expect(layerOpacity('rebar', 0)).toBe(1)
    expect(layerOpacity('structure', 0)).toBeCloseTo(0.45)
    expect(layerOpacity('structure', 1)).toBe(0.05)
  })

  it('toggles layers, cuts at a height in IFC metres, and restores the originals', () => {
    const m = model()
    const original = (m.meshes[0].material as MeshBasicMaterial)
    const look = applyConstructionLook(m, (g) => cls[g], 1)
    look.setLayerVisible('rebar', false)
    expect(m.meshes.find((x) => x.name === 'R'.repeat(22))!.visible).toBe(false)
    look.setSection(3.3)
    look.update()
    const mat = m.meshes[0].material as MeshBasicMaterial
    expect(mat.clippingPlanes).toHaveLength(1)
    const plane = mat.clippingPlanes![0]
    // ifcRoot is identity here: points below 3.3 m are kept (positive side), above are cut.
    expect(plane.distanceToPoint(new Vector3(0, 0, 1))).toBeGreaterThan(0)
    expect(plane.distanceToPoint(new Vector3(0, 0, 5))).toBeLessThan(0)
    look.setSection(null)
    expect(mat.clippingPlanes).toHaveLength(0)
    look.dispose()
    expect(m.meshes[0].material).toBe(original)
    expect(m.meshes.every((x) => x.visible)).toBe(true)
  })
})
