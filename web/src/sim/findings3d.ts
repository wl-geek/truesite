/**
 * After a check in the virtual demo, show each deviation in 3D: a see-through orange "ghost" of the design where the
 * element should be, and the as-built element tinted red when it was built somewhere else. Missing elements are
 * just their ghost. Returns a function that removes it all again.
 */
import { Group, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Scene } from 'three'
import type { Finding } from '../api/types'
import { IFC_FROM_GLTF_MAT4, type LoadedModel } from '../scene/loadModel'

const DEVIATIONS = new Set<Finding['status']>(['missing', 'misplaced', 'different_from_design'])

export function markFindings(world: Scene, design: LoadedModel, asBuilt: LoadedModel, findings: readonly Finding[]): () => void {
  const ghostMat = new MeshBasicMaterial({ color: 0xff6a13, transparent: true, opacity: 0.38, depthWrite: false })
  const builtMat = new MeshStandardMaterial({ color: 0xc8361b, emissive: 0x4a0b00, roughness: 0.6 })
  const ghosts = new Group()
  ghosts.name = 'design-ghosts'
  ghosts.matrixAutoUpdate = false
  ghosts.matrix.fromArray(IFC_FROM_GLTF_MAT4) // the design nodes are in glTF coordinates, like under gltfScene
  const tinted: [Mesh, Material | Material[]][] = []
  for (const f of findings) {
    if (!DEVIATIONS.has(f.status)) continue
    const node = design.byGuid.get(f.guid)
    if (node) {
      const ghost = node.clone(true)
      ghost.traverse((o) => {
        if (o instanceof Mesh) {
          o.material = ghostMat
          o.renderOrder = 5
        }
      })
      ghosts.add(ghost)
    }
    if (f.status !== 'missing') {
      asBuilt.byGuid.get(f.guid)?.traverse((o) => {
        if (o instanceof Mesh) {
          tinted.push([o, o.material])
          o.material = builtMat
        }
      })
    }
  }
  ghosts.updateMatrixWorld(true)
  world.add(ghosts)
  return () => {
    ghosts.removeFromParent()
    for (const [mesh, mat] of tinted) mesh.material = mat
    ghostMat.dispose()
    builtMat.dispose()
  }
}
