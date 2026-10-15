// Build step: write public/models/<project>.usdz from bim/models/<project>/model.glb for iPhone/iPad AR
// Quick Look ("Walk inside"). Same look and recentring as src/scene/walkthrough.ts: the origin is the
// floor anchor's spot (else the footprint centre), Y-up metres, concrete translucent grey, rebar red.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Group, Mesh, MeshStandardMaterial, Scene } from 'three'
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const here = dirname(fileURLToPath(import.meta.url))
const modelsDir = join(here, '..', '..', 'bim', 'models')
const outDir = join(here, '..', 'public', 'models')
const GUID = /^[0-9A-Za-z_$]{22}$/

function guidOf(obj) {
  for (let o = obj; o; o = o.parent) for (const n of [o.userData?.name, o.name]) if (n && GUID.test(n)) return n
  return null
}

function centre(anchors, elements) {
  const floor = anchors.find((a) => a.normal[2] > 0.9 && a.scale >= 0.999)
  if (floor) return [floor.position_m[0], floor.position_m[1]]
  const xs = elements.flatMap((e) => [e.bbox_m[0][0], e.bbox_m[1][0]])
  const ys = elements.flatMap((e) => [e.bbox_m[0][1], e.bbox_m[1][1]])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

const concrete = new MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45 })
const rebar = new MeshStandardMaterial({ color: 0xe0441b, roughness: 0.6, metalness: 0.2 })
const other = new MeshStandardMaterial({ color: 0x4e7fb3, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45 })

if (!existsSync(modelsDir)) {
  console.log(`make-usdz: no ${modelsDir}, skipped`)
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })
for (const project of readdirSync(modelsDir)) {
  const dir = join(modelsDir, project)
  if (!existsSync(join(dir, 'model.glb'))) continue
  const elements = JSON.parse(readFileSync(join(dir, 'elements.json'), 'utf8'))
  const anchors = JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8'))
  const cls = new Map(elements.map((e) => [e.guid, e.ifc_class]))
  const buf = readFileSync(join(dir, 'model.glb'))
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  const [cx, cy] = centre(anchors, elements)
  const root = new Group()
  root.position.set(-cx, 0, cy) // glTF = (X, Z, -Y): IFC (cx, cy) -> origin
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const c = cls.get(guidOf(obj) ?? '') ?? ''
    const mat = c === 'IfcReinforcingBar' ? rebar : /^Ifc(Column|Beam|Slab|Footing|Member|Pile|Plate)$/.test(c) ? concrete : other
    // Round bars: indexed + smooth normals (smaller, rounder). Boxy concrete: flat normals for crisp edges.
    const g = c === 'IfcReinforcingBar' || !obj.geometry.index ? obj.geometry.clone() : obj.geometry.toNonIndexed()
    g.computeVertexNormals()
    const copy = new Mesh(g, mat)
    copy.applyMatrix4(obj.matrixWorld)
    root.add(copy)
  })
  const scene = new Scene()
  scene.add(root)
  const data = await new USDZExporter().parseAsync(scene, {
    quickLookCompatible: true, ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  })
  writeFileSync(join(outDir, `${project}.usdz`), Buffer.from(data))
  console.log(`make-usdz: ${project}.usdz ${(data.byteLength / 1e6).toFixed(1)} MB, origin at IFC (${cx}, ${cy})`)
}
