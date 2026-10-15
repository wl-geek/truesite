/**
 * Levelled placement for world-tracked AR. The QR gives the position and heading; "up" comes from
 * gravity (XR world space is Y-up) and, for life-size models, the ground comes from the floor the AR
 * system detected. So a hand-held or slightly tilted sheet never tilts, sinks or floats the building.
 */
import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * world_from_IFC (column-major Matrix4): IFC X -> the QR's heading flattened to horizontal, IFC Z -> world up,
 * uniform scale, the anchor's IFC point on the code's world position. With floorY set, IFC z = 0 lands on it.
 * @param rotation   world_from_IFC rotation estimated from the code (may be tilted)
 * @param codeWorld  world position of the code centre
 * @param anchorIfc  the code centre in IFC coordinates (anchors.json position_m)
 * @param scale      anchor scale (1 life size, 0.05 desk)
 * @param floorY     detected floor height (world Y), or null to trust the code's modelled height
 */
export function levelledPlacement(rotation: Quaternion, codeWorld: Vector3, anchorIfc: Vector3, scale: number, floorY: number | null): Matrix4 {
  const up = new Vector3(0, 1, 0)
  let x = new Vector3(1, 0, 0).applyQuaternion(rotation).setY(0)
  if (x.lengthSq() < 1e-6) x = new Vector3(0, 1, 0).applyQuaternion(rotation).setY(0).cross(up) // IFC X near vertical
  x.normalize()
  const y = new Vector3().crossVectors(up, x) // IFC Y = Z x X
  const basis = new Matrix4().makeBasis(x, y, up).scale(new Vector3(scale, scale, scale))
  const height = floorY === null ? codeWorld.y : floorY + scale * anchorIfc.z
  const t = new Vector3(codeWorld.x, height, codeWorld.z).sub(anchorIfc.clone().applyMatrix4(basis))
  return basis.setPosition(t)
}
