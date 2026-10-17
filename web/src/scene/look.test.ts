import { BoxGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
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

describe('construction look (mutation-tested)', () => {
  const COL = 'C'.repeat(22), COL2 = 'K'.repeat(22), BAR = 'R'.repeat(22), DOOR = 'D'.repeat(22)
  const classes: Record<string, string> = { [COL]: 'IfcColumn', [COL2]: 'IfcColumn', [BAR]: 'IfcReinforcingBar', [DOOR]: 'IfcDoor' }
  function model4() {
    const g = new Group()
    for (const name of [COL, COL2, BAR, DOOR]) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      m.name = name
      g.add(m)
    }
    return buildLoadedModel(g, new Set(Object.keys(classes)))
  }
  const mesh = (m: ReturnType<typeof model4>, name: string) => m.meshes.find((x) => x.name === name)!
  const edgesOf = (x: Mesh) => x.children.filter((c): c is LineSegments => c instanceof LineSegments)

  it('fades doors, services and other elements from 0.4, structure from 0.45, rebar from solid', () => {
    expect(layerOpacity('openings', 0)).toBeCloseTo(0.4, 9)
    expect(layerOpacity('other', 0)).toBeCloseTo(0.4, 9)
    expect(layerOpacity('structure', 0.5)).toBeCloseTo((0.45 + 0.45 * 0.05) / 2, 9) // linear: half way to 5 % of its base
    expect(layerOpacity('rebar', 2)).toBeCloseTo(0.05, 9) // out-of-range slider values are clamped
    expect(layerOpacity('structure', -1)).toBeCloseTo(0.45, 9)
  })

  it('shares one see-through material per layer and kind, so the slider fades every mesh', () => {
    const m = model4()
    const look = applyConstructionLook(m, (g) => classes[g], 3)
    const a = mesh(m, COL).material as MeshBasicMaterial
    expect(mesh(m, COL2).material).toBe(a)
    look.setTransparency(1)
    for (const name of [COL, COL2, BAR, DOOR]) expect((mesh(m, name).material as MeshBasicMaterial).opacity, name).toBeCloseTo(0.05, 9)
    expect(a.transparent).toBe(true)
    expect(a.depthWrite).toBe(false) // see-through structure must not hide what is behind it
    expect((mesh(m, BAR).material as MeshBasicMaterial).depthWrite).toBe(true) // solid rebar does
    look.dispose()
  })

  it('outlines structure in steel blue and the rest in orange on the edge layer, never rebar', () => {
    const m = model4()
    const look = applyConstructionLook(m, (g) => classes[g], 3)
    const [colEdges] = edgesOf(mesh(m, COL))
    const [doorEdges] = edgesOf(mesh(m, DOOR))
    const blue = (colEdges.material as LineBasicMaterial).color
    const orange = (doorEdges.material as LineBasicMaterial).color
    expect(blue.b).toBeGreaterThan(blue.r)
    expect(orange.r).toBeGreaterThan(orange.b)
    expect(edgesOf(mesh(m, COL2))[0].material).toBe(colEdges.material) // one edge material per kind
    expect(edgesOf(mesh(m, BAR))).toEqual([])
    for (const e of [colEdges, doorEdges]) {
      expect(e.layers.isEnabled(3)).toBe(true)
      expect(e.layers.isEnabled(0)).toBe(false) // kept out of the ID buffer and the design render
    }
    look.dispose()
    expect(edgesOf(mesh(m, COL))).toEqual([])
    expect(edgesOf(mesh(m, DOOR))).toEqual([])
  })

  it('frees its materials and edge geometry on dispose', () => {
    const m = model4()
    const look = applyConstructionLook(m, (g) => classes[g], 3)
    const [edges] = edgesOf(mesh(m, COL))
    const disposed: string[] = []
    edges.geometry.addEventListener('dispose', () => disposed.push('edge geometry'))
    ;(edges.material as LineBasicMaterial).addEventListener('dispose', () => disposed.push('edge material'))
    ;(mesh(m, COL).material as MeshBasicMaterial).addEventListener('dispose', () => disposed.push('face material'))
    look.dispose()
    expect(disposed.sort()).toEqual(['edge geometry', 'edge material', 'face material'])
  })

  it('keeps a hidden layer hidden when the view distance changes, and shows the rest again without one', () => {
    const m = model4()
    const look = applyConstructionLook(m, (g) => classes[g], 3)
    look.setLayerVisible('rebar', false)
    look.setRadius(50)
    look.update(new Vector3(0, 0, 1))
    expect(mesh(m, BAR).visible).toBe(false)
    expect(mesh(m, COL).visible).toBe(true)
    look.update(new Vector3(0, 0, 100)) // everything beyond the view distance
    expect(m.meshes.every((x) => !x.visible)).toBe(true)
    look.setRadius(null) // no update() needed: the layers come straight back
    expect(m.meshes.filter((x) => x.visible).map((x) => x.name).sort()).toEqual([COL, COL2, DOOR].sort())
    look.dispose()
  })

  it('moves the cut with the model', () => {
    const m = model4()
    const look = applyConstructionLook(m, (g) => classes[g], 3)
    look.setSection(2)
    m.ifcRoot.matrix.copy(new Matrix4().makeTranslation(0, 0, 10)) // the model placed 10 m higher
    m.ifcRoot.matrixWorldNeedsUpdate = true
    look.update()
    expect(look.clipPlanes()[0].distanceToPoint(new Vector3(0, 0, 12))).toBeCloseTo(0, 9)
    look.dispose()
  })

  it('names the Other layer when it is hidden', () => {
    const all = { structure: true, rebar: true, openings: true, other: true }
    expect(viewNote({ transparency: 0, sectionM: null, radiusM: null, layers: { ...all, other: false } })).toBe('Checked as shown: Other hidden.')
  })
})
