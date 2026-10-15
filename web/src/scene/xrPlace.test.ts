import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { projectionMatrixGL } from '../pose'
import { fuseEstimates, intrinsicsFromProjection, viewSpreadDeg, type WorldEstimate } from './xrPlace'

const est = (x: number, yawDeg: number, weight = 1): WorldEstimate => ({
  position: new Vector3(x, 0, 0), quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (yawDeg * Math.PI) / 180),
  weight, cameraPos: new Vector3(),
})

describe('xr marker placement', () => {
  it('recovers CV intrinsics from the view projection (round trip with projectionMatrixGL)', () => {
    const K = { f: 1450, cx: 548, cy: 962 }
    const P = projectionMatrixGL({ K, videoW: 1080, videoH: 1920, viewW: 1080, viewH: 1920, near: 0.1, far: 100, fit: 'cover' })
    const back = intrinsicsFromProjection(P, 1080, 1920)
    expect(back.f).toBeCloseTo(1450, 6)
    expect(back.cx).toBeCloseTo(548, 6)
    expect(back.cy).toBeCloseTo(962, 6)
  })

  it('fuses the largest rotation-consistent cluster and drops a flipped outlier', () => {
    const fused = fuseEstimates([est(1.0, 0), est(1.2, 2, 3), est(1.1, -1), est(5, 40)])!
    expect(fused.used).toBe(3)
    expect(fused.position.x).toBeCloseTo((1.0 + 1.2 * 3 + 1.1) / 5, 9)
    expect((fused.quaternion.angleTo(new Quaternion()) * 180) / Math.PI).toBeLessThan(2)
    expect(fuseEstimates([])).toBeNull()
  })

  it('handles quaternion sign flips when averaging', () => {
    const a = est(0, 10)
    const b = est(0, 10)
    b.quaternion.set(-b.quaternion.x, -b.quaternion.y, -b.quaternion.z, -b.quaternion.w) // same rotation
    const fused = fuseEstimates([a, b])!
    expect(fused.used).toBe(2)
    expect((fused.quaternion.angleTo(a.quaternion) * 180) / Math.PI).toBeLessThan(1e-6)
  })

  it('measures the left-right spread of viewpoints around the code', () => {
    const code = new Vector3(0, 0, 0)
    const cams = [new Vector3(-0.5, 0, 1), new Vector3(0, 0, 1), new Vector3(0.5, 0, 1)]
    expect(viewSpreadDeg(code, cams)).toBeCloseTo(2 * (Math.atan(0.5) * 180) / Math.PI, 6)
  })
})
