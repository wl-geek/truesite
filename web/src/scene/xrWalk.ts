/**
 * Walk inside on Android: a WebXR immersive-ar session (ARCore world tracking) inside TrueSite.
 * Point at the floor, tap to place the model at 1:1 (its anchor spot under the reticle, its
 * "north" facing the way you look), then walk through it: ARCore keeps it still.
 */
import {
  DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, RingGeometry, Vector3, WebGLRenderer,
} from 'three'
import type { LoadedModel } from './loadModel'
import { buildWalkScene } from './walkthrough'

export async function xrArSupported(): Promise<boolean> {
  try {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))
  } catch {
    return false
  }
}

/** Yaw (about +Y) that turns the model's north (glTF -Z = IFC +Y) to the camera's horizontal facing direction. */
export function yawToFace(forwardX: number, forwardZ: number): number {
  return Math.atan2(-forwardX, -forwardZ)
}

export type XrWalkOptions = {
  model: LoadedModel
  classOf: (guid: string) => string
  centreIfc: [number, number]
  /** Element shown over the AR view (instructions, Exit). Must be in the document. */
  overlay: HTMLElement
  onPlaced: () => void
  onEnd: () => void
}

/** Starts the AR session (call from a tap). Resolves to a function that ends it. */
export async function startXrWalk(o: XrWalkOptions): Promise<() => void> {
  const xr = navigator.xr
  if (!xr) throw new Error('WebXR is not available')
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'local-floor'],
    domOverlay: { root: o.overlay },
  })

  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local')
  await renderer.xr.setSession(session)

  const scene = buildWalkScene(o.model, o.classOf, o.centreIfc) // Standard materials: add light
  scene.add(new HemisphereLight(0xffffff, 0x8899aa, 2.2))
  const sun = new DirectionalLight(0xffffff, 1.4)
  sun.position.set(3, 10, 4)
  scene.add(sun)
  const content = scene.children.find((c) => c instanceof Group) as Group
  const placed = new Group()
  scene.remove(content)
  placed.add(content)
  placed.visible = false
  scene.add(placed)

  const reticle = new Mesh(new RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xff6a13 }))
  reticle.matrixAutoUpdate = false
  reticle.visible = false
  scene.add(reticle)

  const viewerSpace = await session.requestReferenceSpace('viewer')
  const hitSource = await session.requestHitTestSource?.({ space: viewerSpace })
  const camera = renderer.xr.getCamera()
  const forward = new Vector3()

  session.addEventListener('select', () => {
    if (!reticle.visible) return
    placed.position.setFromMatrixPosition(reticle.matrix)
    camera.getWorldDirection(forward)
    placed.rotation.set(0, yawToFace(forward.x, forward.z), 0)
    placed.visible = true
    o.onPlaced()
  })

  renderer.setAnimationLoop((_t, frame) => {
    if (frame && hitSource) {
      const ref = renderer.xr.getReferenceSpace()
      const hit = ref ? frame.getHitTestResults(hitSource)[0]?.getPose(ref) : undefined
      reticle.visible = !!hit
      if (hit) reticle.matrix.fromArray(hit.transform.matrix)
    }
    renderer.render(scene, camera)
  })

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null)
    hitSource?.cancel()
    scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose()
        ;(Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose())
      }
    })
    renderer.dispose()
    o.onEnd()
  })

  return () => void session.end().catch(() => undefined)
}
