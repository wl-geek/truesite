/**
 * "Walk inside": hand the model to the phone's own world-tracked AR viewer, where it stays still
 * while you walk through it at 1:1 (QR-anchored browser AR has no position tracking on iPhone).
 *   iPhone/iPad: AR Quick Look (ARKit) with a USDZ exported in the browser.
 *   Android: Google Scene Viewer (ARCore) with the project's glb URL (needs a public HTTPS URL).
 * The model is recentred so its origin (where the viewer places it) is the anchor's spot, e.g. the
 * middle of the rooftop frame, and scaling is locked to 1:1.
 */
import { Group, Matrix4, Mesh, MeshStandardMaterial, Scene, type BufferGeometry } from 'three'
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js'
import type { LoadedModel } from './loadModel'

export function isAppleMobile(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints): boolean {
  return /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
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

function flatNormals(geometry: BufferGeometry): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  g.computeVertexNormals() // non-indexed -> one normal per face: crisp concrete edges
  return g
}

/** Standalone scene for export: copies of the model's meshes in glTF frame (Y-up metres), recentred. */
export function buildWalkScene(model: LoadedModel, classOf: (guid: string) => string, centreIfc: [number, number]): Scene {
  const concrete = new MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45 })
  const rebar = new MeshStandardMaterial({ color: 0xe0441b, roughness: 0.6, metalness: 0.2 })
  const other = new MeshStandardMaterial({ color: 0x4e7fb3, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45 })
  const root = new Group()
  root.position.set(...recentreOffset(...centreIfc))
  model.gltfScene.updateMatrixWorld(true)
  const toGltf = new Matrix4().copy(model.gltfScene.matrixWorld).invert()
  for (const mesh of model.meshes) {
    const cls = classOf(model.meshGuid.get(mesh) ?? '')
    const mat = cls === 'IfcReinforcingBar' ? rebar : /^Ifc(Column|Beam|Slab|Footing|Member|Pile|Plate)$/.test(cls) ? concrete : other
    const copy = new Mesh(flatNormals(mesh.geometry), mat)
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

/** Open AR Quick Look on a USDZ blob, locked to 1:1 (must run from a tap). */
export function openQuickLook(usdz: Blob): void {
  const a = document.createElement('a')
  a.rel = 'ar'
  a.href = `${URL.createObjectURL(usdz)}#allowsContentScaling=0`
  a.appendChild(document.createElement('img')) // Quick Look requires an <img> child
  document.body.appendChild(a)
  a.click()
  a.remove()
}
