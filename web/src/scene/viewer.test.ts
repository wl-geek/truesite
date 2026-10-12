import { describe, expect, it } from 'vitest'
import { isTap, pointerToNdc } from './viewer'

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
