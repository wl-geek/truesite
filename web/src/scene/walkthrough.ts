/**
 * "Walk inside": hand the model to the phone's own world-tracked AR viewer, where it stays still
 * while you walk through it at 1:1 (QR-anchored browser AR has no position tracking on iPhone).
 *   iPhone/iPad: AR Quick Look (ARKit) with a USDZ exported in the browser.
 *   Android: Google Scene Viewer (ARCore) with the project's glb URL (needs a public HTTPS URL).
 * The model is recentred so its origin (where the viewer places it) is the anchor's spot, e.g. the
 * middle of the rooftop frame, and scaling is locked to 1:1. Colours by element type come from palette.js,
 * the same as the build-time file (scripts/make-usdz.mjs) and the AR look.
 */
import { Group, Matrix4, Mesh, MeshStandardMaterial, Scene, type BufferGeometry } from 'three'
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js'
import type { LoadedModel } from './loadModel'
import { kindOf, isSolid, materialParams, smoothShaded, type Paint } from './palette'
import { usdzFile } from './usdzVariants'

export function isAppleMobile(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): boolean {
  return /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
}

/** "iPad" or "iPhone", for the Walk inside coaching (iPadOS Safari reports a Mac with touch). */
export function appleDeviceName(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): 'iPad' | 'iPhone' {
  return /iPad/.test(ua) || (platform === 'MacIntel' && touchPoints > 1) ? 'iPad' : 'iPhone'
}

export function isAndroid(ua = navigator.userAgent): boolean {
  return /Android/i.test(ua)
}

export function canQuickLook(): boolean {
  const a = document.createElement('a')
  return a.relList?.supports?.('ar') ?? false
}

/** glTF (Y-up) offset that moves IFC point (x, y) on the floor to the origin: glTF = (X, Z, -Y). */
export function recentreOffset(ifcX: number, ifcY: number): [number, number, number] {
  return [-ifcX, 0, ifcY]
}

/** Google Scene Viewer intent for a public glb, fixed 1:1 scale, AR only. */
export function sceneViewerUrl(glbUrl: string, title: string, fallbackUrl: string): string {
  const params = new URLSearchParams({ file: glbUrl, mode: 'ar_only', resizable: 'false', title })
  return `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}#Intent;scheme=https;package=com.google.ar.core;` +
    `action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end;`
}

function withNormals(geometry: BufferGeometry, smooth: boolean): BufferGeometry {
  // Boxy concrete: non-indexed -> one normal per face, crisp edges. Round rebar: indexed + smooth, smaller.
  const g = smooth || !geometry.index ? geometry.clone() : geometry.toNonIndexed()
  g.computeVertexNormals()
  return g
}

/**
 * Standalone scene for export: copies of the model's meshes in glTF frame (Y-up metres), recentred. paintOf gives
 * an element's kind from its elements.json row; without it the kind comes from the class alone.
 */
export function buildWalkScene(model: LoadedModel, classOf: (guid: string) => string, centreIfc: [number, number],
  paintOf?: (guid: string) => Paint | undefined): Scene {
  const mats = new Map<string, MeshStandardMaterial>()
  const materialFor = (p: Paint) => {
    const key = `${p.kind}/${p.solid}`
    if (!mats.has(key)) mats.set(key, new MeshStandardMaterial(materialParams(p)))
    return mats.get(key)!
  }
  const root = new Group()
  root.position.set(...recentreOffset(...centreIfc))
  model.gltfScene.updateMatrixWorld(true)
  const toGltf = new Matrix4().copy(model.gltfScene.matrixWorld).invert()
  for (const mesh of model.meshes) {
    const guid = model.meshGuid.get(mesh) ?? ''
    const paint = paintOf?.(guid) ?? (() => { const kind = kindOf(classOf(guid)); return { kind, solid: isSolid(kind) } })()
    const copy = new Mesh(withNormals(mesh.geometry, smoothShaded(paint.kind)), materialFor(paint))
    copy.applyMatrix4(new Matrix4().multiplyMatrices(toGltf, mesh.matrixWorld))
    root.add(copy)
  }
  const scene = new Scene()
  scene.add(root)
  return scene
}

export async function exportUsdz(scene: Scene): Promise<Blob> {
  const data = await new USDZExporter().parseAsync(scene, {
    quickLookCompatible: true,
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  })
  return new Blob([data], { type: 'model/vnd.usdz+zip' })
}

/** The build-time USDZ for a project (scripts/make-usdz.mjs), or its distance variant, served with the right MIME type. */
export function usdzUrl(projectId: string, radius: number | null = null): string {
  return `/models/${encodeURIComponent(usdzFile(projectId, radius))}`
}

/** Open AR Quick Look on a USDZ file URL or blob, locked to 1:1 (must run from a tap). */
export function openQuickLook(usdz: Blob | string): void {
  const a = document.createElement('a')
  a.rel = 'ar'
  a.href = `${typeof usdz === 'string' ? usdz : URL.createObjectURL(usdz)}#allowsContentScaling=0`
  a.appendChild(document.createElement('img')) // Quick Look requires an <img> child
  document.body.appendChild(a)
  a.click()
  a.remove()
}
