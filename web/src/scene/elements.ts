import { Color, LinearSRGBColorSpace, type Object3D } from 'three'

/** IFC GlobalId: 22 chars of the IFC base-64 alphabet 0-9 A-Z a-z _ $ */
export const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/

/**
 * Nearest ancestor (or self) whose glTF node name is a known element GUID.
 * GLTFLoader keeps the raw glTF name in `userData.name` and puts a sanitised,
 * de-duplicated version in `.name` (duplicates get "_1", "_2" suffixes), so
 * match on userData.name first.
 */
export function guidOf(obj: Object3D | null, known?: ReadonlySet<string>): string | null {
  for (let o = obj; o; o = o.parent) {
    for (const n of [o.userData?.name as string | undefined, o.name]) {
      if (n && IFC_GUID_RE.test(n) && (!known || known.has(n))) return n
    }
  }
  return null
}

/**
 * ID-buffer colour for element index i (0-based). Index 0 maps to RGB (0,0,1) so
 * pure black (0,0,0) stays "background". Up to 2^24 - 1 elements.
 *
 * Render targets receive colours in the LINEAR working colour space (three r152+),
 * so set the colour with setRGB(..., LinearSRGBColorSpace) — NOT setHex(), which
 * treats the value as sRGB and converts it, changing the bytes read back.
 */
export function idColor(i: number, target = new Color()): Color {
  const v = i + 1
  return target.setRGB(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, LinearSRGBColorSpace)
}

/** Inverse of idColor on bytes read back from an RGBA8 render target. -1 = background. */
export function decodeId(r: number, g: number, b: number): number {
  return ((r << 16) | (g << 8) | b) - 1
}

export interface VisibleElement {
  index: number
  pixels: number
  /** share of the frame, 0..1 */
  coverage: number
  /** [ymin, xmin, ymax, xmax] normalised 0..1000, image rows top-down (Gemini convention) */
  box: [number, number, number, number]
  /** centroid in image px, top-down */
  centroid: { x: number; y: number }
  /**
   * Where the element's mark goes, in image px, top-down: the centroid when that pixel is the element's own,
   * else the element's pixel furthest from the region's edge (a U shape, or a region split by an occluder).
   */
  anchor: { x: number; y: number }
}

/**
 * The pixel of element `index` furthest from any other pixel (other elements, background, the frame edge),
 * as a pixel centre; ties go to the one nearest (cx, cy). Chamfer 3-4 distance over the region's bounding box.
 */
function interiorAnchor(buf: Uint8Array, width: number, height: number, index: number,
  box: { x0: number; y0: number; x1: number; y1: number }, cx: number, cy: number): { x: number; y: number } {
  const w = box.x1 - box.x0 + 3 // one empty cell of padding on each side
  const h = box.y1 - box.y0 + 3
  const d = new Int32Array(w * h)
  for (let j = 1; j < h - 1; j++) {
    const y = box.y0 + j - 1
    for (let i = 1; i < w - 1; i++) {
      const o = ((height - 1 - y) * width + box.x0 + i - 1) * 4 // GL rows are bottom-up
      if (decodeId(buf[o], buf[o + 1], buf[o + 2]) === index) d[j * w + i] = 1 << 30
    }
  }
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = j * w + i
    if (d[k]) d[k] = Math.min(d[k], d[k - 1] + 3, d[k - w] + 3, d[k - w - 1] + 4, d[k - w + 1] + 4)
  }
  let best = { x: cx, y: cy }
  let bestD = -1
  let bestR = Infinity
  for (let j = h - 2; j >= 1; j--) for (let i = w - 2; i >= 1; i--) {
    const k = j * w + i
    if (!d[k]) continue
    d[k] = Math.min(d[k], d[k + 1] + 3, d[k + w] + 3, d[k + w + 1] + 4, d[k + w - 1] + 4)
    const x = box.x0 + i - 1 + 0.5
    const y = box.y0 + j - 1 + 0.5
    const r = (x - cx) ** 2 + (y - cy) ** 2
    if (d[k] > bestD || (d[k] === bestD && r < bestR)) {
      best = { x, y }
      bestD = d[k]
      bestR = r
    }
  }
  return best
}

/**
 * Count ID pixels from WebGLRenderer.readRenderTargetPixels output.
 * GL readPixels returns rows BOTTOM-UP (row 0 = bottom of the image); this flips
 * to top-down image coordinates.
 */
export function visibleFromIdBuffer(buf: Uint8Array, width: number, height: number, minCoverage = 0.0005): VisibleElement[] {
  const acc = new Map<number, { n: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }>()
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row
    for (let x = 0; x < width; x++) {
      const o = (row * width + x) * 4
      const id = decodeId(buf[o], buf[o + 1], buf[o + 2])
      if (id < 0) continue
      let a = acc.get(id)
      if (!a) { a = { n: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0 }; acc.set(id, a) }
      a.n++; a.sx += x; a.sy += y
      if (x < a.x0) a.x0 = x
      if (x > a.x1) a.x1 = x
      if (y < a.y0) a.y0 = y
      if (y > a.y1) a.y1 = y
    }
  }
  const total = width * height
  const out: VisibleElement[] = []
  for (const [index, a] of acc) {
    const coverage = a.n / total
    if (coverage < minCoverage) continue
    const centroid = { x: a.sx / a.n + 0.5, y: a.sy / a.n + 0.5 }
    const o = ((height - 1 - Math.floor(centroid.y)) * width + Math.floor(centroid.x)) * 4
    const anchor = decodeId(buf[o], buf[o + 1], buf[o + 2]) === index
      ? { ...centroid }
      : interiorAnchor(buf, width, height, index, a, centroid.x, centroid.y)
    out.push({
      index, pixels: a.n, coverage,
      box: [
        Math.round((a.y0 / height) * 1000), Math.round((a.x0 / width) * 1000),
        Math.round(((a.y1 + 1) / height) * 1000), Math.round(((a.x1 + 1) / width) * 1000),
      ],
      centroid, anchor,
    })
  }
  return out.sort((p, q) => q.pixels - p.pixels)
}
