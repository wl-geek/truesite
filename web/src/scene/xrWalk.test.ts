import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { yawToFace } from './xrWalk'

describe('xr walk placement', () => {
  it("turns the model's north to where the camera looks", () => {
    const north = (yaw: number) => new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), yaw)
    for (const [fx, fz] of [[0, -1], [1, 0], [-1, 0], [0.6, 0.8]] as const) {
      const n = north(yawToFace(fx, fz))
      expect(n.x).toBeCloseTo(fx, 9)
      expect(n.z).toBeCloseTo(fz, 9)
    }
  })
})
