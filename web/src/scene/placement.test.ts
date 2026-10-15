import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { levelledPlacement } from './placement'

const deg = Math.PI / 180
const ifcToWorld = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -90 * deg) // IFC Z-up -> world Y-up, no heading

describe('levelled placement', () => {
  it('removes tilt but keeps heading, with the code point on the code', () => {
    const tilted = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 30 * deg)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 8 * deg)).multiply(ifcToWorld)
    const code = new Vector3(1, 1.3, -2)
    const anchor = new Vector3(4.5, 2.5, 1.3)
    const m = levelledPlacement(tilted, code, anchor, 1, null)
    const top = new Vector3(4.5, 2.5, 10).applyMatrix4(m)
    const base = new Vector3(4.5, 2.5, 0).applyMatrix4(m)
    expect(top.x).toBeCloseTo(base.x, 9) // vertical stays vertical
    expect(top.z).toBeCloseTo(base.z, 9)
    expect(anchor.clone().applyMatrix4(m).distanceTo(code)).toBeLessThan(1e-9)
    const east = new Vector3(5.5, 2.5, 1.3).applyMatrix4(m).sub(code) // IFC +X keeps the 30 degree heading
    expect(Math.atan2(-east.z, east.x) / deg).toBeCloseTo(30, 6)
  })

  it('puts IFC ground on the detected floor for life-size models', () => {
    const m = levelledPlacement(ifcToWorld, new Vector3(0, 1.1, -2), new Vector3(4.5, 2.5, 1.3), 1, 0)
    expect(new Vector3(0, 0, 0).applyMatrix4(m).y).toBeCloseTo(0, 9) // ground on the floor even though the sheet was held 20 cm low
    expect(new Vector3(4.5, 2.5, 1.3).applyMatrix4(m).y).toBeCloseTo(1.3, 9)
  })

  it('keeps the 1:20 desk scale and the code on the code (audit A-03)', () => {
    const code = new Vector3(0.3, 0.75, -0.5)
    const anchor = new Vector3(2.0, -1.6, -0.15)
    const m = levelledPlacement(ifcToWorld, code, anchor, 0.05, null)
    expect(anchor.clone().applyMatrix4(m).distanceTo(code)).toBeLessThan(1e-9)
    const edge = new Vector3(4, 0, 0).applyMatrix4(m).distanceTo(new Vector3(0, 0, 0).applyMatrix4(m))
    expect(edge).toBeCloseTo(0.2, 9)
  })
})
