/**
 * The construction look shared by every AR mode, plus the controls field AR users expect:
 * transparency, a horizontal section (cut the model above a height) and layers.
 * Colour by element type (palette.js, like the reference video): columns blue, beams cyan, truss members green,
 * purlins yellow, bracing purple, concrete grey, rebar orange-red, openings/services and other sky blue.
 *   structure: translucent, steel-blue edges   rebar: opaque, no edges   openings and other: translucent, orange edges
 * Edges live on their own layer (kept out of the ID buffer). Originals are restored on dispose.
 */
import {
  DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Plane, Vector3,
  type Material,
} from 'three'
import type { LoadedModel } from './loadModel'
import { KIND_COLOURS, kindOf, type Kind, type Paint } from './palette'

export type Layer = 'structure' | 'rebar' | 'openings' | 'other'
export const LAYERS: { id: Layer; label: string }[] = [
  { id: 'structure', label: 'Structure' }, { id: 'rebar', label: 'Rebar' }, { id: 'openings', label: 'Doors, windows, services' }, { id: 'other', label: 'Other' },
]

const STRUCTURE = /^Ifc(Column|Beam|Slab|Footing|Member|Pile|Plate|Wall|WallStandardCase)$/
const HIGHLIGHT = 0xff6a13 // brand orange, as in the 3D viewer
const HIGHLIGHT_ORDER = 10
const OPENINGS = /^Ifc(Door|Window|Opening|Pipe|Duct|Flow|CableCarrier)/

export function layerOf(ifcClass: string): Layer {
  if (ifcClass === 'IfcReinforcingBar') return 'rebar'
  if (STRUCTURE.test(ifcClass)) return 'structure'
  if (OPENINGS.test(ifcClass)) return 'openings'
  return 'other'
}

/** Opacity of a layer's faces for a transparency setting t (0 = as solid as allowed, 1 = nearly invisible). */
export function layerOpacity(layer: Layer, t: number): number {
  const base = layer === 'rebar' ? 1 : layer === 'structure' ? 0.45 : 0.4
  return Math.max(0.05, base * (1 - 0.95 * Math.min(1, Math.max(0, t))))
}

/** What the look currently shows: the controls start from it, and the check judges only this. */
export type LookState = { transparency: number; sectionM: number | null; radiusM: number | null; layers: Record<Layer, boolean> }

export type ConstructionLook = {
  setTransparency(t: number): void
  /** Hide everything above this IFC height (metres), or null for no cut. */
  setSection(heightM: number | null): void
  setLayerVisible(layer: Layer, on: boolean): void
  /** Show only elements whose centre is within this many metres of the viewer (null: all). */
  setRadius(metres: number | null): void
  /** A copy of the current settings. */
  state(): LookState
  /** The active cut planes in world space (empty with no cut), as of the last update(). */
  clipPlanes(): Plane[]
  /** Call before each render with the viewer's world position: the cut plane and radius follow the model. */
  update(viewer?: Vector3): void
  /** Paint one element (the tapped one) solid orange over the rest, still cut by the section; null: none. */
  highlight(guid: string | null): void
  dispose(): void
}

/** A short note for check results when part of the model was hidden or cut, e.g. "Checked as shown: Rebar hidden; cut above 3.3 m." */
export function viewNote(s: LookState): string | null {
  const parts = LAYERS.filter((l) => !s.layers[l.id]).map((l) => `${l.label} hidden`)
  if (s.sectionM !== null) parts.push(`cut above ${s.sectionM.toFixed(1)} m`)
  if (s.radiusM !== null) parts.push(`view distance ${s.radiusM} m`)
  return parts.length ? `Checked as shown: ${parts.join('; ')}.` : null
}

/**
 * paintOf gives an element's kind from its elements.json row (classes alone can't tell a purlin from a truss
 * member); without it the kind comes from the class. Display colours only: the ID buffer keeps idColor.
 */
export function applyConstructionLook(model: LoadedModel, classOf: (guid: string) => string, edgeLayer: number,
  paintOf?: (guid: string) => Paint | undefined): ConstructionLook {
  const plane = new Plane()
  const clip: Plane[] = []
  // One material per layer and kind: the colour comes from the kind, the opacity from the layer.
  const mats = new Map<string, { layer: Layer; mat: MeshBasicMaterial }>()
  const materialFor = (layer: Layer, kind: Kind): MeshBasicMaterial => {
    const key = `${layer}/${kind}`
    let entry = mats.get(key)
    if (!entry) {
      const mat = new MeshBasicMaterial({ color: KIND_COLOURS[kind], transparent: true, depthWrite: layer === 'rebar', side: DoubleSide })
      mat.clippingPlanes = clip
      entry = { layer, mat }
      mats.set(key, entry)
    }
    return entry.mat
  }
  const edgeMats = { structure: new LineBasicMaterial({ color: 0x1c3b5e }), other: new LineBasicMaterial({ color: 0xff6a13 }) }
  for (const m of Object.values(edgeMats)) m.clippingPlanes = clip
  const originals = new Map<Mesh, Material | Material[]>()
  const edges: LineSegments[] = []
  const byLayer = new Map<Layer, Mesh[]>()
  for (const mesh of model.meshes) {
    originals.set(mesh, mesh.material)
    const guid = model.meshGuid.get(mesh) ?? ''
    const cls = classOf(guid)
    const layer = layerOf(cls)
    mesh.material = materialFor(layer, paintOf?.(guid)?.kind ?? kindOf(cls))
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), mesh])
    if (layer === 'rebar') continue // thin bars read fine without edges, and it halves the draw calls
    const line = new LineSegments(new EdgesGeometry(mesh.geometry, 25), layer === 'structure' ? edgeMats.structure : edgeMats.other)
    line.layers.set(edgeLayer)
    mesh.add(line)
    edges.push(line)
  }
  // The tapped element: brand orange like the 3D viewer's, drawn over the translucent model and cut like the rest.
  // In AR it is a tint with an orange outline, not a solid block: the real site must stay visible through it.
  const highlightMat = new MeshBasicMaterial({ color: HIGHLIGHT, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, side: DoubleSide })
  highlightMat.clippingPlanes = clip
  const highlightEdges = new LineBasicMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true })
  highlightEdges.clippingPlanes = clip
  let lit: [Mesh | LineSegments, Material | Material[], number][] = []
  let section: number | null = null
  let radius: number | null = null
  let transparency = 0
  const shown: Record<Layer, boolean> = { structure: true, rebar: true, openings: true, other: true }
  const layerOn = new Map<Mesh, boolean>(model.meshes.map((m) => [m, true]))
  const localCentre = new Map<Mesh, Vector3>(model.meshes.map((m) => {
    m.geometry.computeBoundingBox()
    return [m, m.geometry.boundingBox!.getCenter(new Vector3())]
  }))
  const c = new Vector3()
  const p = new Vector3()
  const n = new Vector3()
  const normalMatrix = new Matrix3()
  const world = new Matrix4()

  const look: ConstructionLook = {
    setTransparency(t) {
      transparency = t
      for (const { layer, mat } of mats.values()) mat.opacity = layerOpacity(layer, t)
    },
    setSection(h) {
      section = h
      clip.length = 0
      if (h !== null) clip.push(plane)
    },
    setLayerVisible(layer, on) {
      shown[layer] = on
      for (const mesh of byLayer.get(layer) ?? []) {
        layerOn.set(mesh, on)
        mesh.visible = on
      }
    },
    setRadius(metres) {
      radius = metres
      if (metres === null) for (const [mesh, on] of layerOn) mesh.visible = on
    },
    state() {
      return { transparency, sectionM: section, radiusM: radius, layers: { ...shown } }
    },
    clipPlanes() {
      return [...clip]
    },
    update(viewer) {
      if (radius !== null && viewer) {
        model.ifcRoot.updateMatrixWorld()
        for (const [mesh, on] of layerOn) mesh.visible = on && c.copy(localCentre.get(mesh)!).applyMatrix4(mesh.matrixWorld).distanceTo(viewer) <= radius
      }
      if (section === null) return
      model.ifcRoot.updateMatrixWorld()
      world.copy(model.ifcRoot.matrixWorld)
      // Keep the side below the cut: normal pointing down in IFC (-Z) through (0, 0, h).
      p.set(0, 0, section).applyMatrix4(world)
      n.set(0, 0, -1).applyMatrix3(normalMatrix.getNormalMatrix(world)).normalize()
      plane.setFromNormalAndCoplanarPoint(n, p)
    },
    highlight(guid) {
      for (const [mesh, mat, order] of lit) {
        mesh.material = mat
        mesh.renderOrder = order
      }
      lit = []
      if (!guid) return
      for (const mesh of model.meshes) {
        if (model.meshGuid.get(mesh) !== guid) continue
        lit.push([mesh, mesh.material, mesh.renderOrder])
        mesh.material = highlightMat
        mesh.renderOrder = HIGHLIGHT_ORDER
        for (const line of mesh.children) {
          if (!(line instanceof LineSegments)) continue
          lit.push([line, line.material, line.renderOrder])
          line.material = highlightEdges
          line.renderOrder = HIGHLIGHT_ORDER + 1
        }
      }
    },
    dispose() {
      look.highlight(null)
      highlightMat.dispose()
      highlightEdges.dispose()
      for (const line of edges) {
        line.removeFromParent()
        line.geometry.dispose()
      }
      for (const [mesh, mat] of originals) {
        mesh.material = mat
        mesh.visible = true
      }
      for (const { mat } of mats.values()) mat.dispose()
      for (const m of Object.values(edgeMats)) m.dispose()
    },
  }
  look.setTransparency(0)
  return look
}
