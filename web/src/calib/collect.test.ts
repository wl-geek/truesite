import { describe, expect, it } from 'vitest'
import { centredIntrinsics, type Point2 } from '../pose'
import { insideImage, makeMarkerPose, noisyCorners, randomViewDir, rng, uniform } from '../pose/testing/synth'
import { MIN_TILT_DEG, scaleFactorFromBar, TARGET_VIEWS, ViewCollector } from './collect'

const W = 1280, H = 720, S = 0.23

function view(K: ReturnType<typeof centredIntrinsics>, r: () => number, tiltDeg: number, centred = false): Point2[] | null {
  const dir = centred ? ([0, 0, 1] as [number, number, number]) : randomViewDir(r, K, W, H, 200)
  const pose = makeMarkerPose({ distance: uniform(r, 0.6, 1.2), tiltDeg, tiltAzDeg: uniform(r, 0, 360), rollDeg: uniform(r, -180, 180), dir })
  const c = noisyCorners(K, pose, S, 0.5, r)
  return c && insideImage(c, W, H, 5) ? c : null
}

describe('calibration view collector', () => {
  it('rejects head-on views and near-duplicates', () => {
    const K = centredIntrinsics(1000, W, H)
    const c = new ViewCollector(S, W, H)
    const flat = view(K, rng(1), 3, true)!
    expect(c.offer(flat)).toBe('flat')
    const tilted = view(K, rng(2), 35)!
    expect(c.offer(tilted)).toBe('accepted')
    expect(c.offer(tilted.map(([x, y]) => [x + 2, y + 1] as Point2))).toBe('duplicate')
    expect(c.offer([[0, 0], [1, 1], [2, 2], [3, 3]])).toBe('invalid')
    expect(MIN_TILT_DEG).toBe(15)
  })

  it('recovers the focal length within 3% from 30 tilted views, then reports full', () => {
    const K = centredIntrinsics(1100, W, H) // the 63 degree prior is ~1045 px: about 5% off
    const c = new ViewCollector(S, W, H)
    const r = rng(7)
    while (!c.done) {
      const v = view(K, r, uniform(r, 20, 55))
      if (v) c.offer(v)
    }
    expect(c.views).toHaveLength(TARGET_VIEWS)
    const res = c.solve()!
    expect(Math.abs(res.f - 1100) / 1100).toBeLessThan(0.03)
    expect(c.offer(view(K, r, 30) ?? [[0, 0], [1, 0], [1, 1], [0, 1]])).toBe('full')
  })

  it('gates portrait views with the long-side prior, so a 20 degree tilt is not called flat', () => {
    // Portrait frames arrive rotated (1080 x 1920). With a short-side prior (f ~ 880 px instead of
    // ~1570) this view measures about 12 degrees and is rejected as flat.
    const PW = 1080, PH = 1920, PS = 0.12
    const K = centredIntrinsics(1507, PW, PH)
    const pose = makeMarkerPose({ distance: 0.6, tiltDeg: 20, tiltAzDeg: 30 })
    const corners = noisyCorners(K, pose, PS, 0, rng(1))!
    expect(new ViewCollector(PS, PW, PH).offer(corners)).toBe('accepted')
  })

  it('turns the measured check bar into a print-scale correction', () => {
    expect(scaleFactorFromBar(97)).toBeCloseTo(0.97, 9)
    expect(() => scaleFactorFromBar(70)).toThrow(/reprint/)
  })
})

describe('check bar (mutation-tested)', () => {
  it('accepts 80 to 120 mm inclusive and refuses anything beyond', () => {
    expect(scaleFactorFromBar(80)).toBeCloseTo(0.8, 12)
    expect(scaleFactorFromBar(120)).toBeCloseTo(1.2, 12)
    expect(() => scaleFactorFromBar(121)).toThrow(/reprint/)
    expect(() => scaleFactorFromBar(79)).toThrow(/reprint/)
    expect(() => scaleFactorFromBar(Number.NaN)).toThrow(/reprint/)
  })
})
