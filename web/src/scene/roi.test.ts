import { describe, expect, it } from 'vitest'
import { fullFrame, regionAround, regionToVideo } from './roi'

describe('where the QR reader looks', () => {
  it('reads the whole frame at 640 px wide when there is no code to follow', () => {
    expect(fullFrame(1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080, outW: 640, outH: 360 })
  })

  it('follows the code: a crop around its last corners, with room to move, at the camera\'s own resolution', () => {
    // a 200 px code centred at (960, 540) in a 1920 x 1080 frame
    const corners: [number, number][] = [[860, 440], [1060, 440], [1060, 640], [860, 640]]
    const r = regionAround(corners, 1920, 1080)!
    expect(r.sx).toBe(860 - 160) // 0.8 code widths of margin
    expect(r.sy).toBe(440 - 160)
    expect([r.sw, r.sh]).toEqual([520, 520])
    expect([r.outW, r.outH]).toEqual([520, 520]) // native: 3x the detail of the 640 px full frame
  })

  it('scales a big crop down to 640 px and clamps it to the frame', () => {
    const near: [number, number][] = [[1300, 300], [1800, 300], [1800, 800], [1300, 800]] // 500 px, near the right edge
    const r = regionAround(near, 1920, 1080)!
    expect(r.sx + r.sw).toBe(1920)
    expect(r.sy).toBe(0)
    expect(Math.max(r.outW, r.outH)).toBe(640)
    expect(r.outW / r.sw).toBeCloseTo(r.outH / r.sh, 2)
  })

  it('reads the whole frame when the crop would be most of it anyway', () => {
    const huge: [number, number][] = [[300, 100], [1600, 100], [1600, 1000], [300, 1000]]
    expect(regionAround(huge, 1920, 1080)).toBeNull()
  })

  it('maps corners read in a crop back to video pixels', () => {
    const r = { sx: 700, sy: 280, sw: 520, sh: 520, outW: 260, outH: 260 } // read at half size
    expect(regionToVideo([{ x: 80, y: 80 }, { x: 180, y: 80 }], r)).toEqual([[860, 440], [1060, 440]])
    const full = fullFrame(1920, 1080)
    expect(regionToVideo([{ x: 320, y: 180 }], full)).toEqual([[960, 540]])
  })
})
