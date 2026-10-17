/**
 * The picked element in the virtual demo's BIM overlay (picking: scene/pick.ts), painted solid orange and drawn over
 * the rest of the overlay.
 */
import { type Material, type Mesh, MeshStandardMaterial } from 'three'
import type { LoadedModel } from '../scene/loadModel'

const HIGHLIGHT_ORDER = 10

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
