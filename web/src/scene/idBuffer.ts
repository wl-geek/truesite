/**
 * Off-screen renders of the model from a camera pose (spec 7.3):
 *   - renderIdBuffer: every element in a unique flat colour, read back to find which are visible;
 *   - renderDesignImage: an opaque, readable render of the design for Gemini (marks drawn later).
 * Both render layer 0 only (edges live on EDGE_LAYER) into an RGBA8 target with no MSAA, then
 * restore the model's materials, the camera's layers and the renderer's state.
 * Both judge what is shown: hidden layers (mesh.visible = false) stay out, and the view's cut-above
 * planes (look.clipPlanes(), updated at the snapshot pose) are applied to the override materials.
 */
import {
  Color, DoubleSide, Mesh, MeshBasicMaterial, NoToneMapping, RGBAFormat, UnsignedByteType, WebGLRenderTarget,
  type Camera, type Material, type Plane, type Scene, type WebGLRenderer,
} from 'three'
import { idColor } from './elements'
import type { LoadedModel } from './loadModel'

export type IdRender = { buf: Uint8Array; width: number; height: number; indexToGuid: string[] }

async function readTarget(renderer: WebGLRenderer, target: WebGLRenderTarget, w: number, h: number): Promise<Uint8Array> {
  const buf = new Uint8Array(w * h * 4)
  const r = renderer as WebGLRenderer & { readRenderTargetPixelsAsync?: WebGLRenderer['readRenderTargetPixels'] }
  // WebGL2 async readback where available; the sync call is the fallback (older Safari).
  if (typeof r.readRenderTargetPixelsAsync === 'function') await r.readRenderTargetPixelsAsync(target, 0, 0, w, h, buf)
  else renderer.readRenderTargetPixels(target, 0, 0, w, h, buf)
  return buf
}

async function renderWith(renderer: WebGLRenderer, scene: Scene, model: LoadedModel, camera: Camera, w: number, h: number,
  materialFor: (mesh: Mesh) => Material, clear: Color, clip: readonly Plane[]): Promise<Uint8Array> {
  const target = new WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat, samples: 0, depthBuffer: true })
  const originals = new Map<Mesh, Material | Material[]>()
  for (const mesh of model.meshes) {
    originals.set(mesh, mesh.material)
    mesh.material = materialFor(mesh)
  }
  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearColor(new Color())
  const prevAlpha = renderer.getClearAlpha()
  const prevToneMapping = renderer.toneMapping
  const prevLocalClipping = renderer.localClippingEnabled
  const prevMask = camera.layers.mask
  try {
    camera.layers.set(0)
    renderer.toneMapping = NoToneMapping
    if (clip.length) renderer.localClippingEnabled = true
    renderer.setRenderTarget(target)
    renderer.setClearColor(clear, 1)
    renderer.clear()
    renderer.render(scene, camera)
    return await readTarget(renderer, target, w, h)
  } finally {
    camera.layers.mask = prevMask
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevClear, prevAlpha)
    renderer.toneMapping = prevToneMapping
    renderer.localClippingEnabled = prevLocalClipping
    for (const [mesh, mat] of originals) mesh.material = mat
    target.dispose()
  }
}

/** Clipping planes for an override material: the view's cut, or none. */
const clipFor = (clip: readonly Plane[]) => (clip.length ? [...clip] : null)

/** Visible elements: index i in the colour buffer is indexToGuid[i] (one colour per GUID). */
export async function renderIdBuffer(renderer: WebGLRenderer, scene: Scene, model: LoadedModel, camera: Camera,
  width: number, height: number, clip: readonly Plane[] = []): Promise<IdRender> {
  const indexToGuid = [...new Set(model.meshes.map((m) => model.meshGuid.get(m)!))]
  const indexOf = new Map(indexToGuid.map((g, i) => [g, i]))
  const mats = indexToGuid.map((_, i) => new MeshBasicMaterial({ color: idColor(i), side: DoubleSide, clippingPlanes: clipFor(clip) }))
  try {
    const buf = await renderWith(renderer, scene, model, camera, width, height,
      (mesh) => mats[indexOf.get(model.meshGuid.get(mesh)!)!], new Color(0, 0, 0), clip)
    return { buf, width, height, indexToGuid }
  } finally {
    mats.forEach((m) => m.dispose())
  }
}

const DESIGN_COLOURS: [RegExp, number][] = [
  [/^IfcWall/, 0xc3d3e4],
  [/^Ifc(Column|Beam|Slab|Footing|Member|Pile|Plate)$/, 0x86a3c2],
  [/^Ifc(Door|Window)$/, 0xffb36b],
  [/^Ifc(Pipe|Duct|Flow|CableCarrier)/, 0xff6a13],
]

/** Render targets hold LINEAR colour; images need sRGB. 8-bit lookup of the sRGB transfer function. */
const LINEAR_TO_SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
})

/** An opaque render of the design (top-down RGBA rows) at the photo size, for Gemini's IMAGE 2. */
export async function renderDesignImage(renderer: WebGLRenderer, scene: Scene, model: LoadedModel, camera: Camera,
  width: number, height: number, classOf: (guid: string) => string, clip: readonly Plane[] = []): Promise<ImageData> {
  const cache = new Map<number, MeshBasicMaterial>()
  const material = (mesh: Mesh) => {
    const cls = classOf(model.meshGuid.get(mesh)!)
    const hex = DESIGN_COLOURS.find(([re]) => re.test(cls))?.[1] ?? 0xd9d9d9
    if (!cache.has(hex)) {
      cache.set(hex, new MeshBasicMaterial({ color: hex, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, clippingPlanes: clipFor(clip) }))
    }
    return cache.get(hex)!
  }
  try {
    const buf = await renderWith(renderer, scene, model, camera, width, height, material, new Color(0xf4f6f8), clip)
    const out = new ImageData(width, height)
    for (let row = 0; row < height; row++) {
      const src = (height - 1 - row) * width * 4 // GL rows are bottom-up
      const dst = row * width * 4
      for (let i = 0; i < width * 4; i += 4) {
        out.data[dst + i] = LINEAR_TO_SRGB[buf[src + i]]
        out.data[dst + i + 1] = LINEAR_TO_SRGB[buf[src + i + 1]]
        out.data[dst + i + 2] = LINEAR_TO_SRGB[buf[src + i + 2]]
        out.data[dst + i + 3] = 255
      }
    }
    return out
  } finally {
    cache.forEach((m) => m.dispose())
  }
}
