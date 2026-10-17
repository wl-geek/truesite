/**
 * Tapping the BIM overlay in the virtual demo. The overlay is drawn over the site, like AR, so the nearest design
 * surface under the pointer wins, even where an as-built element stands in front of it. The picked element is painted
 * solid orange and drawn over the rest of the overlay.
 */
import { type Camera, type Material, type Mesh, MeshStandardMaterial, Raycaster, Vector2 } from 'three'
import type { LoadedModel } from '../scene/loadModel'

const HIGHLIGHT_ORDER = 10

/** The design element at a point in normalised device coordinates (-1..1, y up), or null. Hidden meshes don't count. */
export function pickDesign(design: LoadedModel, camera: Camera, ndc: { x: number; y: number }): string | null {
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
  const hit = ray.intersectObjects(design.meshes.filter((m) => m.visible), false)[0]
  return hit ? design.meshGuid.get(hit.object as Mesh) ?? null : null
}

/** Paints one design element at a time; set(null) or dispose() gives every mesh its own material back. */
export function overlayHighlighter(design: LoadedModel): { set: (guid: string | null) => void; dispose: () => void } {
  const mat = new MeshStandardMaterial({ color: 0xff6a13, emissive: 0x6a2400, roughness: 0.5, transparent: true, opacity: 0.85, depthTest: false })
  let painted: [Mesh, Material | Material[], number][] = []
  const set = (guid: string | null) => {
    for (const [mesh, original, order] of painted) {
      mesh.material = original
      mesh.renderOrder = order
    }
    painted = []
    if (!guid) return
    for (const mesh of design.meshes) {
      if (design.meshGuid.get(mesh) !== guid) continue
      painted.push([mesh, mesh.material, mesh.renderOrder])
      mesh.material = mat
      mesh.renderOrder = HIGHLIGHT_ORDER
    }
  }
  return { set, dispose: () => { set(null); mat.dispose() } }
}
