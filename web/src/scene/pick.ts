/**
 * What a tap means, as the user sees it (live AR, the virtual demo): the element drawn under the finger. Hidden meshes
 * (layers, view distance) and a hidden model (tracking lost) don't count, nor do parts cut away by the section's clip
 * planes, which a raycast alone would still hit. A tap that misses searches two rings around the finger, so thin rebar
 * or a far purlin can be picked without pixel-perfect aim ("reasonably sized touch targets", ARCore design guidelines):
 * the nearest ring with a hit wins, and in it the hit nearest the camera.
 */
import { type Camera, type Intersection, type Mesh, type Object3D, type Plane, Raycaster, Vector2 } from 'three'
import type { LoadedModel } from './loadModel'

/** How far around the finger a miss looks (CSS px): a fingertip is about this wide. */
export const TAP_TOLERANCE_PX = 22
const RING_DIRECTIONS = 8

export type PickOptions = {
  /** The view's size in CSS px (to turn the tolerance into NDC). */
  viewW: number
  viewH: number
  /** The world-space clip planes the drawing uses (look.clipPlanes()); points on their negative side are cut away. */
  clip?: readonly Plane[]
  tolerancePx?: number
}

/** NDC offsets to try, centre first, then a ring at half the tolerance and one at the full tolerance. */
function samples(o: PickOptions): [number, number][][] {
  const tol = o.tolerancePx ?? TAP_TOLERANCE_PX
  const rings: [number, number][][] = [[[0, 0]]]
  for (const r of tol > 0 ? [tol / 2, tol] : []) {
    rings.push(Array.from({ length: RING_DIRECTIONS }, (_, i) => {
      const a = (2 * Math.PI * i) / RING_DIRECTIONS
      return [(2 * r * Math.cos(a)) / o.viewW, (-2 * r * Math.sin(a)) / o.viewH] as [number, number]
    }))
  }
  return rings
}

function nearestHit(objects: Object3D[], camera: Camera, ndc: { x: number; y: number }, o: PickOptions): Intersection | null {
  if (!objects.length) return null
  const ray = new Raycaster()
  const kept = (h: Intersection) => (o.clip ?? []).every((plane) => plane.distanceToPoint(h.point) >= -1e-6)
  for (const ring of samples(o)) {
    let best: Intersection | null = null
    for (const [dx, dy] of ring) {
      ray.setFromCamera(new Vector2(ndc.x + dx, ndc.y + dy), camera)
      const hit = ray.intersectObjects(objects, false).find(kept)
      if (hit && (!best || hit.distance < best.distance)) best = hit
    }
    if (best) return best
  }
  return null
}

/** The element (guid) drawn at `ndc` (-1..1, y up), or null. */
export function pickElement(model: LoadedModel, camera: Camera, ndc: { x: number; y: number }, o: PickOptions): string | null {
  if (!model.ifcRoot.visible) return null
  const hit = nearestHit(model.meshes.filter((m) => m.visible), camera, ndc, o)
  return hit ? model.meshGuid.get(hit.object as Mesh) ?? null : null
}

/** The mark of the finding pin at `ndc`, or null (pins: scene/pins.ts, each mesh with userData.mark). */
export function pickPin(pins: Object3D | null, camera: Camera, ndc: { x: number; y: number }, o: PickOptions): number | null {
  if (!pins || !pins.visible) return null
  const hit = nearestHit(pins.children, camera, ndc, o)
  const mark = hit?.object.userData.mark
  return typeof mark === 'number' ? mark : null
}
