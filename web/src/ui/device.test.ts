import { describe, expect, it } from 'vitest'
import { isHandheld } from './device'

const base = { platform: 'MacIntel', maxTouchPoints: 0, coarsePointer: false }

describe('isHandheld', () => {
  it('says yes to phones and tablets, including iPadOS reporting a Mac', () => {
    expect(isHandheld({ ...base, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Mobile/15E148' })).toBe(true)
    expect(isHandheld({ ...base, ua: 'Mozilla/5.0 (Linux; Android 16; SM-X710) AppleWebKit/537.36' })).toBe(true)
    expect(isHandheld({ ...base, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 })).toBe(true)
  })

  it('says no to laptops and PCs, whatever their screen size', () => {
    expect(isHandheld({ ...base, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0' })).toBe(false)
    expect(isHandheld({ ...base, platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0' })).toBe(false)
    // A touchscreen laptop whose main pointer is still the trackpad counts as a computer.
    expect(isHandheld({ ...base, platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 10 })).toBe(false)
  })
})
