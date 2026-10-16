import { describe, expect, it } from 'vitest'
import { cvCameraFromModel } from '../pose/modelMatrix'
import { mat3MulVec, type Vec3 } from '../pose'
import { cameraRows, samplePose } from './samplePose'

const P1 = { position_m: [9, -2.5, 1.4] as Vec3, normal: [0, -1, 0] as Vec3, up: [0, 0, 1] as Vec3, scale: 1 }

function project(anchor: typeof P1, pose: ReturnType<typeof samplePose>, p: Vec3): Vec3 {
  const { A, b } = cvCameraFromModel(anchor, pose)
  const x = mat3MulVec(A, p)
  return [x[0] + b[0], x[1] + b[1], x[2] + b[2]]
}

describe('samplePose', () => {
  it('puts the eye at the camera centre, looking along the requested direction', () => {
    const eye: Vec3 = [9, -12, 1.5]
    const pose = samplePose(P1, eye, [0, 1], 12)
    project(P1, pose, eye).forEach((v) => expect(v).toBeCloseTo(0, 9))
    const ahead = project(P1, pose, [9, -2, 1.5 + 10 * Math.tan((12 * Math.PI) / 180)])
    expect(ahead[0]).toBeCloseTo(0, 9)
    expect(ahead[1]).toBeCloseTo(0, 9)
    expect(ahead[2]).toBeGreaterThan(0)
    expect(project(P1, pose, [10, -2, 1.5])[0]).toBeGreaterThan(0) // east is to the right when facing north
    expect(project(P1, pose, [9, -2, 0])[1]).toBeGreaterThan(0) // the ground is down (CV y down)
  })

  it('builds a proper rotation', () => {
    const R = cameraRows([-1, 0], 16)
    const rows = [R.slice(0, 3), R.slice(3, 6), R.slice(6, 9)]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const d = rows[i][0] * rows[j][0] + rows[i][1] * rows[j][1] + rows[i][2] * rows[j][2]
        expect(d).toBeCloseTo(i === j ? 1 : 0, 9)
      }
    }
  })
})
