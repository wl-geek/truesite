/**
 * Orbit model viewer: its OWN PerspectiveCamera with OrbitControls (never the AR camera, whose
 * projection must not be recomputed), tap-to-pick through the element GUIDs, highlight, resize.
 * Pins and other overlays go under model.ifcRoot, which holds IFC coordinates. With element data the model is
 * coloured by type (palette.js), the same as the AR modes and Quick Look.
 */
import {
  Box3, Color, DirectionalLight, DoubleSide, HemisphereLight, type Material, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { guidOf } from './elements'
import { IFC_TO_THREE, type LoadedModel } from './loadModel'
import { materialParams, smoothShaded, type Paint } from './palette'

export type PointerSample = { x: number; y: number; t: number }
type Rect = { left: number; top: number; width: number; height: number }

const TAP_MAX_MOVE_PX = 6
const TAP_MAX_MS = 500
const BACKGROUND = '#E9EEF4'
const HIGHLIGHT = '#FF6A13' // brand orange

export function pointerToNdc(clientX: number, clientY: number, rect: Rect): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((clientY - rect.top) / rect.height) * 2,
  }
}

export function isTap(down: PointerSample, up: PointerSample): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MAX_MOVE_PX && up.t - down.t <= TAP_MAX_MS
}

/**
 * Camera distance that fits a sphere of `radius` in the view: the narrower of the vertical field of view
 * (`vfovDeg`) and the horizontal one, which is narrower on portrait phones (aspect = width / height < 1).
 */
export function frameDistance(radius: number, vfovDeg: number, aspect: number): number {
  const halfV = (vfovDeg * Math.PI) / 360
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  return radius / Math.sin(Math.min(halfV, halfH))
}

/**
 * Colour by element type: each mesh whose element paintOf knows gets its kind's material (solid steel and rebar,
 * see-through concrete). Returns a function that puts the glb's own materials back.
 */
export function applyTypeColours(model: LoadedModel, paintOf: (guid: string) => Paint | undefined): () => void {
  const originals = new Map<Mesh, Material | Material[]>()
  const mats = new Map<string, MeshStandardMaterial>()
  for (const mesh of model.meshes) {
    const p = paintOf(model.meshGuid.get(mesh) ?? '')
    if (!p) continue
    const key = `${p.kind}/${p.solid}`
    if (!mats.has(key)) mats.set(key, new MeshStandardMaterial({ ...materialParams(p), flatShading: !smoothShaded(p.kind), side: DoubleSide }))
    originals.set(mesh, mesh.material)
    mesh.material = mats.get(key)!
  }
  return () => {
    for (const [mesh, mat] of originals) mesh.material = mat
    for (const m of mats.values()) m.dispose()
  }
}

export type Viewer = {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  readonly model: LoadedModel
  /** GUID of the element under a client-space point, or null. */
  pick(clientX: number, clientY: number): string | null
  /** Called with the tapped element's GUID (null for empty space). Returns an unsubscribe function. */
  onPick(cb: (guid: string | null) => void): () => void
  highlight(guid: string | null): void
  /** Point the camera at the whole model; it is framed again on resize until the user moves the camera. */
  frame(): void
  resize(): void
  dispose(): void
}

export function createViewer(canvas: HTMLCanvasElement, model: LoadedModel, paintOf?: (guid: string) => Paint | undefined): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)
  scene.add(new HemisphereLight(0xffffff, 0x8a9bb0, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.position.set(4, 10, 6)
  scene.add(sun)

  const restoreColours = paintOf ? applyTypeColours(model, paintOf) : () => undefined
  model.ifcRoot.matrix.copy(IFC_TO_THREE)
  scene.add(model.ifcRoot)
  scene.updateMatrixWorld(true)

  const camera = new PerspectiveCamera(50, 1, 0.05, 500)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  // Reframe on resize (rotation, address bar, panel) until the user orbits, pans or zooms.
  let userMoved = false
  const onControlsStart = () => { userMoved = true }
  controls.addEventListener('start', onControlsStart)

  const raycaster = new Raycaster()
  const listeners = new Set<(guid: string | null) => void>()
  const highlightMaterial = new MeshStandardMaterial({
    color: HIGHLIGHT, emissive: HIGHLIGHT, emissiveIntensity: 0.35, roughness: 0.7, metalness: 0,
    flatShading: true, side: DoubleSide,
  })
  const original = new Map<Mesh, Material | Material[]>()

  function pick(clientX: number, clientY: number): string | null {
    const ndc = pointerToNdc(clientX, clientY, canvas.getBoundingClientRect())
    raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
    const hit = raycaster.intersectObjects(model.meshes, false)[0]
    if (!hit) return null
    return model.meshGuid.get(hit.object as Mesh) ?? guidOf(hit.object)
  }

  function highlight(guid: string | null): void {
    for (const [mesh, mat] of original) mesh.material = mat
    original.clear()
    if (!guid) return
    for (const mesh of model.meshes) {
      if (model.meshGuid.get(mesh) !== guid) continue
      original.set(mesh, mesh.material)
      mesh.material = highlightMaterial
    }
  }

  function frame(): void {
    const box = new Box3().setFromObject(model.ifcRoot)
    if (box.isEmpty()) return
    const centre = box.getCenter(new Vector3())
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5)
    const distance = frameDistance(radius, camera.fov, camera.aspect)
    camera.position.copy(centre).add(new Vector3(0.75, 0.9, 1).normalize().multiplyScalar(distance))
    camera.near = distance / 100
    camera.far = distance * 20
    camera.updateProjectionMatrix() // fine for this orbit camera; never for the AR camera
    controls.target.copy(centre)
    controls.update()
    userMoved = false
  }

  function resize(): void {
    const w = Math.max(canvas.clientWidth, 1)
    const h = Math.max(canvas.clientHeight, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (!userMoved) frame()
  }

  let down: PointerSample | null = null
  const onPointerDown = (e: PointerEvent) => {
    down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null
  }
  const onPointerUp = (e: PointerEvent) => {
    if (!down || !e.isPrimary) return
    const tap = isTap(down, { x: e.clientX, y: e.clientY, t: performance.now() })
    down = null
    if (!tap) return
    const guid = pick(e.clientX, e.clientY)
    listeners.forEach((cb) => cb(guid))
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize() // also frames the model
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  return {
    renderer, scene, camera, controls, model, pick, highlight, frame, resize,
    onPick(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.removeEventListener('start', onControlsStart)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      highlight(null)
      highlightMaterial.dispose()
      restoreColours()
      controls.dispose()
      scene.remove(model.ifcRoot) // the model outlives the viewer (React StrictMode re-mounts)
      renderer.dispose()
    },
  }
}
