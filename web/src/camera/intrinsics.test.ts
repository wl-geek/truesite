import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { centredIntrinsics, estimatePose, focalFromHfov } from '../pose'
import { makeMarkerPose, noisyCorners, rng } from '../pose/testing/synth'
import {
  DEFAULT_HFOV_DEG, intrinsicsKey, isCalibrated, loadIntrinsics, loadQrSizeCorrection, saveIntrinsics, saveQrSizeCorrection,
} from './intrinsics'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m }
}

describe('intrinsics store', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to a 63 degree field of view with a centred principal point', () => {
    expect(loadIntrinsics(1920, 1080)).toEqual({ f: focalFromHfov(DEFAULT_HFOV_DEG, 1920), cx: 960, cy: 540 })
    expect(isCalibrated(1920, 1080)).toBe(false)
  })

  it('measures the default field of view across the long side, so portrait gets the same lens', () => {
    expect(loadIntrinsics(1080, 1920)).toEqual({ f: focalFromHfov(DEFAULT_HFOV_DEG, 1920), cx: 540, cy: 960 })
    expect(loadIntrinsics(1080, 1920).f).toBeCloseTo(loadIntrinsics(1920, 1080).f, 9)
    expect(loadIntrinsics(720, 1280).f).toBeCloseTo(loadIntrinsics(1280, 720).f, 9)
  })

  it('grades an uncalibrated portrait D1 view good, with the distance within 10%', () => {
    // A phone whose true focal length is about 4% off the 63 degree prior; D1 is a 12 cm code.
    const W = 1080, H = 1920, S = 0.12
    const truth = centredIntrinsics(1507, W, H)
    const pose = makeMarkerPose({ distance: 0.6, tiltDeg: 20, tiltAzDeg: 30 })
    const corners = noisyCorners(truth, pose, S, 0.5, rng(3))!
    const est = estimatePose(corners, S, loadIntrinsics(W, H))!
    expect(est.quality).toBe('good')
    expect(Math.abs(est.distanceM - 0.6) / 0.6).toBeLessThan(0.1)
  })

  it('stores calibration per frame size and orientation', () => {
    saveIntrinsics(1920, 1080, 1500)
    expect(loadIntrinsics(1920, 1080).f).toBe(1500)
    expect(isCalibrated(1920, 1080)).toBe(true)
    expect(loadIntrinsics(1080, 1920).f).toBe(focalFromHfov(DEFAULT_HFOV_DEG, 1920))
    expect(isCalibrated(1080, 1920)).toBe(false)
    expect(intrinsicsKey(1080, 1920)).not.toBe(intrinsicsKey(1920, 1080))
  })

  it('rejects invalid focal lengths and ignores corrupt storage', () => {
    expect(() => saveIntrinsics(1920, 1080, -1)).toThrow()
    localStorage.setItem('truesite.' + intrinsicsKey(1280, 720), '{nope')
    expect(loadIntrinsics(1280, 720).cx).toBe(640)
  })

  it('keeps a sane print-scale correction per anchor', () => {
    expect(loadQrSizeCorrection('A1')).toBe(1)
    saveQrSizeCorrection('A1', 0.97)
    expect(loadQrSizeCorrection('A1')).toBe(0.97)
    expect(loadQrSizeCorrection('D1')).toBe(1)
    expect(() => saveQrSizeCorrection('A1', 0.5)).toThrow(/reprint/)
  })

  it('works without storage at all', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(loadIntrinsics(640, 480).cx).toBe(320)
    expect(() => saveIntrinsics(640, 480, 500)).not.toThrow()
    expect(loadQrSizeCorrection('A1')).toBe(1)
  })
})

describe('intrinsics store (mutation-tested)', () => {
  let store: ReturnType<typeof fakeStorage>
  beforeEach(() => { store = fakeStorage(); vi.stubGlobal('localStorage', store) })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps its keys under the truesite. prefix, so calibrations survive app updates', () => {
    saveIntrinsics(1920, 1080, 1500)
    saveQrSizeCorrection('P1', 0.97)
    expect([...store.map.keys()].sort()).toEqual(['truesite.intrinsics.1920x1080', 'truesite.qrscale.P1'])
    expect(JSON.parse(store.map.get('truesite.intrinsics.1920x1080')!)).toMatchObject({ f: 1500, videoW: 1920, videoH: 1080, source: 'calibrated' })
  })

  it('ignores stored calibrations that are not usable for this frame size', () => {
    const def = loadIntrinsics(1920, 1080).f
    const put = (v: unknown) => store.map.set('truesite.' + intrinsicsKey(1920, 1080), JSON.stringify(v))
    for (const bad of [
      { f: 0, videoW: 1920, videoH: 1080, source: 'calibrated' },
      { f: -1500, videoW: 1920, videoH: 1080, source: 'calibrated' },
      { f: 'big', videoW: 1920, videoH: 1080, source: 'calibrated' },
      { f: 1500, videoW: 1080, videoH: 1920, source: 'calibrated' }, // a portrait entry under the landscape key
      { f: 1500, videoW: 1920, videoH: 1440, source: 'calibrated' },
      { f: 1500, videoW: 1280, videoH: 1080, source: 'calibrated' },
    ]) {
      put(bad)
      expect(loadIntrinsics(1920, 1080).f, JSON.stringify(bad)).toBe(def)
      expect(isCalibrated(1920, 1080), JSON.stringify(bad)).toBe(false)
    }
  })

  it('refuses a zero or non-finite focal length', () => {
    for (const f of [0, Number.NaN, Infinity]) expect(() => saveIntrinsics(1920, 1080, f), String(f)).toThrow(/invalid focal length/)
    expect(store.map.size).toBe(0)
  })

  it('accepts print-scale corrections from 0.8 to 1.2 inclusive, and nothing outside', () => {
    for (const ok of [0.8, 1.2]) {
      saveQrSizeCorrection('P2', ok)
      expect(loadQrSizeCorrection('P2')).toBe(ok)
    }
    expect(() => saveQrSizeCorrection('P2', 1.25)).toThrow('print scale 1.25 is outside 0.8–1.2: reprint at 100%')
    store.map.set('truesite.qrscale.P3', '1.5') // written by hand or by an older build
    expect(loadQrSizeCorrection('P3')).toBe(1)
    store.map.set('truesite.qrscale.P3', '0.79')
    expect(loadQrSizeCorrection('P3')).toBe(1)
  })
})
