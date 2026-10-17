/**
 * IMAGE 3 of the as-built check: the photo with a thin ring drawn just outside where each marked element should be.
 * Gemini then judges each element at its own outline (an empty ring is missing, an element beside its ring is
 * misplaced) instead of matching two separate pictures, which misses offsets and mixes up rows of identical members.
 */
import { decodeId } from '../scene/elements'

/** Magenta: rare on a building site, so a ring never reads as part of the build. */
export const RING_COLOUR: readonly [number, number, number] = [255, 0, 255]

/**
 * Ring geometry in pixels for an image `width` wide: a 5-6 px gap outside the element, then a 2-3 px line. The gap keeps
 * a thin member (a 3 px brace) visible as a bar between its lines after Gemini scales the image down; with a 1 px gap,
 * ring and member blurred into one streak and an empty ring looked like a full one (live, 17 Oct).
 */
export function ringSize(width: number): { gap: number; line: number } {
  return { gap: Math.max(3, Math.round(width / 250)), line: Math.max(2, Math.round(width / 600)) }
}

/**
 * The ring pixels around each element in `ringed` (ID-buffer indices), as a top-down mask the size of the buffer:
 * more than `gap` and at most `gap + line` pixels outside the element, never on a pixel of a ringed element, so one
 * ring can't hide another element. (Closed rings that crossed neighbours cluttered busy views and found less: 8 of 16
 * planted defects against 12 of 16, live, 17 Oct.) `buf` is RGBA from readRenderTargetPixels (GL rows bottom-up).
 * Chamfer 3-4 distance, in each element's box padded by the ring.
 */
export function ringMask(buf: Uint8Array, width: number, height: number, ringed: ReadonlySet<number>, gap: number, line: number): Uint8Array {
  const ids = new Int32Array(width * height)
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>()
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row // GL rows are bottom-up
    for (let x = 0; x < width; x++) {
      const o = (row * width + x) * 4
      const id = decodeId(buf[o], buf[o + 1], buf[o + 2])
      ids[y * width + x] = id
      if (!ringed.has(id)) continue
      const b = boxes.get(id)
      if (!b) boxes.set(id, { x0: x, y0: y, x1: x, y1: y })
      else {
        if (x < b.x0) b.x0 = x
        if (x > b.x1) b.x1 = x
        if (y < b.y0) b.y0 = y
        if (y > b.y1) b.y1 = y
      }
    }
  }
  const mask = new Uint8Array(width * height)
  const pad = gap + line + 1
  const inner = 3 * gap
  const outer = 3 * (gap + line)
  for (const [index, b] of boxes) {
    const x0 = Math.max(0, b.x0 - pad)
    const y0 = Math.max(0, b.y0 - pad)
    const w = Math.min(width - 1, b.x1 + pad) - x0 + 1
    const h = Math.min(height - 1, b.y1 + pad) - y0 + 1
    const d = new Int32Array(w * h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = ids[(y0 + j) * width + x0 + i] === index ? 0 : 1 << 29
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i
      if (!d[k]) continue
      let v = d[k]
      if (i > 0) v = Math.min(v, d[k - 1] + 3)
      if (j > 0) {
        v = Math.min(v, d[k - w] + 3)
        if (i > 0) v = Math.min(v, d[k - w - 1] + 4)
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + 4)
      }
      d[k] = v
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i
      if (!d[k]) continue
      let v = d[k]
      if (i < w - 1) v = Math.min(v, d[k + 1] + 3)
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + 3)
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + 4)
        if (i > 0) v = Math.min(v, d[k + w - 1] + 4)
      }
      d[k] = v
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = d[j * w + i]
      const p = (y0 + j) * width + x0 + i
      if (v > inner && v <= outer && !ringed.has(ids[p])) mask[p] = 1
    }
  }
  return mask
}

/** Paint the mask's pixels into a top-down RGBA image of the same size. */
export function paintMask(img: ImageData, mask: Uint8Array, [r, g, b]: readonly [number, number, number] = RING_COLOUR): void {
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const o = p * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    img.data[o + 3] = 255
  }
}
