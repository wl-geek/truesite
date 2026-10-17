import { describe, expect, it } from 'vitest'
import type { Point2 } from '../pose'
import { CornerStabilizer } from './cornerFilter'

const square = (x: number, y: number, s = 200): Point2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
/** A deterministic flicker of whole pixels, like the QR reader's corners on a still code. */
const flicker = (c: Point2[], i: number): Point2[] => c.map((p, k) => [p[0] + (((i + k) % 3) - 1), p[1] + (((i * 2 + k) % 3) - 1)] as Point2)

describe('CornerStabilizer', () => {
  it('averages the flicker of a still code down to a fraction of a pixel', () => {
    const f = new CornerStabilizer()
    const truth = square(800, 400)
    let out: Point2[] = []
    for (let i = 0; i < 60; i++) out = f.update(flicker(truth, i), i / 30, 0.5)
    const err = Math.max(...out.map((p, k) => Math.hypot(p[0] - truth[k][0], p[1] - truth[k][1])))
    expect(err).toBeLessThan(0.35)
  })

  it('follows a real move at once: a jump beyond the flicker resets to the new corners', () => {
    const f = new CornerStabilizer()
    for (let i = 0; i < 30; i++) f.update(flicker(square(800, 400), i), i / 30, 0.5)
    const moved = square(830, 400) // 30 px: the camera moved
    expect(f.update(moved, 1.01, 0.5)).toEqual(moved)
  })

  it('scales the still band with how coarse the read is (a whole frame read at 640 px: 3 video px per read px)', () => {
    const coarse = new CornerStabilizer()
    coarse.update(square(800, 400), 0, 1.5)
    expect(coarse.update(square(806, 400), 0.033, 1.5)).not.toEqual(square(806, 400)) // 6 px: flicker at this scale
    const fine = new CornerStabilizer()
    fine.update(square(800, 400), 0, 0.5)
    expect(fine.update(square(804, 400), 0.033, 0.5)).toEqual(square(804, 400)) // 4 px at camera resolution: a move
  })

  it('starts afresh after reset (a new code, new intrinsics)', () => {
    const f = new CornerStabilizer()
    f.update(square(800, 400), 0, 0.5)
    f.reset()
    expect(f.update(square(801, 401), 0.03, 0.5)).toEqual(square(801, 401))
  })
})
