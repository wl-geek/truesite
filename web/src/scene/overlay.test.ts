import { describe, expect, it } from 'vitest'
import { LOOK_AROUND_MAX_S } from './motion'
import { holdBySensors } from './overlay'

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
