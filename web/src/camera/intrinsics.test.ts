import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focalFromHfov } from '../pose'
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

  it('stores calibration per frame size and orientation', () => {
    saveIntrinsics(1920, 1080, 1500)
    expect(loadIntrinsics(1920, 1080).f).toBe(1500)
    expect(isCalibrated(1920, 1080)).toBe(true)
    expect(loadIntrinsics(1080, 1920).f).toBe(focalFromHfov(DEFAULT_HFOV_DEG, 1080))
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
