import { describe, expect, it } from 'vitest'
import { frameDistance, isTap, pointerToNdc } from './viewer'

describe('viewer pointer helpers', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it('maps client pixels to normalised device coordinates (y up)', () => {
    expect(pointerToNdc(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(pointerToNdc(500, 250, rect)).toEqual({ x: 1, y: -1 })
    expect(pointerToNdc(300, 150, rect)).toEqual({ x: 0, y: 0 })
  })

  it('treats short, still presses as taps and drags as orbiting', () => {
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 13, y: 14, t: 200 })).toBe(true)
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 30, y: 10, t: 200 })).toBe(false)
    expect(isTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 900 })).toBe(false)
  })
})

describe('frameDistance', () => {
  const rad = (deg: number) => (deg * Math.PI) / 180

  it('fits the vertical field of view on a landscape screen', () => {
    expect(frameDistance(2, 50, 16 / 9)).toBeCloseTo(2 / Math.sin(rad(25)), 9)
  })

  it('backs off on a portrait phone so the model fits the narrower horizontal view', () => {
    const portrait = frameDistance(2, 50, 9 / 19.5)
    expect(portrait).toBeGreaterThan(frameDistance(2, 50, 16 / 9))
    const hfov = 2 * Math.atan(Math.tan(rad(25)) * (9 / 19.5))
    expect(2 / portrait).toBeCloseTo(Math.sin(hfov / 2), 9) // the sphere just touches the left and right edges
  })
})
