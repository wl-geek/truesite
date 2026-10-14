import { describe, expect, it } from 'vitest'
import { mat3Mul, mat3MulVec, transpose3, type Mat3, type Vec3 } from '../pose'
import { makeMarkerPose } from '../pose/testing/synth'
import { C_FROM_DEVICE, deviceRotation, lookAroundPose } from './motion'

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
