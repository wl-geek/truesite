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
    out.push({
      index, pixels: a.n, coverage,
      box: [
        Math.round((a.y0 / height) * 1000), Math.round((a.x0 / width) * 1000),
        Math.round(((a.y1 + 1) / height) * 1000), Math.round(((a.x1 + 1) / width) * 1000),
      ],
      centroid: { x: a.sx / a.n + 0.5, y: a.sy / a.n + 0.5 },
    })
  }
  return out.sort((p, q) => q.pixels - p.pixels)
}
