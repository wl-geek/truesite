/**
 * Dev only (sample-studio.html, not in the build): renders one simulated site photo of a project with staged
 * deviations, for scripts/make-samples.mjs. `?id=<sample_id>` picks a row of scripts/sample-specs.json.
 *
 * The photo is drawn the way a camera would see the as-built state: opaque concrete, painted steel, rusty rebar,
 * sky, a car park and sun shadows, so it looks nothing like the colour-coded design render the check compares it
 * with. The camera matches the stored K and pose exactly, so the design render lines up with the photo.
 * The result goes into <script id="sample-out"> as JSON: { meta, photo (JPEG data URL) }.
 */
import {
  ACESFilmicToneMapping, BoxGeometry, CanvasTexture, Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import { getProject } from '../api/client'
import type { Element } from '../api/types'
import { buildSampleMeta } from '../check/sampleMeta'
import type { Vec3 } from '../pose'
import { kindOf } from '../scene/palette'
import { loadModel } from '../scene/loadModel'
import specs from '../../scripts/sample-specs.json'
import { samplePose } from './samplePose'

type Spec = (typeof specs)[number]
const W = 1280
const H = 720

const MAT = {
  concrete: new MeshStandardMaterial({ color: 0xb3b0a8, roughness: 0.95 }),
  footing: new MeshStandardMaterial({ color: 0x9a978f, roughness: 1 }),
  steel: new MeshStandardMaterial({ color: 0x6c7782, roughness: 0.55, metalness: 0.35 }),
  truss: new MeshStandardMaterial({ color: 0x7f8a93, roughness: 0.5, metalness: 0.35 }),
  purlin: new MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.4, metalness: 0.55 }),
  brace: new MeshStandardMaterial({ color: 0x555c63, roughness: 0.5, metalness: 0.4 }),
  rebar: new MeshStandardMaterial({ color: 0x7a4529, roughness: 0.8, metalness: 0.2 }),
  rail: new MeshStandardMaterial({ color: 0xd8a414, roughness: 0.6, metalness: 0.1 }),
}

function materialFor(e: Element): MeshStandardMaterial {
  const kind = kindOf(e.ifc_class, String(e.props?.PredefinedType ?? ''))
  const concrete = /concrete/i.test(String(e.props?.Material ?? ''))
  if (e.ifc_class === 'IfcFooting') return MAT.footing
  if (kind === 'rebar') return MAT.rebar
  if (kind === 'concrete' || concrete) return MAT.concrete
  if (kind === 'column' || kind === 'beam') return MAT.steel
  if (kind === 'truss') return MAT.truss
  if (kind === 'purlin') return MAT.purlin
  if (kind === 'brace') return MAT.brace
  return MAT.rail
}

/** Small deterministic PRNG, so a re-run gives the same grain. */
function rng(seed: string): () => number {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 2166136261)
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function skyTexture(): CanvasTexture {
  const c = Object.assign(document.createElement('canvas'), { width: 4, height: 256 })
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#6f9fd0')
  grad.addColorStop(0.55, '#a9c7e3')
  grad.addColorStop(1, '#e4ecf2')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 256)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** 80 x 80 m of car park around the site: asphalt, bay lines, and a concrete pad under the building. */
function groundTexture(rand: () => number): CanvasTexture {
  const px = 2048
  const m = px / 80 // pixels per metre; the canvas covers x -31..49, y -34..46 (centred on the building)
  const c = Object.assign(document.createElement('canvas'), { width: px, height: px })
  const g = c.getContext('2d')!
  const X = (x: number) => (x + 31) * m
  const Y = (y: number) => (46 - y) * m
  g.fillStyle = '#3d4043'
  g.fillRect(0, 0, px, px)
  for (let i = 0; i < 60000; i++) {
    const v = 40 + rand() * 50
    g.fillStyle = `rgb(${v},${v + 2},${v + 4})`
    g.fillRect(rand() * px, rand() * px, 2, 2)
  }
  g.fillStyle = '#8f8c86' // the construction pad
  g.fillRect(X(-2), Y(14), 22 * m, 16 * m)
  for (let i = 0; i < 20000; i++) {
    const v = 120 + rand() * 40
    g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.6)`
    g.fillRect(X(-2) + rand() * 22 * m, Y(14) + rand() * 16 * m, 2, 2)
  }
  g.strokeStyle = 'rgba(235,235,225,0.85)'
  g.lineWidth = 0.12 * m
  for (const row of [-8, -20]) { // two rows of parking bays south of the site
    for (let x = -24; x <= 42; x += 2.5) {
      g.beginPath()
      g.moveTo(X(x), Y(row))
      g.lineTo(X(x), Y(row - 5))
      g.stroke()
    }
  }
  for (let y = -4; y <= 40; y += 2.5) { // and a row east of it, facing west
    g.beginPath()
    g.moveTo(X(34), Y(y))
    g.lineTo(X(39), Y(y))
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Grain and a soft vignette, like a phone camera frame. */
function finish(src: HTMLCanvasElement, rand: () => number): string {
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H })
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0, W, H)
  const img = g.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const r = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))
      const v = 1 - 0.18 * Math.max(0, r - 0.45) ** 2
      const n = (rand() - 0.5) * 10
      d[i] = d[i] * v + n
      d[i + 1] = d[i + 1] * v + n
      d[i + 2] = d[i + 2] * v + n
    }
  }
  g.putImageData(img, 0, 0)
  return c.toDataURL('image/jpeg', 0.88)
}

async function render(spec: Spec): Promise<void> {
  const project = await getProject(spec.project_id)
  const anchor = project.anchors.find((a) => a.anchor_id === spec.anchor_id)
  if (!anchor) throw new Error(`no anchor ${spec.anchor_id}`)
  const byName = new Map(project.elements.map((e) => [e.name, e]))
  const byGuid = new Map(project.elements.map((e) => [e.guid, e]))
  const model = await loadModel(project.model_url, new Set(byGuid.keys()))

  for (const mesh of model.meshes) {
    const e = byGuid.get(model.meshGuid.get(mesh)!)
    if (!e) continue
    mesh.material = materialFor(e)
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  const node = (name: string) => {
    const e = byName.get(name)
    const obj = e && model.byGuid.get(e.guid)
    if (!obj) throw new Error(`no element named ${name}`)
    return obj
  }
  for (const name of spec.hidden) node(name).visible = false
  for (const { name, d } of spec.shifted) node(name).position.add(new Vector3(d[0], d[2], -d[1])) // IFC -> glTF (x, z, -y)
  model.ifcRoot.updateMatrixWorld(true)

  const rand = rng(spec.sample_id)
  const scene = new Scene()
  scene.background = skyTexture()
  scene.fog = new Fog(new Color('#dfe8ef'), 70, 260)
  scene.add(model.ifcRoot)
  const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ map: groundTexture(rand), roughness: 1 }))
  ground.position.set(9, 6, -0.01)
  ground.receiveShadow = true
  const land = new Mesh(new PlaneGeometry(1200, 1200), new MeshStandardMaterial({ color: 0x55585a, roughness: 1 })) // to the horizon
  land.position.set(9, 6, -0.03)
  land.receiveShadow = true
  scene.add(ground, land)
  const far = new MeshStandardMaterial({ color: 0x9aa3ab, roughness: 1 })
  for (const [x, y, w, d, h] of [[-70, 60, 30, 20, 24], [40, 110, 40, 25, 36], [95, 20, 25, 40, 18], [-40, -90, 50, 20, 15], [90, -70, 30, 30, 28]]) {
    const b = new Mesh(new BoxGeometry(w, d, h), far)
    b.position.set(x, y, h / 2)
    scene.add(b)
  }
  scene.add(new HemisphereLight(0xcfe2ff, 0x5b544c, 1.3))
  const sun = new DirectionalLight(0xfff1dc, 3.2)
  sun.position.set(9 - 28, 6 - 36, 48)
  sun.target.position.set(9, 6, 0)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 })
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)

  const eye = spec.eye as Vec3
  const look = spec.look as [number, number]
  const camera = new PerspectiveCamera((2 * Math.atan(H / 2 / spec.f) * 180) / Math.PI, W / H, 0.1, 600)
  camera.up.set(0, 0, 1)
  camera.position.set(...eye)
  const p = (spec.pitch_deg * Math.PI) / 180
  const h = Math.hypot(...look)
  camera.lookAt(eye[0] + (Math.cos(p) * look[0]) / h, eye[1] + (Math.cos(p) * look[1]) / h, eye[2] + Math.sin(p))

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  document.body.append(renderer.domElement)
  renderer.render(scene, camera)

  const pose = samplePose(anchor, eye, look, spec.pitch_deg)
  const meta = {
    ...buildSampleMeta({ sample_id: spec.sample_id, label: spec.label, project_id: spec.project_id, anchor_id: spec.anchor_id },
      W, H, { f: spec.f, cx: W / 2, cy: H / 2 }, pose, new Date()),
    simulated: true,
    staged: [...spec.hidden.map((n) => ({ element: n, deviation: 'missing' })),
      ...spec.shifted.map((s) => ({ element: s.name, deviation: 'shifted', offset_m: s.d }))],
  }
  const out = Object.assign(document.createElement('script'), { type: 'application/json', id: 'sample-out' })
  out.textContent = JSON.stringify({ meta, photo: finish(renderer.domElement, rand) })
  document.body.append(out)
}

const id = new URLSearchParams(window.location.search).get('id')
const spec = specs.find((s) => s.sample_id === id)
const fail = (msg: string) => document.body.append(Object.assign(document.createElement('pre'), { id: 'sample-error', textContent: msg }))
if (!spec) fail(`unknown sample ${id}`)
else render(spec).catch((err: unknown) => fail(String(err)))
