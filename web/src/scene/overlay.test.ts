import { describe, expect, it } from 'vitest'
import { deviceRotation, LOOK_AROUND_MAX_S } from './motion'
import { feedsFusion, holdBySensors, lookAroundExpired } from './overlay'

describe('holdBySensors (audit B-03)', () => {
  const lock = { tSec: 10 }

  it('holds the model with the sensors 0.2 s after the last detection, before look-around mode starts at 0.5 s', () => {
    expect(holdBySensors('code', 10.2, 10, lock, true)).toBe(true)
  })

  it('leaves the model on the code while detections are fresh', () => {
    expect(holdBySensors('code', 10.1, 10, lock, true)).toBe(false)
  })

  it('needs a lock and the motion sensors', () => {
    expect(holdBySensors('code', 10.2, 10, null, true)).toBe(false)
    expect(holdBySensors('code', 10.2, 10, lock, false)).toBe(false)
  })

  it('does not hold by a lock older than the look-around limit', () => {
    expect(holdBySensors('code', 10 + LOOK_AROUND_MAX_S + 1, 10 + LOOK_AROUND_MAX_S, lock, true)).toBe(false)
  })

  it('keeps holding in look-around mode, and never while lost (the model is hidden)', () => {
    expect(holdBySensors('motion', 12, 10, lock, true)).toBe(true)
    expect(holdBySensors('lost', 10.2, 10, lock, true)).toBe(false)
  })
})

describe('feedsFusion (audit C-02)', () => {
  const D = (deg: number) => deviceRotation(deg, 90, 0)
  const turning = (degS: number) => Array.from({ length: 10 }, (_, i) => ({ tMs: i * 67, D: D((degS * i * 67) / 1000) }))

  it('feeds detections to the fusion while the device is still or turns slowly (stepping back with the code in view)', () => {
    expect(feedsFusion(turning(0))).toBe(true)
    expect(feedsFusion(turning(5))).toBe(true)
  })

  it('leaves out detections made during a fast turn: their motion sample is from a slightly different moment', () => {
    expect(feedsFusion(turning(30))).toBe(false) // the filming pace
  })
})

describe('lookAroundExpired (audit C-14)', () => {
  it('flags the look-around timeout once the code has been gone for the limit, with the sensors holding the model', () => {
    expect(lookAroundExpired(true, true, 10 + LOOK_AROUND_MAX_S, 10)).toBe(true)
    expect(lookAroundExpired(true, true, 10 + LOOK_AROUND_MAX_S - 0.1, 10)).toBe(false)
  })

  it('is not a timeout without the sensors, or when they never held the model (the plain 5 s search tips apply)', () => {
    expect(lookAroundExpired(false, true, 200, 10)).toBe(false)
    expect(lookAroundExpired(true, false, 200, 10)).toBe(false)
  })
})
