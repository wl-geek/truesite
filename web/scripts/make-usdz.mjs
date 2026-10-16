// Build step: write public/models/<project>.usdz from bim/models/<project>/model.glb for iPhone/iPad AR
// Quick Look ("Walk inside"). Same look and recentring as src/scene/walkthrough.ts: the origin is the
// floor anchor's spot (else the footprint centre), Y-up metres, colour by element type from
// src/scene/palette.js (shared, so the app and this file can't drift apart).
// 1:1 floor projects also get distance variants, <project>-r<R>.usdz, with only the elements whose plan
// footprint is within R metres of that spot (src/scene/usdzVariants.js): Quick Look has no View distance
// slider, so Walk inside opens the variant nearest the setting instead.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Group, Mesh, MeshStandardMaterial, Scene } from 'three'
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { materialParams, paintOf, smoothShaded } from '../src/scene/palette.js'
import { usdzFile, usdzPlan, withinRadius } from '../src/scene/usdzVariants.js'

const here = dirname(fileURLToPath(import.meta.url))
const modelsDir = join(here, '..', '..', 'bim', 'models')
const outDir = join(here, '..', 'public', 'models')
const GUID = /^[0-9A-Za-z_$]{22}$/

function guidOf(obj) {
  for (let o = obj; o; o = o.parent) for (const n of [o.userData?.name, o.name]) if (n && GUID.test(n)) return n
  return null
}

const materials = new Map()
function materialFor(paint) {
  const key = `${paint.kind}/${paint.solid}`
  if (!materials.has(key)) materials.set(key, new MeshStandardMaterial(materialParams(paint)))
  return materials.get(key)
}

if (!existsSync(modelsDir)) {
  console.log(`make-usdz: no ${modelsDir}, skipped`)
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })
for (const name of readdirSync(outDir)) if (name.endsWith('.usdz')) rmSync(join(outDir, name)) // no stale variants
for (const project of readdirSync(modelsDir)) {
  const dir = join(modelsDir, project)
  if (!existsSync(join(dir, 'model.glb'))) continue
  const elements = JSON.parse(readFileSync(join(dir, 'elements.json'), 'utf8'))
  const anchors = JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8'))
  const byGuid = new Map(elements.map((e) => [e.guid, e]))
  const buf = readFileSync(join(dir, 'model.glb'))
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  const plan = usdzPlan(anchors, elements)
  const [cx, cy] = plan.centre
  const copies = [] // [guid, mesh in glTF frame]
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const guid = guidOf(obj) ?? ''
    const paint = paintOf(byGuid.get(guid) ?? { ifc_class: '' })
    // Round bars and rods: indexed + smooth normals (smaller, rounder). Boxy sections: flat normals for crisp edges.
    const g = smoothShaded(paint.kind) || !obj.geometry.index ? obj.geometry.clone() : obj.geometry.toNonIndexed()
    g.computeVertexNormals()
    const copy = new Mesh(g, materialFor(paint))
    copy.applyMatrix4(obj.matrixWorld)
    copies.push([guid, copy])
  })
  for (const radius of [null, ...plan.radii]) {
    const keep = radius === null ? null : new Set(withinRadius(elements, plan.centre, radius).map((e) => e.guid))
    const root = new Group()
    root.position.set(-cx, 0, cy) // glTF = (X, Z, -Y): IFC (cx, cy) -> origin
    root.updateMatrix() // USDZExporter writes object.matrix as it is and never updates it (audit B-02)
    for (const [guid, mesh] of copies) if (!keep || keep.has(guid)) root.add(mesh.clone())
    const scene = new Scene()
    scene.add(root)
    const data = await new USDZExporter().parseAsync(scene, {
      quickLookCompatible: true, ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
    })
    const file = usdzFile(project, radius)
    writeFileSync(join(outDir, file), Buffer.from(data))
    const what = keep ? `${keep.size}/${elements.length} elements within ${radius} m` : `${elements.length} elements`
    console.log(`make-usdz: ${file} ${(data.byteLength / 1e6).toFixed(1)} MB, ${what}, origin at IFC (${cx}, ${cy})`)
  }
}
