/**
 * Orbit model viewer: its OWN PerspectiveCamera with OrbitControls (never the AR camera, whose
 * projection must not be recomputed), tap-to-pick through the element GUIDs, highlight, resize.
 * Pins and other overlays go under model.ifcRoot, which holds IFC coordinates. With element data the model is
 * coloured by type (palette.js), the same as the AR modes and Quick Look.
 */
import {
  Box3, DirectionalLight, DoubleSide, GridHelper, HemisphereLight, type Material, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { guidOf } from './elements'
import { releaseRenderer } from './glContext'
import { IFC_TO_THREE, type LoadedModel } from './loadModel'
import { materialParams, smoothShaded, type Kind, type Paint } from './palette'

export type PointerSample = { x: number; y: number; t: number }
type Rect = { left: number; top: number; width: number; height: number }

const TAP_MAX_MOVE_PX = 6
const TAP_MAX_MS = 500
const HIGHLIGHT = '#FF6A13' // brand orange
/** Direction the camera looks from in each preset (three.js world: Y up). */
const VIEWS = { iso: new Vector3(0.75, 0.9, 1), top: new Vector3(0, 1, 0.0001) } as const
export type ViewPreset = keyof typeof VIEWS
const XRAY_OPACITY = 0.14

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
  /** Look at the whole model from a preset direction. */
  setView(view: ViewPreset): void
  /** Bring the camera close to one element, keeping the current direction. */
  focus(guid: string): void
  /** Hide the elements of these colour-key kinds (they can't be picked either). */
  setHiddenKinds(hidden: ReadonlySet<Kind>): void
  /** See-through model; a selected element stays solid. */
  setXray(on: boolean): void
  /**
   * A panel covers this many pixels on the right or at the bottom: centre the view in the uncovered part, and frame
   * the model inside it. The view shifts; the camera doesn't move.
   */
  setInset(right: number, bottom: number): void
  /** Mouse hover (not touch): the element under the pointer, or null. Returns an unsubscribe function. */
  onHover(cb: (guid: string | null, clientX: number, clientY: number) => void): () => void
  resize(): void
  dispose(): void
}

export function createViewer(canvas: HTMLCanvasElement, model: LoadedModel, paintOf?: (guid: string) => Paint | undefined): Viewer {
  // Transparent: the page draws the sky behind the canvas (.viewer-stage).
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  scene.add(new HemisphereLight(0xffffff, 0x8a9bb0, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.position.set(4, 10, 6)
  scene.add(sun)

  const restoreColours = paintOf ? applyTypeColours(model, paintOf) : () => undefined
  model.ifcRoot.matrix.copy(IFC_TO_THREE)
  scene.add(model.ifcRoot)
  scene.updateMatrixWorld(true)

  // A metre grid on the ground under the model, a little wider than its footprint: scale at a glance.
  const modelBox = new Box3().setFromObject(model.ifcRoot)
  const modelSize = modelBox.getSize(new Vector3())
  const gridSize = Math.max(4, Math.ceil(Math.max(modelSize.x, modelSize.z) * 1.6 / 2) * 2)
  const grid = new GridHelper(gridSize, gridSize, 0xa9b8c8, 0xcfd9e3)
  grid.position.set(modelBox.getCenter(new Vector3()).x, modelBox.isEmpty() ? 0 : modelBox.min.y - 0.002, modelBox.getCenter(new Vector3()).z)
  for (const m of [grid.material].flat()) Object.assign(m, { transparent: true, opacity: 0.7, depthWrite: false })
  scene.add(grid)
  const kindOfMesh = new Map<Mesh, Kind>()
  if (paintOf) for (const mesh of model.meshes) { const p = paintOf(model.meshGuid.get(mesh) ?? ''); if (p) kindOfMesh.set(mesh, p.kind) }
  const xray = new Map<MeshStandardMaterial, { transparent: boolean; opacity: number; depthWrite: boolean }>()

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
    const hit = raycaster.intersectObjects(model.meshes.filter((m) => m.visible), false)[0] // hidden types can't be picked
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

  let view: ViewPreset = 'iso'
  let inset = { right: 0, bottom: 0 }
  /**
   * The projection for the canvas and the inset: a virtual image larger by the inset, of which the canvas shows the
   * part that puts the image centre in the middle of the uncovered area (PerspectiveCamera.setViewOffset).
   */
  function applyProjection(): void {
    const w = Math.max(canvas.clientWidth, 1)
    const h = Math.max(canvas.clientHeight, 1)
    const right = Math.min(inset.right, w * 0.6)
    const bottom = Math.min(inset.bottom, h * 0.7)
    camera.aspect = (w + right) / (h + bottom)
    if (right || bottom) camera.setViewOffset(w + right, h + bottom, right, bottom, w, h)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix() // fine for this orbit camera; never for the AR camera
  }
  /** Distance that fits a sphere in the uncovered part of the view. */
  function fitDistance(radius: number): number {
    const w = Math.max(canvas.clientWidth, 1)
    const h = Math.max(canvas.clientHeight, 1)
    const right = Math.min(inset.right, w * 0.6)
    const bottom = Math.min(inset.bottom, h * 0.7)
    const tanV = Math.tan((camera.fov * Math.PI) / 360)
    const halfV = Math.atan((tanV * (h - bottom)) / (h + bottom))
    const halfH = Math.atan((tanV * camera.aspect * (w - right)) / (w + right))
    return radius / Math.sin(Math.min(halfV, halfH))
  }
  /** Frame a box from `dir` (default: the current preset), at a distance that fits it. */
  function frameBox(box: Box3, dir: Vector3 = VIEWS[view], minRadius = 0.5): void {
    if (box.isEmpty()) return
    const centre = box.getCenter(new Vector3())
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, minRadius)
    const distance = fitDistance(radius)
    camera.position.copy(centre).add(dir.clone().normalize().multiplyScalar(distance))
    camera.near = distance / 100
    camera.far = distance * 40
    applyProjection()
    controls.target.copy(centre)
    controls.update()
  }

  function frame(): void {
    frameBox(new Box3().setFromObject(model.ifcRoot))
    userMoved = false
  }

  function setView(next: ViewPreset): void {
    view = next
    frame()
  }

  function focus(guid: string): void {
    const box = new Box3()
    for (const mesh of model.meshes) if (model.meshGuid.get(mesh) === guid) box.expandByObject(mesh)
    const dir = camera.position.clone().sub(controls.target)
    frameBox(box, dir.lengthSq() > 0 ? dir : VIEWS[view], 1.2) // a little room around small parts
    userMoved = true
  }

  function setHiddenKinds(hidden: ReadonlySet<Kind>): void {
    for (const [mesh, kind] of kindOfMesh) mesh.visible = !hidden.has(kind)
  }

  function setXray(on: boolean): void {
    for (const mesh of model.meshes) {
      const mat = mesh.material
      if (!(mat instanceof MeshStandardMaterial) || mat === highlightMaterial) continue
      if (on && !xray.has(mat)) {
        xray.set(mat, { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite })
        Object.assign(mat, { transparent: true, opacity: Math.min(mat.opacity, XRAY_OPACITY), depthWrite: false })
        mat.needsUpdate = true
      }
    }
    if (!on) {
      for (const [mat, was] of xray) { Object.assign(mat, was); mat.needsUpdate = true }
      xray.clear()
    }
  }

  function resize(): void {
    const w = Math.max(canvas.clientWidth, 1)
    const h = Math.max(canvas.clientHeight, 1)
    renderer.setSize(w, h, false)
    applyProjection()
    if (!userMoved) frame()
  }

  function setInset(right: number, bottom: number): void {
    if (right === inset.right && bottom === inset.bottom) return
    inset = { right, bottom }
    applyProjection()
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

  // Hover with a mouse: one pick per frame at most, never while dragging.
  const hoverListeners = new Set<(guid: string | null, x: number, y: number) => void>()
  let hoverQueued: PointerEvent | null = null
  let hoverFrame = 0
  let hovered: string | null = null
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0 || !hoverListeners.size) return
    hoverQueued = e
    if (hoverFrame) return
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0
      const ev = hoverQueued
      if (!ev) return
      const guid = pick(ev.clientX, ev.clientY)
      canvas.style.cursor = guid ? 'pointer' : ''
      if (guid !== hovered || guid) hoverListeners.forEach((cb) => cb(guid, ev.clientX, ev.clientY))
      hovered = guid
    })
  }
  const onPointerLeave = () => {
    canvas.style.cursor = ''
    hovered = null
    hoverListeners.forEach((cb) => cb(null, 0, 0))
  }
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize() // also frames the model
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })

  return {
    renderer, scene, camera, controls, model, pick, highlight, frame, resize, setView, focus, setHiddenKinds, setXray, setInset,
    onPick(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onHover(cb) {
      hoverListeners.add(cb)
      return () => hoverListeners.delete(cb)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.removeEventListener('start', onControlsStart)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      if (hoverFrame) cancelAnimationFrame(hoverFrame)
      setXray(false)
      setHiddenKinds(new Set())
      highlight(null)
      scene.remove(grid)
      grid.geometry.dispose()
      for (const m of [grid.material].flat()) m.dispose()
      highlightMaterial.dispose()
      restoreColours()
      controls.dispose()
      scene.remove(model.ifcRoot) // the model outlives the viewer (React StrictMode re-mounts)
      releaseRenderer(renderer)
    },
  }
}
