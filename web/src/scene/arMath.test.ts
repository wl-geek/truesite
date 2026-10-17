import { describe, expect, it } from 'vitest'
import type { Anchor, ProjectManifest } from '../api/types'
import {
  aboutDistance, checkAvailability, coachHint, effectiveQrSize, findAnchor, isDeskAnchor, isFar, isLifeSizeFloor, poseAnchor, scaleLabel, searchingSeconds,
  SEARCH_TIPS_AFTER_S, startDistanceM, toVideoPixels, virtualDemoHref, walkInsideFirst,
} from './arMath'

// Made-up anchors of a made-up project: an upright code (A1), a 1:20 desk sheet (D1) and a 1:1 floor code (L1).
const A1: Anchor = { anchor_id: 'A1', project_id: 'test', qr_size_m: 0.23, position_m: [0.1, 1.5, 1.35], normal: [1, 0, 0], up: [0, 0, 1], scale: 1, label: 'Wall' }
const D1: Anchor = { ...A1, anchor_id: 'D1', qr_size_m: 0.12, normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 }
const L1: Anchor = { ...A1, anchor_id: 'L1', qr_size_m: 0.16, normal: [0, 0, 1], up: [0, 1, 0] }
const PROJECT: ProjectManifest = { project_id: 'test', name: 'Test project', model_url: '/m.glb', elements: [], anchors: [A1, D1] }

describe('arMath', () => {
  it('scales detector corners from the 640 px frame back to video pixels', () => {
    const c = toVideoPixels([{ x: 10, y: 20 }, { x: 640, y: 360 }], 640, 360, 1920, 1080)
    expect(c).toEqual([[30, 60], [1920, 1080]])
  })

  it('applies the print-scale correction to the printed size', () => {
    expect(effectiveQrSize(A1, 1)).toBe(0.23)
    expect(effectiveQrSize(D1, 0.95)).toBeCloseTo(0.114, 9)
  })

  it('maps the API anchor to the pose module anchor', () => {
    expect(poseAnchor(D1)).toEqual({ position_m: [0.1, 1.5, 1.35], normal: [0, 0, 1], up: [0, 1, 0], scale: 0.05 })
  })

  it('finds anchors and recognises desk anchors', () => {
    expect(findAnchor(PROJECT, 'D1')).toBe(D1)
    expect(findAnchor(PROJECT, 'Z9')).toBeNull()
    expect(isDeskAnchor(D1)).toBe(true)
    expect(isDeskAnchor(A1)).toBe(false)
  })

  it('warns beyond 3 m only', () => {
    expect(isFar(null)).toBe(false)
    expect(isFar(2.9)).toBe(false)
    expect(isFar(3.2)).toBe(true)
  })

  it('labels the scale', () => {
    expect(scaleLabel(A1)).toBe('Life size · 1:1')
    expect(scaleLabel(D1)).toBe('Scale model · 1:20')
  })

  it('coaches the next step', () => {
    expect(coachHint(null, true)).toMatch(/QR code on the sheet/)
    expect(coachHint({ tracking: true, provisional: true, distanceM: 2 }, false)).toMatch(/within about 1 m/)
    expect(coachHint({ tracking: true, provisional: false, distanceM: 3.5 }, false)).toMatch(/Move closer/)
    expect(coachHint({ tracking: true, provisional: false, distanceM: 1.2 }, false)).toMatch(/Check as-built/)
  })

  it("doesn't ask for Check as-built when the sheet can't be checked (B-05)", () => {
    const locked = { tracking: true, provisional: false, distanceM: 1.5 }
    expect(coachHint(locked, false, false)).not.toMatch(/Check as-built/)
    expect(coachHint(locked, false, false)).toMatch(/look up/)
    expect(coachHint(locked, false, true)).toMatch(/Check as-built/)
    expect(coachHint(locked, true, false)).toMatch(/Walk around the sheet/)
  })

  it('gives tips after 5 s without the code (spec section 8)', () => {
    const lost = { tracking: false, provisional: true, distanceM: null, mode: 'lost' as const }
    expect(coachHint({ ...lost, searchingS: 2 }, false)).toBe('Point the camera at the QR code.')
    for (const desk of [false, true]) {
      const tip = coachHint({ ...lost, searchingS: 6 }, desk)
      expect(tip).toMatch(/light/)
      expect(tip).toMatch(/about 1 m/)
      expect(tip).toMatch(/steady/)
    }
    expect(coachHint({ ...lost, searchingS: 6, mode: 'motion' }, false)).toMatch(/Look around/)
  })

  it('starts at a distance that suits the code size: about 35 cm for the 7 cm desk code, 1 m for the P codes (audit C-01)', () => {
    expect(startDistanceM({ qr_size_m: 0.07 })).toBe(0.35) // site D1
    expect(startDistanceM({ qr_size_m: 0.12 })).toBe(0.6)
    expect(startDistanceM({ qr_size_m: 0.16 })).toBe(0.8)
    expect(startDistanceM({ qr_size_m: 0.23 })).toBe(1)
    expect(startDistanceM({ qr_size_m: 0.33 })).toBe(1) // never more than 1 m
    expect(aboutDistance(0.35)).toBe('about 35 cm')
    expect(aboutDistance(1)).toBe('about 1 m')
  })

  it('coaches a desk sheet at its own start distance, without stepping back (audit C-01)', () => {
    const lost = { tracking: false, provisional: true, distanceM: null, mode: 'lost' as const }
    expect(coachHint({ ...lost, searchingS: 6 }, true, false, 0.35)).toBe("Can't find the code. Add more light, move within about 35 cm and hold the phone steady.")
    expect(coachHint({ tracking: true, provisional: true, distanceM: 0.9 }, true, false, 0.35)).toBe('Hold the camera about 35 cm from the code and keep it steady.')
    expect(coachHint({ tracking: true, provisional: true, distanceM: 2 }, false, false, 0.8)).toBe('Move within about 80 cm of the code, then step back slowly.')
    expect(coachHint({ ...lost, searchingS: 6 }, false, false, 1)).toBe("Can't find the code. Add more light, move within about 1 m and hold the phone steady.")
  })

  it('says look-around paused at its time limit instead of giving the search tips (audit C-14)', () => {
    const expired = { tracking: false, provisional: true, distanceM: null, mode: 'lost' as const, searchingS: 95, lookAroundExpired: true }
    expect(coachHint(expired, false, false)).toBe('Look-around paused after 90 s: point back at the code to re-align.')
    expect(coachHint({ ...expired, lookAroundExpired: false }, false, false)).toMatch(/Add more light/)
  })

  it('links a live sheet to the same spot in the virtual demo, else to the virtual demo section (audit C-05)', () => {
    const spots = ['P1', 'P2', 'P3', 'P4']
    expect(virtualDemoHref('site', 'P1', spots)).toBe('/samples?at=P1')
    expect(virtualDemoHref('site', 'P4', spots)).toBe('/samples?at=P4')
    expect(virtualDemoHref('site', 'D1', spots)).toBe('/#virtual')
    expect(virtualDemoHref('other', 'P1', spots)).toBe('/#virtual')
  })

  it('times the search from the later of the last sighting and the (re)start', () => {
    expect(searchingSeconds(12, -Infinity, 10)).toBe(2) // never seen since the camera started
    expect(searchingSeconds(30, 20, 10)).toBe(10)
    expect(searchingSeconds(30, 5, 28)).toBe(2) // restarted after a long check: the clock starts again
    expect(SEARCH_TIPS_AFTER_S).toBe(5)
  })

  it('only offers the check where there is something to check against', () => {
    // Any sheet outside the demo list can be checked.
    expect(checkAvailability(D1)).toEqual({ enabled: true, note: null })
    expect(checkAvailability(L1)).toEqual({ enabled: true, note: null })
    expect(checkAvailability(A1)).toEqual({ enabled: true, note: null })
    expect(checkAvailability({ ...A1, anchor_id: 'P1' })).toEqual({ enabled: true, note: null }) // a P1 of another project
    // The building site shows the design in an empty car park: nothing there to check.
    const P1: Anchor = { ...L1, anchor_id: 'P1', project_id: 'site', position_m: [9, -2.5, 1.4] }
    expect(checkAvailability(P1).enabled).toBe(false)
    expect(checkAvailability({ ...P1, anchor_id: 'P4' }).note).toMatch(/nothing is built yet/)
    expect(checkAvailability({ ...P1, anchor_id: 'D1' }).enabled).toBe(false)
  })

  it('makes Walk inside the main action on iPhone/iPad for 1:1 floor codes only', () => {
    expect(isLifeSizeFloor(L1)).toBe(true)
    expect(isLifeSizeFloor(D1)).toBe(false) // desk: 1:20
    expect(isLifeSizeFloor(A1)).toBe(false) // wall
    expect(walkInsideFirst(L1, { quickLook: true, xrOk: false })).toBe(true)
    expect(walkInsideFirst(D1, { quickLook: true, xrOk: false })).toBe(false)
    expect(walkInsideFirst(A1, { quickLook: true, xrOk: false })).toBe(false) // upright viewpoints keep the camera overlay
    expect(walkInsideFirst(L1, { quickLook: false, xrOk: true })).toBe(false) // Android: Start AR stays primary
    expect(walkInsideFirst(L1, { quickLook: false, xrOk: false })).toBe(false)
  })
})

describe('arMath boundaries (mutation-tested)', () => {
  it('scales x and y separately when the detection frame has another aspect', () => {
    expect(toVideoPixels([{ x: 320, y: 240 }, { x: 0, y: 480 }], 640, 480, 1920, 1080)).toEqual([[960, 540], [0, 1080]])
  })

  it('flags the overlay only beyond 3 m, not at 3 m', () => {
    expect(isFar(3)).toBe(false)
    expect(isFar(3.01)).toBe(true)
    expect(isFar(0)).toBe(false)
  })

  it('switches to tips at exactly 5 s and coaches each state with its own words', () => {
    const lost = { tracking: false, provisional: true, distanceM: null, mode: 'lost' as const }
    expect(coachHint({ ...lost, searchingS: 5 }, false)).toBe("Can't find the code. Add more light, move within about 1 m and hold the phone steady.")
    expect(coachHint({ ...lost, searchingS: 4.9 }, true)).toBe('Point the camera at the QR code on the sheet.')
    expect(coachHint({ ...lost }, false)).toBe('Point the camera at the QR code.') // no search time yet
    expect(coachHint({ tracking: true, provisional: false, distanceM: 1, mode: 'motion' }, true))
      .toBe('Look around and up. Turn on the spot; point back at the code to re-align.')
    expect(coachHint({ tracking: true, provisional: true, distanceM: 1 }, true)).toBe('Hold the camera about 1 m from the code and keep it steady.')
    expect(coachHint({ tracking: true, provisional: true, distanceM: 1 }, false)).toBe('Move within about 1 m of the code, then step back slowly.')
    expect(coachHint({ tracking: true, provisional: false, distanceM: 4 }, true)).toBe('Move closer to the code for a more accurate overlay.')
    expect(coachHint({ tracking: true, provisional: false, distanceM: null }, false)).toBe('Aim at the area to check, then tap Check as-built.')
    expect(coachHint({ tracking: true, provisional: false, distanceM: 1.4 }, false, false))
      .toBe('Turn slowly on the spot and look up; point back at the code to re-align.')
  })

  it('treats a 0.999 scale as life size and labels small scales by their ratio', () => {
    expect(scaleLabel({ ...A1, scale: 0.999 })).toBe('Life size · 1:1')
    expect(scaleLabel({ ...A1, scale: 0.01 })).toBe('Scale model · 1:100')
    expect(isDeskAnchor({ ...A1, scale: 0.01 })).toBe(true) // site D1 at 1:100
    expect(isLifeSizeFloor({ ...L1, scale: 0.999 })).toBe(true)
    expect(isLifeSizeFloor({ ...L1, normal: [0, 0.44, 0.9] })).toBe(false) // a sheet leaning 25 degrees is not a floor code
  })
})

describe('site sheets (mutation-tested)', () => {
  it('disables the check on every live site sheet, P1 to P4 and D1', () => {
    for (const id of ['P1', 'P2', 'P3', 'P4', 'D1']) {
      const a: Anchor = { ...L1, anchor_id: id, project_id: 'site' }
      expect(checkAvailability(a), id).toEqual({
        enabled: false, note: 'This sheet shows the design where nothing is built yet, so there is nothing to check here.',
      })
    }
    expect(checkAvailability({ ...L1, anchor_id: 'P5', project_id: 'site' })).toEqual({ enabled: true, note: null })
  })
})
