import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { markerAxesInModel, mat3Mul, projectionMatrixGL, type Anchor as PoseAnchor, type Mat3, type Pose } from '../pose'
import {
  NEEDED_SPREAD_DEG, NEEDED_VIEWS, fuseEstimates, intrinsicsFromProjection, placementProgress, toWorldEstimate, viewSpreadDeg,
  type WorldEstimate,
} from './xrPlace'

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

// Anchors as in bim/models/*/anchors.json.
const R1: PoseAnchor = { position_m: [4.5, 4.5, 0], normal: [0, 0, 1], up: [0, 1, 0], scale: 1 }
const L1: PoseAnchor = { position_m: [2.0, 1.5, 0], normal: [0, 0, 1], up: [0, 1, 0], scale: 1 }
const D1: PoseAnchor = { position_m: [2.0, -1.6, -0.15], normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 }

/** Where the code lies in the XR world (local space, Y up): on the floor, turned 30 deg. */
const CODE = new Vector3(0.3, -1.2, -0.5)

/** The true model -> world transform: the code at CODE, IFC Z up = world Y up, scaled by anchor.scale. */
function trueWorldFromModel(a: PoseAnchor): Matrix4 {
  return new Matrix4().makeTranslation(CODE.x, CODE.y, CODE.z)
    .multiply(new Matrix4().makeRotationY(Math.PI / 6))
    .multiply(new Matrix4().makeRotationX(-Math.PI / 2))
    .multiply(new Matrix4().makeScale(a.scale, a.scale, a.scale))
    .multiply(new Matrix4().makeTranslation(-a.position_m[0], -a.position_m[1], -a.position_m[2]))
}

/** An exact estimate as detect() builds it, from a camera at `eye` looking at the code. */
function exactEstimate(a: PoseAnchor, eye: Vector3): WorldEstimate {
  const viewM = new Matrix4().lookAt(eye, CODE, new Vector3(0, 1, 0)).setPosition(eye) // GL camera -> world
  const cvFromModel = new Matrix4().makeScale(1, -1, -1).multiply(viewM.clone().invert()).multiply(trueWorldFromModel(a))
  const e = cvFromModel.elements // column-major
  const lin: Mat3 = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]] // row-major = scale R Rqm^T
  const pose: Pose = {
    R: mat3Mul(lin, markerAxesInModel(a)).map((v) => v / a.scale),
    t: new Vector3(...a.position_m).applyMatrix4(cvFromModel).toArray(),
  }
  return toWorldEstimate(viewM, a, pose, 1)
}

/** n cameras swept left to right from x = -0.6 to +0.6 m, 1.2 m up and 0.8 m back from the code. */
const sweep = (a: PoseAnchor, n = NEEDED_VIEWS) =>
  Array.from({ length: n }, (_, i) => exactEstimate(a, CODE.clone().add(new Vector3(-0.6 + (1.2 * i) / (n - 1), 1.2, 0.8))))

/** Planar flip: same code, wrong tilt, so the view falls out of the rotation cluster. */
const flip = (e: WorldEstimate) => e.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (40 * Math.PI) / 180))

describe('place-by-code progress', () => {
  const sweepDeg = (2 * Math.atan(0.6 / Math.hypot(1.2, 0.8)) * 180) / Math.PI // 45.2 deg

  it('puts each estimate on the code, desk scale included', () => {
    for (const a of [R1, L1, D1]) {
      for (const e of sweep(a, 3)) expect(e.position.distanceTo(CODE)).toBeLessThan(1e-9)
    }
  })

  it('measures the spread of views around the code, not around the IFC origin (A-02: R1 is 6.4 m from it)', () => {
    for (const a of [R1, L1, D1]) {
      const p = placementProgress(sweep(a))
      expect(p.spreadDeg).toBeGreaterThan(NEEDED_SPREAD_DEG)
      expect(p.spreadDeg).toBeCloseTo(sweepDeg, 6)
      expect(p.progress).toBe(1)
    }
  })

  it('counts only the consistent views towards progress and the views label', () => {
    const e = sweep(R1)
    for (const i of [1, 4, 7, 10]) flip(e[i])
    const p = placementProgress(e)
    expect(p.fused?.used).toBe(8)
    expect(p.views).toBe(8)
    expect(p.progress).toBeLessThan(1)
  })

  it('measures the spread over the consistent views only', () => {
    const e = sweep(R1, 14)
    flip(e[0])
    flip(e[13]) // the two widest views are outliers
    const p = placementProgress(e)
    expect(p.views).toBe(NEEDED_VIEWS)
    expect(p.spreadDeg).toBeLessThan(sweepDeg - 5)
  })

  it('never shows more than NEEDED_VIEWS views', () => {
    const p = placementProgress(sweep(L1, 37))
    expect(p.views).toBe(NEEDED_VIEWS)
    expect(p.progress).toBe(1)
  })

  it('reports nothing before the first view', () => {
    expect(placementProgress([])).toEqual({ fused: null, views: 0, spreadDeg: 0, progress: 0 })
  })
})
