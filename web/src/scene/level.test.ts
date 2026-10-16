import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { deviceRotation } from './motion'
import { levelModelMatrix, upInGlCamera } from './level'

const PIVOT: [number, number, number] = [9, -2.5, 1.4]

/** IFC -> camera: IFC Z tilted by `tiltDeg` about the camera X axis, scale s, pivot placed 1.5 m ahead. */
function tilted(tiltDeg: number, s = 1): Matrix4 {
  const base = new Matrix4().makeRotationX(-Math.PI / 2) // IFC Z -> camera +Y (up), IFC Y -> camera -Z (ahead)
  const tilt = new Matrix4().makeRotationX((tiltDeg * Math.PI) / 180)
  const m = tilt.multiply(base).multiply(new Matrix4().makeScale(s, s, s))
  const p = new Vector3(...PIVOT).applyMatrix4(m)
  return new Matrix4().makeTranslation(-p.x, -p.y, -1.5 - p.z).multiply(m)
}

describe('levelModelMatrix', () => {
  it('leaves an already level model alone', () => {
    const m = tilted(0).toArray()
    expect(levelModelMatrix(m, PIVOT, [0, 1, 0])).toEqual(m.map((v) => expect.closeTo(v, 9)))
  })

  it('stands IFC Z straight up and keeps the code point, the scale and the heading', () => {
    for (const s of [1, 0.01]) {
      const m = tilted(3, s)
      const out = new Matrix4().fromArray(levelModelMatrix(m.toArray(), PIVOT, [0, 1, 0])!)
      const pos = new Vector3(), q = new Quaternion(), sc = new Vector3()
      out.decompose(pos, q, sc)
      expect(sc.x).toBeCloseTo(s, 9)
      expect(new Vector3(0, 0, 1).applyQuaternion(q).y).toBeCloseTo(1, 9)
      expect(new Vector3(...PIVOT).applyMatrix4(out).distanceTo(new Vector3(...PIVOT).applyMatrix4(m))).toBeLessThan(1e-9)
      expect(new Vector3(1, 0, 0).applyQuaternion(q).x).toBeCloseTo(1, 9) // a pure pitch error: the heading is untouched
    }
  })

  it('refuses a correction beyond the limit', () => {
    expect(levelModelMatrix(tilted(12).toArray(), PIVOT, [0, 1, 0])).toBeNull()
    expect(levelModelMatrix(tilted(12).toArray(), PIVOT, [0, 1, 0], 15)).not.toBeNull()
  })
})

describe('upInGlCamera', () => {
  it('is camera +Y for an upright device facing the horizon, portrait and landscape', () => {
    const up = upInGlCamera(deviceRotation(0, 90, 0, 0))
    expect(up[0]).toBeCloseTo(0, 9)
    expect(up[1]).toBeCloseTo(1, 9)
    expect(up[2]).toBeCloseTo(0, 9)
    const land = upInGlCamera(deviceRotation(0, 0, -90, 90)) // landscape, rotated 90 deg
    expect(land[1]).toBeCloseTo(1, 9)
  })

  it('tips back when the device pitches up', () => {
    const up = upInGlCamera(deviceRotation(0, 100, 0, 0)) // top edge leaning back by 10 deg: looking up a little
    expect(up[1]).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 9)
    expect(up[2]).toBeCloseTo(-Math.sin((10 * Math.PI) / 180), 9)
  })
})
