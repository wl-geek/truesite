import { describe, expect, it } from 'vitest'
import { mat3Mul, mat3MulVec, transpose3, type Mat3, type Vec3 } from '../pose'
import { makeMarkerPose } from '../pose/testing/synth'
import { upInGlCamera } from './level'
import { angleBetweenDeg, C_FROM_DEVICE, deviceRotation, deviceStill, lookAroundPose, nextLock, screenAngleDeg, type MotionSample } from './motion'

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9 - Math.log10(1 / eps)))

describe('look-around (motion sensors)', () => {
  const pose = makeMarkerPose({ distance: 1.5, tiltDeg: 40, tiltAzDeg: 30, rollDeg: 10, dir: [0.1, 0.2, 1] })
  const D0 = deviceRotation(30, 70, -5)

  it('gives back the lock pose when the phone has not turned', () => {
    const p = lookAroundPose({ R0: pose.R, t0: pose.t, D0, tSec: 0 }, D0)
    close(p.R, pose.R)
    close(p.t, pose.t)
  })

  it('keeps the camera centre fixed in marker coordinates while turning', () => {
    const p = lookAroundPose({ R0: pose.R, t0: pose.t, D0, tSec: 0 }, deviceRotation(75, 40, 12))
    const centre = (R: Mat3, t: Vec3) => mat3MulVec(transpose3(R), t).map((v) => -v)
    close(centre(p.R, p.t), centre(pose.R, pose.t))
  })

  it('turns the camera exactly as much as the device turned', () => {
    const D1 = deviceRotation(75, 40, 12)
    const p = lookAroundPose({ R0: pose.R, t0: pose.t, D0, tSec: 0 }, D1)
    // camera rotation change, expressed in camera axes, equals C (D1^T D0) C
    const change = mat3Mul(p.R, transpose3(pose.R))
    close(change, mat3Mul(mat3Mul(mat3Mul(C_FROM_DEVICE, transpose3(D1)), D0), C_FROM_DEVICE))
  })

  it('a point fixed in the world stays fixed: tilting the phone up moves it down the image', () => {
    // Phone upright (beta 90) looking at the horizon, then tilted up by 20 degrees.
    const up = lookAroundPose({ R0: pose.R, t0: pose.t, D0: deviceRotation(0, 90, 0), tSec: 0 }, deviceRotation(0, 110, 0))
    const pMarker: Vec3 = [0, 0, 0]
    const yBefore = mat3MulVec(pose.R, pMarker)[1] + pose.t[1]
    const yAfter = mat3MulVec(up.R, pMarker)[1] + up.t[1]
    expect(yAfter).toBeGreaterThan(yBefore) // CV y points down: the code moves lower in the frame
  })
})

describe('look-around lock while the device turns (audit C-02)', () => {
  // An upright tablet near the code, then turning on the spot about the vertical at the filming pace (30 degrees/s).
  const pose0 = makeMarkerPose({ distance: 0.7, tiltDeg: 25, tiltAzDeg: 90, dir: [0.05, 0.1, 1] })
  const D = (deg: number) => deviceRotation(deg, 90, 0)
  /** The exact marker -> camera pose after turning `deg` from the still pose. */
  const truth = (deg: number) => lookAroundPose({ R0: pose0.R, t0: pose0.t, D0: D(0), tSec: 0 }, D(deg))
  const centre = (p: { R: Mat3; t: Vec3 }) => mat3MulVec(transpose3(p.R), p.t).map((v) => -v)
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]))
  /** While turning, a detection's smoothed QR pose lags the newest motion sample by about 2 degrees (e2e, p1-turn-slow). */
  const LAG_DEG = 2

  it('measures the angle between two rotations', () => {
    expect(angleBetweenDeg(D(10), D(10))).toBeCloseTo(0, 6)
    expect(angleBetweenDeg(D(10), D(40))).toBeCloseTo(30, 6)
  })

  it('shows the defect: pairing the smoothed pose with the newest sample holds the model about 2 degrees off', () => {
    const paired = { R0: truth(15 - LAG_DEG).R, t0: truth(15 - LAG_DEG).t, D0: D(15), tSec: 0.5 }
    expect(angleBetweenDeg(lookAroundPose(paired, D(60)).R, truth(60).R)).toBeCloseTo(LAG_DEG, 1)
  })

  it('keeps the rotation pair from the last still moment while the device turns: the held model is exact', () => {
    let lock = nextLock(null, pose0, D(0), 0, true)
    for (let deg = 3; deg <= 15; deg += 3) lock = nextLock(lock, truth(deg - LAG_DEG), D(deg), deg / 30, false)
    const held = lookAroundPose(lock, D(60))
    expect(angleBetweenDeg(held.R, truth(60).R)).toBeLessThan(0.01)
    expect(dist(centre(held), centre(truth(60)))).toBeLessThan(1e-9)
    expect(lock.tSec).toBe(0.5) // the code was last seen then: look-around's 90 s count from there
  })

  it('still moves the frozen camera centre while turning (the person may step), keeping the rotation pair', () => {
    const still = nextLock(null, pose0, D(0), 0, true)
    const stepped = { R: pose0.R, t: [pose0.t[0] + 0.1, pose0.t[1], pose0.t[2] + 0.3] as Vec3 }
    const lock = nextLock(still, stepped, D(5), 0.2, false)
    expect(lock.R0).toEqual(still.R0)
    expect(lock.D0).toEqual(still.D0)
    expect(dist(centre({ R: lock.R0, t: lock.t0 }), centre(stepped))).toBeLessThan(1e-9)
  })

  it('pairs the pose with the newest sample while the device is still, and when there is no lock yet', () => {
    const still = nextLock(null, pose0, D(0), 0, true)
    expect(nextLock(still, truth(20), D(20), 3, true)).toEqual({ R0: truth(20).R, t0: truth(20).t, D0: D(20), tSec: 3 })
    expect(nextLock(null, truth(20), D(22), 3, false)).toEqual({ R0: truth(20).R, t0: truth(20).t, D0: D(22), tSec: 3 })
  })

  const turning = (degS: number, fromMs = 1000, n = 13): MotionSample[] =>
    Array.from({ length: n }, (_, i) => ({ tMs: fromMs + i * 33, D: D((degS * i * 33) / 1000) }))

  it('calls the device still below 1.5 degrees/s over the last 0.3 s', () => {
    expect(deviceStill(turning(0))).toBe(true)
    expect(deviceStill(turning(1))).toBe(true) // a hand holding still drifts this much
    expect(deviceStill(turning(5))).toBe(false)
    expect(deviceStill(turning(30))).toBe(false) // the filming pace
  })

  it('judges by the newest samples: still once a turn has stopped, turning as soon as one starts', () => {
    const stopped = [...turning(30, 0, 10), ...Array.from({ length: 12 }, (_, i) => ({ tMs: 330 + i * 33, D: D(9.9) }))]
    expect(deviceStill(stopped)).toBe(true)
    const starting = [...turning(0, 0, 12), { tMs: 400, D: D(1) }]
    expect(deviceStill(starting)).toBe(false)
  })

  it('calls the device still when there is nothing to judge by yet', () => {
    expect(deviceStill([])).toBe(true)
    expect(deviceStill(turning(30, 0, 4))).toBe(true) // only 0.1 s of samples
  })
})

describe('screen angle for the motion sensors (iPad Safari measures it from landscape)', () => {
  const r = Math.PI / 180
  const Rz = (d: number): Mat3 => [Math.cos(d * r), -Math.sin(d * r), 0, Math.sin(d * r), Math.cos(d * r), 0, 0, 0, 1]
  // What WebKit reports per window.orientation: an iPhone's natural orientation is portrait, an iPad's landscape.
  const IPHONE = { 0: { type: 'portrait-primary', angle: 0 }, 90: { type: 'landscape-primary', angle: 90 }, [-90]: { type: 'landscape-secondary', angle: 270 }, 180: { type: 'portrait-secondary', angle: 180 } } as const
  const IPAD = { 0: { type: 'portrait-primary', angle: 90 }, 90: { type: 'landscape-primary', angle: 0 }, [-90]: { type: 'landscape-secondary', angle: 180 }, 180: { type: 'portrait-secondary', angle: 270 } } as const
  const WO = [0, 90, -90, 180] as const

  it('keeps screen.orientation.angle on an iPhone in every orientation', () => {
    for (const wo of WO) expect(screenAngleDeg(IPHONE[wo], wo, true)).toBe(IPHONE[wo].angle)
  })

  it('keeps screen.orientation.angle on Android phones and tablets (no iOS motion permission API)', () => {
    expect(screenAngleDeg({ type: 'landscape-primary', angle: 90 }, 90, false)).toBe(90)
    expect(screenAngleDeg({ type: 'landscape-primary', angle: 0 }, 0, false)).toBe(0)
    expect(screenAngleDeg({ type: 'portrait-primary', angle: 270 }, undefined, false)).toBe(270)
  })

  it('uses window.orientation on an iPad, in every orientation', () => {
    for (const wo of WO) expect(screenAngleDeg(IPAD[wo], wo, true)).toBe(wo)
  })

  it('falls back to the angle without window.orientation, and to 0 without screen.orientation', () => {
    expect(screenAngleDeg(IPAD[90], undefined, true)).toBe(0)
    expect(screenAngleDeg(undefined, 90, true)).toBe(0)
  })

  it('gives an iPad the true screen -> world rotation; the raw angle puts "up" far enough off that levelling refuses it', () => {
    const D_screen = deviceRotation(30, 4, 70) // any attitude
    for (const wo of WO) {
      const D_device = mat3Mul(D_screen, Rz(wo)) // the portrait hardware frame the angles are given in
      const beta = Math.asin(D_device[7]) / r, gamma = Math.atan2(-D_device[6], D_device[8]) / r, alpha = Math.atan2(-D_device[1], D_device[4]) / r
      const fixed = deviceRotation(alpha, beta, gamma, screenAngleDeg(IPAD[wo], wo, true))
      fixed.forEach((v, i) => expect(v).toBeCloseTo(D_screen[i], 9))
      const raw = deviceRotation(alpha, beta, gamma, IPAD[wo].angle)
      const up = upInGlCamera(D_screen), upRaw = upInGlCamera(raw)
      expect(Math.acos(up[0] * upRaw[0] + up[1] * upRaw[1] + up[2] * upRaw[2]) / r).toBeGreaterThan(8)
    }
  })
})
