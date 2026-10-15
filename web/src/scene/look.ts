/**
 * The construction look shared by every AR mode, plus the controls field AR users expect:
 * transparency, a horizontal section (cut the model above a height) and layers.
 *   structure: concrete grey, translucent, steel-blue edges   rebar: opaque red-orange, no edges
 *   openings/services and other: translucent sky blue, orange edges
 * Edges live on their own layer (kept out of the ID buffer). Originals are restored on dispose.
 */
import {
  DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Plane, Vector3,
  type Material,
} from 'three'
import type { LoadedModel } from './loadModel'

export type Layer = 'structure' | 'rebar' | 'openings' | 'other'
export const LAYERS: { id: Layer; label: string }[] = [
  { id: 'structure', label: 'Structure' }, { id: 'rebar', label: 'Rebar' }, { id: 'openings', label: 'Doors, windows, services' }, { id: 'other', label: 'Other' },
]

const STRUCTURE = /^Ifc(Column|Beam|Slab|Footing|Member|Pile|Plate|Wall|WallStandardCase)$/
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

export type ConstructionLook = {
  setTransparency(t: number): void
  /** Hide everything above this IFC height (metres), or null for no cut. */
  setSection(heightM: number | null): void
  setLayerVisible(layer: Layer, on: boolean): void
  /** Show only elements whose centre is within this many metres of the viewer (null: all). */
  setRadius(metres: number | null): void
  /** Call before each render with the viewer's world position: the cut plane and radius follow the model. */
  update(viewer?: Vector3): void
  dispose(): void
}

export function applyConstructionLook(model: LoadedModel, classOf: (guid: string) => string, edgeLayer: number): ConstructionLook {
  const mats: Record<Layer, MeshBasicMaterial> = {
    structure: new MeshBasicMaterial({ color: 0xb9bec4, transparent: true, depthWrite: false, side: DoubleSide }),
    rebar: new MeshBasicMaterial({ color: 0xe0441b, transparent: true, side: DoubleSide }),
    openings: new MeshBasicMaterial({ color: 0x4e7fb3, transparent: true, depthWrite: false, side: DoubleSide }),
    other: new MeshBasicMaterial({ color: 0x4e7fb3, transparent: true, depthWrite: false, side: DoubleSide }),
  }
  const edgeMats = { structure: new LineBasicMaterial({ color: 0x1c3b5e }), other: new LineBasicMaterial({ color: 0xff6a13 }) }
  const plane = new Plane()
  const clip: Plane[] = []
  for (const m of [...Object.values(mats), ...Object.values(edgeMats)]) m.clippingPlanes = clip
  const originals = new Map<Mesh, Material | Material[]>()
  const edges: LineSegments[] = []
  const byLayer = new Map<Layer, Mesh[]>()
  for (const mesh of model.meshes) {
    originals.set(mesh, mesh.material)
    const layer = layerOf(classOf(model.meshGuid.get(mesh) ?? ''))
    mesh.material = mats[layer]
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), mesh])
    if (layer === 'rebar') continue // thin bars read fine without edges, and it halves the draw calls
    const line = new LineSegments(new EdgesGeometry(mesh.geometry, 25), layer === 'structure' ? edgeMats.structure : edgeMats.other)
    line.layers.set(edgeLayer)
    mesh.add(line)
    edges.push(line)
  }
  let section: number | null = null
  let radius: number | null = null
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
      for (const layer of Object.keys(mats) as Layer[]) mats[layer].opacity = layerOpacity(layer, t)
    },
    setSection(h) {
      section = h
      clip.length = 0
      if (h !== null) clip.push(plane)
    },
    setLayerVisible(layer, on) {
      for (const mesh of byLayer.get(layer) ?? []) {
        layerOn.set(mesh, on)
        mesh.visible = on
      }
    },
    setRadius(metres) {
      radius = metres
      if (metres === null) for (const [mesh, on] of layerOn) mesh.visible = on
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
    dispose() {
      for (const line of edges) {
        line.removeFromParent()
        line.geometry.dispose()
      }
      for (const [mesh, mat] of originals) {
        mesh.material = mat
        mesh.visible = true
      }
      for (const m of [...Object.values(mats), ...Object.values(edgeMats)]) m.dispose()
    },
  }
  look.setTransparency(0)
  return look
}
