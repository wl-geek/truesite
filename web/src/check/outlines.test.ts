import { describe, expect, it } from 'vitest'
import { ringMask, ringSize } from './outlines'

/** An RGBA ID buffer with GL rows bottom-up, from a top-down id function (-1 = background). */
function idBuffer(width: number, height: number, idAt: (x: number, y: number) => number): Uint8Array {
  const buf = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = idAt(x, y) + 1
    const o = ((height - 1 - y) * width + x) * 4
    buf.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], o)
  }
  return buf
}

const inBox = (x: number, y: number, [x0, y0, x1, y1]: number[]) => x >= x0 && x <= x1 && y >= y0 && y <= y1

describe('ringMask', () => {
  // Element 0 is a 4 x 4 square at x 8-11, y 4-7 (top-down) in a 20 x 20 frame.
  const W = 20
  const at = (mask: Uint8Array, x: number, y: number) => mask[y * W + x]

  it('draws a ring a gap away from the element, in top-down rows, and nothing inside it', () => {
    const mask = ringMask(idBuffer(W, W, (x, y) => (inBox(x, y, [8, 4, 11, 7]) ? 0 : -1)), W, W, new Set([0]), 1, 2)
    expect([12, 13, 14, 15].map((x) => at(mask, x, 5))).toEqual([0, 1, 1, 0]) // 1 px gap, then 2 px of ring
    expect([3, 2, 1, 0].map((y) => at(mask, 9, y))).toEqual([0, 1, 1, 0]) // above the square: rows are top-down
    expect(at(mask, 9, 5)).toBe(0)
  })

  it('never paints over another ringed element, but may cross an unringed one', () => {
    const buf = idBuffer(W, W, (x, y) => (inBox(x, y, [8, 4, 11, 7]) ? 0 : inBox(x, y, [13, 4, 15, 7]) ? 1 : -1))
    const both = ringMask(buf, W, W, new Set([0, 1]), 1, 2)
    expect(at(both, 13, 5)).toBe(0) // element 1's pixel stays clear
    expect(at(both, 18, 5)).toBe(1) // element 1 has its own ring
    const one = ringMask(buf, W, W, new Set([0]), 1, 2)
    expect(at(one, 13, 5)).toBe(1) // element 1 isn't ringed: element 0's ring crosses it
    expect(at(one, 18, 5)).toBe(0)
  })

  it('scales with the image', () => {
    expect(ringSize(1280)).toEqual({ gap: 5, line: 2 })
    expect(ringSize(1600)).toEqual({ gap: 6, line: 3 })
  })
})
