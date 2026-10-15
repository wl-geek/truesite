import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from './loadModel'
import { applyConstructionLook, layerOf, layerOpacity, viewNote } from './look'
import { KIND_COLOURS, type Paint } from './palette'

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
    look.setLayerVisible('rebar', true)
    // radius: only elements within 2 m of the viewer stay visible (boxes at their default positions: the origin)
    look.setRadius(2)
    look.update(new Vector3(0, 0, 10))
    expect(m.meshes.every((x) => !x.visible)).toBe(true)
    look.update(new Vector3(0, 0, 1))
    expect(m.meshes.every((x) => x.visible)).toBe(true)
    look.setRadius(null)
    look.dispose()
    expect(m.meshes[0].material).toBe(original)
    expect(m.meshes.every((x) => x.visible)).toBe(true)
  })
})

describe('colour by element type', () => {
  it('paints each kind in its palette colour, keeping the layer opacity, and restores the originals', () => {
    const m = model()
    const paint: Record<string, Paint> = {
      ['C'.repeat(22)]: { kind: 'column', solid: true }, ['R'.repeat(22)]: { kind: 'rebar', solid: true }, ['D'.repeat(22)]: { kind: 'purlin', solid: true },
    }
    const original = m.meshes[0].material
    const look = applyConstructionLook(m, (g) => cls[g], 1, (g) => paint[g])
    const colour = (name: string) => (m.meshes.find((x) => x.name === name)!.material as MeshBasicMaterial)
    expect(colour('C'.repeat(22)).color.getHex()).toBe(KIND_COLOURS.column)
    expect(colour('R'.repeat(22)).color.getHex()).toBe(KIND_COLOURS.rebar)
    expect(colour('D'.repeat(22)).color.getHex()).toBe(KIND_COLOURS.purlin)
    expect(colour('C'.repeat(22)).opacity).toBeCloseTo(layerOpacity('structure', 0))
    look.setTransparency(1)
    expect(colour('C'.repeat(22)).opacity).toBeCloseTo(0.05)
    expect(colour('R'.repeat(22)).opacity).toBeCloseTo(0.05)
    look.dispose()
    expect(m.meshes[0].material).toBe(original)
  })

  it('falls back to the class alone without element data', () => {
    const m = model()
    const look = applyConstructionLook(m, (g) => cls[g], 1)
    expect((m.meshes[0].material as MeshBasicMaterial).color.getHex()).toBe(KIND_COLOURS.column)
    expect((m.meshes[2].material as MeshBasicMaterial).color.getHex()).toBe(KIND_COLOURS.opening)
    look.dispose()
  })
})

describe('look state (what the controls and the check read)', () => {
  it('starts with everything shown, no cut and no fading', () => {
    const look = applyConstructionLook(model(), (g) => cls[g], 1)
    expect(look.state()).toEqual({ transparency: 0, sectionM: null, radiusM: null, layers: { structure: true, rebar: true, openings: true, other: true } })
    expect(look.clipPlanes()).toEqual([])
    look.dispose()
  })

  it('reflects the setters, so remounted controls show the real view', () => {
    const look = applyConstructionLook(model(), (g) => cls[g], 1)
    look.setTransparency(0.4)
    look.setSection(3.3)
    look.setLayerVisible('rebar', false)
    look.setRadius(5)
    expect(look.state()).toEqual({ transparency: 0.4, sectionM: 3.3, radiusM: 5, layers: { structure: true, rebar: false, openings: true, other: true } })
    expect(look.clipPlanes()).toHaveLength(1)
    look.setSection(null)
    look.setLayerVisible('rebar', true)
    look.setRadius(null)
    expect(look.state().sectionM).toBeNull()
    expect(look.state().radiusM).toBeNull()
    expect(look.state().layers.rebar).toBe(true)
    expect(look.clipPlanes()).toEqual([])
    look.dispose()
  })

  it('returns a copy of the state, not the live object', () => {
    const look = applyConstructionLook(model(), (g) => cls[g], 1)
    look.state().layers.rebar = false
    expect(look.state().layers.rebar).toBe(true)
    look.dispose()
  })
})

describe('viewNote', () => {
  const all = { structure: true, rebar: true, openings: true, other: true }
  const none = { transparency: 0, sectionM: null, radiusM: null, layers: all }
  it('says nothing when the whole model was shown (fading does not hide anything)', () => {
    expect(viewNote({ ...none, transparency: 0.7 })).toBeNull()
  })
  it('names hidden layers, the cut and the view distance', () => {
    expect(viewNote({ ...none, sectionM: 3.3, layers: { ...all, rebar: false } }))
      .toBe('Checked as shown: Rebar hidden; cut above 3.3 m.')
    expect(viewNote({ ...none, layers: { ...all, structure: false, openings: false } }))
      .toBe('Checked as shown: Structure hidden; Doors, windows, services hidden.')
    expect(viewNote({ ...none, sectionM: 1 })).toBe('Checked as shown: cut above 1.0 m.')
    expect(viewNote({ ...none, radiusM: 6 })).toBe('Checked as shown: view distance 6 m.')
  })
})
