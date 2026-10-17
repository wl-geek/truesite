import { describe, expect, it } from 'vitest'
import {
  fromColumns, mat3Mul, mat3MulVec, PoseTracker, projectPoint, rotationAngleBetween, rotationFromVector, transpose3,
  type Intrinsics, type Mat3, type Pose, type Vec3,
} from '../pose'
import { gaussian, noisyCorners, rng } from '../pose/testing/synth'
import { PoseSmoother } from '../pose'
import { PoseFusion } from './fusion'
import { C_FROM_DEVICE } from './motion'

// A 23 cm code standing upright at the world origin, facing south (world: x east, y north, z up); marker z points
// back at the viewer. Points of the building behind it, all in view: ground 1.4 m below the code centre, up to 6 m above
// it, up to 14.5 m away.
const S = 0.23
const K: Intrinsics = { f: 1500, cx: 960, cy: 540 }
const R_WM: Mat3 = fromColumns([1, 0, 0], [0, 0, 1], [0, -1, 0])
const BUILDING_W: Vec3[] = [[-5, 13, -1.4], [5, 13, -1.4], [-5, 13, 6], [5, 13, 6], [0, 7, 4], [-2, 4, -1.4], [2, 4, 2]]
const BUILDING_M = BUILDING_W.map((w) => mat3MulVec(transpose3(R_WM), w))
// The CV camera looking north: x east, y down, z north.
const LOOK_NORTH: Mat3 = fromColumns([1, 0, 0], [0, 0, -1], [0, 1, 0])

type Frame = { tMs: number; Rwc: Mat3; c: Vec3 }

/** Standing 1.5 m south of the code, turning ±20° on the spot (6 s period), looking 8° up, with hand tremor. */
function trajectory(seconds: number, seed: number): Frame[] {
  const r = rng(seed)
  const frames: Frame[] = []
  let shake: Vec3 = [0, 0, 0]
  for (let k = 0; k < seconds * 30; k++) {
    const tS = k / 30
    shake = shake.map((v) => 0.8 * v + 0.0015 * gaussian(r)) as Vec3 // ~0.1° of tremor
    const yaw = 0.35 * Math.sin((2 * Math.PI * tS) / 6)
    const Rwc = mat3Mul(rotationFromVector([0, 0, yaw]), mat3Mul(LOOK_NORTH, rotationFromVector([0.14 + shake[0], shake[1], shake[2]])))
    frames.push({ tMs: tS * 1000, Rwc, c: [0.3 + 0.003 * Math.sin(tS * 3), -1.5, 0.002 * Math.cos(tS * 2)] })
  }
  return frames
}

const truePose = (f: Frame): Pose => ({ R: mat3Mul(transpose3(f.Rwc), R_WM), t: mat3MulVec(transpose3(f.Rwc), f.c.map((v) => -v) as Vec3) })

/** Device -> world as the sensors report it: the true rotation, slow yaw drift (1°/min) and a little noise. */
function sensor(f: Frame, r: () => number): Mat3 {
  const drift = rotationFromVector([0, 0, ((f.tMs / 60_000) * Math.PI) / 180])
  const noise = rotationFromVector([0.0005 * gaussian(r), 0.0005 * gaussian(r), 0.0005 * gaussian(r)])
  return mat3Mul(mat3Mul(drift, f.Rwc), mat3Mul(noise, C_FROM_DEVICE))
}

type Stats = { rmsPx: number; jitterPx: number }

/** Screen error of the building corners against the truth: overall RMS, and RMS of the frame-to-frame change. */
function score(frames: Frame[], shown: (Pose | null)[]): Stats {
  let sum = 0
  let n = 0
  let jSum = 0
  let jN = 0
  let prev: number[] | null = null
  frames.forEach((f, k) => {
    const pose = shown[k]
    if (!pose || f.tMs < 1500) return
    const err: number[] = []
    for (const m of BUILDING_M) {
      const a = projectPoint(K, pose, m)
      const b = projectPoint(K, truePose(f), m)
      if (!a || !b || b[0] < -400 || b[0] > 2320 || b[1] < -400 || b[1] > 1480) continue
      err.push(a[0] - b[0], a[1] - b[1])
    }
    err.forEach((e) => { sum += e * e; n++ })
    if (prev && prev.length === err.length) err.forEach((e, i) => { jSum += (e - prev![i]) ** 2; jN++ })
    prev = err
  })
  return { rmsPx: Math.sqrt(sum / n), jitterPx: Math.sqrt(jSum / jN) }
}

/** Run both pipelines on one recording: detections at 15 Hz with 1.5 px corner noise, each ready two frames later. */
function run(seed: number): { before: Stats; fused: Stats; qrOnly: Stats } {
  const frames = trajectory(12, seed)
  const r = rng(seed + 1)
  const tracker = new PoseTracker(S, K)
  const tuned = new PoseTracker(S, K, { smoother: new PoseSmoother({ minCutoff: 0.6, beta: 4, dCutoff: 1 }, { minCutoff: 0.4, beta: 0.8, dCutoff: 1 }) })
  const qrOnly: (Pose | null)[] = []
  let shownTuned: Pose | null = null
  const fusion = new PoseFusion()
  const before: (Pose | null)[] = []
  const fused: (Pose | null)[] = []
  let shownBefore: Pose | null = null
  const pending: { readyAt: number; k: number; corners: [number, number][] | null }[] = []
  frames.forEach((f, k) => {
    fusion.addOrientation(sensor(f, r), f.tMs)
    fusion.addOrientation(sensor({ ...f, tMs: f.tMs + 16.7 }, r), f.tMs + 16.7) // 60 Hz: the sample between frames
    if (k % 2 === 0) pending.push({ readyAt: k + 2, k, corners: noisyCorners(K, truePose(f), S, 1.5, r) })
    while (pending.length && pending[0].readyAt <= k) {
      const d = pending.shift()!
      const t2 = tuned.update(d.corners, frames[d.k].tMs / 1000)
      if (t2) shownTuned = t2.smoothed
      const tracked = tracker.update(d.corners, frames[d.k].tMs / 1000)
      if (!tracked) continue
      shownBefore = tracked.smoothed // today: the latest smoothed QR pose, until the next detection
      fusion.addDetection(tracked.raw, tracked.quality, tracked.provisional, tracked.raw.distanceM, frames[d.k].tMs)
    }
    before.push(shownBefore)
    qrOnly.push(shownTuned)
    fused.push(fusion.poseAt(f.tMs))
  })
  return { before: score(frames, before), fused: score(frames, fused), qrOnly: score(frames, qrOnly) }
}

describe('PoseFusion', () => {
  it('holds the building far steadier and closer to the truth than QR smoothing alone; the QR-only fallback shakes less too', () => {
    for (const seed of [1, 2, 3]) {
      const { before, fused, qrOnly } = run(seed)
      // eslint-disable-next-line no-console
      console.log(`seed ${seed}: before rms ${before.rmsPx.toFixed(1)} px, jitter ${before.jitterPx.toFixed(1)} px | fused rms ${fused.rmsPx.toFixed(1)} px, jitter ${fused.jitterPx.toFixed(1)} px | QR-only tuned rms ${qrOnly.rmsPx.toFixed(1)} px, jitter ${qrOnly.jitterPx.toFixed(1)} px`)
      // Measured 17 Oct: before about 57 px off and 30 px of shake per frame; fused about 9 px off and 1.4 px of shake.
      expect(fused.jitterPx).toBeLessThan(before.jitterPx * 0.1)
      expect(fused.rmsPx).toBeLessThan(before.rmsPx * 0.3)
      // Without sensors (overlay.ts QR_ONLY_*): a third less shake (about 20 px), for a little more lag while turning.
      expect(qrOnly.jitterPx).toBeLessThan(before.jitterPx * 0.75)
    }
  })

  it('follows a real jump (a flip corrected, the sheet moved) after a run of agreeing detections, and ignores one-offs', () => {
    const fusion = new PoseFusion()
    const D = mat3Mul(LOOK_NORTH, C_FROM_DEVICE)
    const pose = (R: Mat3): Pose => ({ R, t: [0, 0, 1.5] })
    const R0 = mat3Mul(transpose3(LOOK_NORTH), R_WM)
    const R20 = mat3Mul(R0, rotationFromVector([0, 0.35, 0]))
    let t = 0
    const feed = (R: Mat3, n: number) => {
      for (let i = 0; i < n; i++, t += 66) {
        fusion.addOrientation(D, t)
        fusion.addDetection(pose(R), 'good', false, 1.5, t)
      }
    }
    feed(R0, 30)
    feed(R20, 3) // a few stray frames: ignored
    expect(rotationAngleBetween(fusion.poseAt(t)!.R, R0)).toBeLessThan(0.01)
    feed(R20, 10) // a run that agrees: re-anchored
    expect(rotationAngleBetween(fusion.poseAt(t)!.R, R20)).toBeLessThan(0.01)
    expect(fusion.trusted(t)).toBe(true)
  })

  it('forgets the code on reset, keeping the sensor samples', () => {
    const fusion = new PoseFusion()
    fusion.addOrientation(mat3Mul(LOOK_NORTH, C_FROM_DEVICE), 0)
    fusion.addDetection({ R: R_WM, t: [0, 0, 1] }, 'good', false, 1, 10)
    fusion.reset()
    expect(fusion.hasEstimate()).toBe(false)
    expect(fusion.poseAt(20)).toBeNull()
    expect(fusion.orientationAt(20)).not.toBeNull()
  })

  it('has no pose without sensor samples, or when they stop', () => {
    const fusion = new PoseFusion()
    expect(fusion.addDetection({ R: R_WM, t: [0, 0, 1] }, 'good', false, 1, 0)).toBe(false)
    fusion.addOrientation(mat3Mul(LOOK_NORTH, C_FROM_DEVICE), 0)
    expect(fusion.addDetection({ R: R_WM, t: [0, 0, 1] }, 'good', false, 1, 10)).toBe(true)
    expect(fusion.poseAt(100)).not.toBeNull()
    expect(fusion.poseAt(2000)).toBeNull() // no sample for 2 s: the sensors went quiet
  })
})
