import { describe, expect, it } from 'vitest'
import { deviceRotation } from '../scene/motion'
import { clampPitch, deviceLook, dragLook, forwardOf, PITCH_MAX, wrap, yawOf } from './lookAngles'

describe('lookAngles', () => {
  it('points the view along the yaw and pitch', () => {
    const f = forwardOf({ yaw: yawOf([0, 1]), pitch: 0 })
    expect(f[0]).toBeCloseTo(0, 9)
    expect(f[1]).toBeCloseTo(1, 9)
    expect(forwardOf({ yaw: 0, pitch: Math.PI / 2 })[2]).toBeCloseTo(1, 9)
  })

  it('drags the world: right turns left (yaw up), down tilts up, and the pitch is clamped', () => {
    const a = dragLook({ yaw: 0, pitch: 0 }, 100, 50, 0.01)
    expect(a.yaw).toBeCloseTo(1, 9)
    expect(a.pitch).toBeCloseTo(0.5, 9)
    expect(dragLook({ yaw: 0, pitch: 0 }, 0, 10000, 0.01).pitch).toBe(PITCH_MAX)
    expect(clampPitch(-10)).toBeLessThan(0)
  })

  it('reads where the back camera points from the motion sensors', () => {
    // Upright in portrait, facing north (alpha 0): the back camera looks north, level.
    const level = deviceLook(deviceRotation(0, 90, 0, 0))
    expect(wrap(level.yaw - Math.PI / 2)).toBeCloseTo(0, 6)
    expect(level.pitch).toBeCloseTo(0, 6)
    // Tilted back 20 deg past upright: looking up 20 deg.
    expect(deviceLook(deviceRotation(0, 110, 0, 0)).pitch).toBeCloseTo((20 * Math.PI) / 180, 6)
    // Turned 90 deg to the left (alpha 90): looking west.
    expect(wrap(deviceLook(deviceRotation(90, 90, 0, 0)).yaw - Math.PI)).toBeCloseTo(0, 6)
  })
})

describe('lookAngles (mutation-tested)', () => {
  it('clamps the pitch to 55 degrees down and 80 up', () => {
    expect(clampPitch(-10)).toBeCloseTo((-55 * Math.PI) / 180, 12)
    expect(clampPitch(10)).toBeCloseTo((80 * Math.PI) / 180, 12)
    expect(clampPitch(0.3)).toBe(0.3)
  })

  it('points the view along yaw and pitch together: a unit vector with that heading and elevation', () => {
    for (const [yaw, pitch] of [[Math.PI / 6, Math.PI / 4], [-2.5, -0.6], [2, 1.2]]) {
      const [x, y, z] = forwardOf({ yaw, pitch })
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12)
      expect(Math.atan2(y, x)).toBeCloseTo(yaw, 12)
      expect(Math.asin(z)).toBeCloseTo(pitch, 12)
    }
  })
})
