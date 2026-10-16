/**
 * Dev only (sample-studio.html, not in the build): renders one still photo of the simulated as-built site
 * (sim/world.ts + sim/asBuilt.ts, the same building the virtual site shows) for scripts/make-samples.mjs.
 * `?id=<sample_id>` picks a camera from scripts/sample-specs.json. The camera matches the stored K and pose
 * exactly, so the check's design render lines up with the photo.
 * The result goes into <script id="sample-out"> as JSON: { meta, photo (JPEG data URL) }.
 */
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, WebGLRenderer } from 'three'
import { getProject } from '../api/client'
import { buildSampleMeta } from '../check/sampleMeta'
import type { Vec3 } from '../pose'
import { loadModel } from '../scene/loadModel'
import { describeDeviation, SITE_AS_BUILT } from '../sim/asBuilt'
import { samplePose } from '../sim/samplePose'
import { buildWorld, makeAsBuilt, photoFinish, rng } from '../sim/world'
import specs from '../../scripts/sample-specs.json'

type Spec = (typeof specs)[number]
const W = 1280
const H = 720

function dataUrl(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(b)
  })
}

async function render(spec: Spec): Promise<void> {
  const project = await getProject(spec.project_id)
  const anchor = project.anchors.find((a) => a.anchor_id === spec.anchor_id)
  if (!anchor) throw new Error(`no anchor ${spec.anchor_id}`)
  const model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
  makeAsBuilt(model, project.elements, SITE_AS_BUILT)
  const scene = buildWorld(spec.project_id, project.anchors)
  scene.add(model.ifcRoot)

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
    staged: SITE_AS_BUILT.map(describeDeviation),
  }
  const photo = await dataUrl(await photoFinish(renderer.domElement, W, H, rng(spec.sample_id)))
  const out = Object.assign(document.createElement('script'), { type: 'application/json', id: 'sample-out' })
  out.textContent = JSON.stringify({ meta, photo })
  document.body.append(out)
}

const id = new URLSearchParams(window.location.search).get('id')
const spec = specs.find((s) => s.sample_id === id)
const fail = (msg: string) => document.body.append(Object.assign(document.createElement('pre'), { id: 'sample-error', textContent: msg }))
if (!spec) fail(`unknown sample ${id}`)
else render(spec).catch((err: unknown) => fail(String(err)))
