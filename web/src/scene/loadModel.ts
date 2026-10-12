/**
 * Load model.glb into the fixed scene graph (contract section 3):
 *
 *   ifcRoot (Group, matrixAutoUpdate = false)        <- viewer: IFC_TO_THREE; AR: modelMatrixIfc(anchor, pose)
 *     gltfScene (matrix = IFC_FROM_GLTF_MAT4)
 *       <GUID nodes from convert.py>
 *
 * Everything under ifcRoot is in IFC coordinates (metres, Z up): pins, boxes and anchors are added
 * there without any further conversion. Never rotate the glb itself.
 */
import { Group, Material, Matrix4, Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { guidOf } from './elements'

export type LoadedModel = {
  ifcRoot: Group
  gltfScene: Group
  meshes: Mesh[]
  meshGuid: Map<Mesh, string>
  byGuid: Map<string, Object3D>
}

/**
 * IFC (X, Y, Z) = glTF (x, -z, y): the inverse of convert.py's fixed glTF (x, y, z) = IFC (X, Z, -Y).
 * Column-major, for Matrix4.fromArray. Part 2's pose module exports the same constant.
 */
export const IFC_FROM_GLTF_MAT4: number[] = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]

/** Viewer only: three.js (Y up) from IFC (Z up), a -90 degree rotation about X. */
export const IFC_TO_THREE: Matrix4 = new Matrix4().makeRotationX(-Math.PI / 2)

export function buildLoadedModel(gltfScene: Group, knownGuids: ReadonlySet<string>): LoadedModel {
  const ifcRoot = new Group()
  ifcRoot.name = 'ifcRoot'
  ifcRoot.matrixAutoUpdate = false
  gltfScene.matrixAutoUpdate = false
  gltfScene.matrix.fromArray(IFC_FROM_GLTF_MAT4)
  ifcRoot.add(gltfScene)

  const meshes: Mesh[] = []
  const meshGuid = new Map<Mesh, string>()
  const byGuid = new Map<string, Object3D>()
  gltfScene.traverse((obj) => {
    const raw = (obj.userData?.name as string | undefined) ?? obj.name
    if (raw && knownGuids.has(raw) && !byGuid.has(raw)) byGuid.set(raw, obj)
    if (obj instanceof Mesh) {
      const guid = guidOf(obj, knownGuids)
      if (guid) {
        meshes.push(obj)
        meshGuid.set(obj, guid)
      }
    }
  })
  ifcRoot.updateMatrixWorld(true)
  return { ifcRoot, gltfScene, meshes, meshGuid, byGuid }
}

export async function parseModel(data: ArrayBuffer, knownGuids: ReadonlySet<string>): Promise<LoadedModel> {
  const gltf = await new GLTFLoader().parseAsync(data, '')
  return buildLoadedModel(gltf.scene, knownGuids)
}

export async function loadModel(url: string, knownGuids: ReadonlySet<string>): Promise<LoadedModel> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load the model (HTTP ${res.status})`)
  return parseModel(await res.arrayBuffer(), knownGuids)
}

/** Free GPU memory once nothing renders the model any more. */
export function disposeModel(model: LoadedModel): void {
  model.ifcRoot.removeFromParent()
  model.gltfScene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    obj.geometry.dispose()
    const mats: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((m) => m.dispose())
  })
}
