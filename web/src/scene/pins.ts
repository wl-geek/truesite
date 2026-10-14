// Finding pins in the 3D model: a sphere at each deviating element's bbox centre, coloured by
// severity. Added under ifcRoot, so they are in IFC coordinates and follow the model (and the
// 1:20 desk scale) automatically.
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three'
import type { Element, Finding, Severity } from '../api/types'

const COLOURS: Record<Severity, number> = { high: 0xc62828, medium: 0xff6a13, low: 0x4e7fb3 }

export function findingAnchorPoint(el: Element): [number, number, number] {
  const [[x0, y0, z0], [x1, y1, z1]] = el.bbox_m
  return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
}

export function makePins(findings: readonly Finding[], elements: ReadonlyMap<string, Element>, radiusM = 0.08): Group {
  const group = new Group()
  group.name = 'finding-pins'
  const geometry = new SphereGeometry(radiusM, 16, 12)
  for (const f of findings) {
    const el = elements.get(f.guid)
    if (!el || !f.severity) continue
    const pin = new Mesh(geometry, new MeshBasicMaterial({ color: COLOURS[f.severity], depthTest: false, transparent: true, opacity: 0.95 }))
    pin.position.set(...findingAnchorPoint(el))
    pin.renderOrder = 10
    pin.userData = { mark: f.mark, guid: f.guid }
    group.add(pin)
  }
  return group
}

export function disposePins(group: Group): void {
  group.removeFromParent()
  group.children.forEach((c) => (c as Mesh).material instanceof MeshBasicMaterial && ((c as Mesh).material as MeshBasicMaterial).dispose())
  ;(group.children[0] as Mesh | undefined)?.geometry.dispose()
}
