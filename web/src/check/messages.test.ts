import { describe, expect, it } from 'vitest'
import { checkErrorMessage } from './messages'

describe('checkErrorMessage', () => {
  it('explains each failure plainly', () => {
    expect(checkErrorMessage({ status: 0, code: 'nothing_visible' })).toMatch(/None of the model/)
    expect(checkErrorMessage({ status: 0, code: 'no_pose' })).toBe('Keep the code in view when you take the photo.')
    expect(checkErrorMessage({ status: 429, code: 'rate_limited', retryAfterS: 600 })).toBe('Too many checks from this network. Try again in about 10 min.')
    expect(checkErrorMessage({ status: 429, code: 'daily_cap' })).toMatch(/sample photos/)
    expect(checkErrorMessage({ status: 503, code: 'model_unavailable' })).toBe('Check failed — try again.')
    expect(checkErrorMessage({ status: 0 })).toMatch(/No connection/)
  })
})
