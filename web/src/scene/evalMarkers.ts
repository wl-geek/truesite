// Overlay-accuracy evaluation (spec 10): green crosses at surveyed points (IFC metres). On a phone,
// measure the on-screen offset between each cross and its tape mark at 1, 2 and 3 m.
// The crosses live on EDGE_LAYER, so they never reach the ID buffer or the design render.
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three'
import { EDGE_LAYER } from './overlay'

export type EvalPoint = { id: string; label: string; position_m: [number, number, number] }

export function parseEvalPoints(json: unknown): EvalPoint[] {
  if (!Array.isArray(json)) return []
  return json.filter((p): p is EvalPoint =>
    typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.label === 'string' &&
    Array.isArray(p.position_m) && p.position_m.length === 3 && p.position_m.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)))
}

export function makeEvalMarkers(points: readonly EvalPoint[], halfSizeM = 0.05): Group {
  const group = new Group()
  group.name = 'eval-markers'
  const material = new LineBasicMaterial({ color: 0x00e676, depthTest: false })
  for (const p of points) {
    const [x, y, z] = p.position_m
    const h = halfSizeM
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([x - h, y, z, x + h, y, z, x, y - h, z, x, y + h, z, x, y, z - h, x, y, z + h], 3))
    const cross = new LineSegments(geo, material)
    cross.layers.set(EDGE_LAYER)
    cross.renderOrder = 20
    cross.userData = { id: p.id }
    group.add(cross)
  }
  return group
}
