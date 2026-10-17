import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { checkErrorMessage, readyMadeErrorMessage, savedFallbackMessage, toCheckError } from './messages'

describe('checkErrorMessage', () => {
  it('explains each failure plainly', () => {
    expect(checkErrorMessage({ status: 0, code: 'nothing_visible' })).toMatch(/None of the model/)
    expect(checkErrorMessage({ status: 0, code: 'no_pose' })).toBe('Keep the code in view when you take the photo.')
    expect(checkErrorMessage({ status: 429, code: 'rate_limited', retryAfterS: 600 })).toBe('Too many checks from this network. Try again in about 10 min.')
    expect(checkErrorMessage({ status: 429, code: 'daily_cap' }))
      .toBe("Today's free Gemini use is used up. Try the ready-made views (saved results), or come back tomorrow.")
    expect(checkErrorMessage({ status: 429, code: 'model_quota', retryAfterS: 38 })).toBe("Gemini's usage limit is reached. Try again in about 1 min.")
    expect(checkErrorMessage({ status: 503, code: 'model_unavailable' })).toBe('Gemini is busy right now. Try again in a minute.')
    expect(checkErrorMessage({ status: 500, code: 'internal' })).toBe('Check failed. Try again.')
    expect(checkErrorMessage({ status: 0, code: 'network' })).toMatch(/No connection/)
  })

  it('does not blame the network for timeouts or failures on the device', () => {
    expect(checkErrorMessage({ status: 0, code: 'timeout' })).toMatch(/too long/)
    expect(checkErrorMessage({ status: 0, code: 'timeout' })).not.toMatch(/connection|network/i)
    expect(checkErrorMessage(toCheckError(new Error('2D canvas is not available')))).not.toMatch(/connection|network/i)
    expect(checkErrorMessage({ status: 0 })).not.toMatch(/No connection/)
  })

  it('keeps API errors and turns anything else into a local error', () => {
    const api = new ApiError('rate_limited', 429, 'rate_limited')
    expect(toCheckError(api)).toBe(api)
    const local = toCheckError(new Error('The camera is not ready yet.'))
    expect(local).toBeInstanceOf(ApiError)
    expect(local.status).toBe(0)
    expect(local.code).toBe('local')
  })
})

describe('readyMadeErrorMessage (audit C-25)', () => {
  it("on the ready-made views, the daily cap says saved results still show, without pointing to the page it's on", () => {
    const capped = readyMadeErrorMessage({ status: 429, code: 'daily_cap' })
    expect(capped).toBe("Today's check limit has been reached. Saved results still show where a view has one; come back tomorrow for a new check.")
    expect(capped).not.toMatch(/sample photos|ready-made/i)
  })

  it('says the same as the check for everything else', () => {
    for (const err of [{ status: 429, code: 'rate_limited', retryAfterS: 600 }, { status: 503, code: 'model_unavailable' }, { status: 0, code: 'network' }, { status: 500 }]) {
      expect(readyMadeErrorMessage(err)).toBe(checkErrorMessage(err))
    }
  })
})

describe('savedFallbackMessage', () => {
  it('says why the sample shows its saved result instead of a live check', () => {
    expect(savedFallbackMessage({ status: 429, code: 'rate_limited', retryAfterS: 600 }))
      .toBe("Too many checks from this network, so Gemini didn't run. Showing the last real result for this photo. Try again in about 10 min.")
    expect(savedFallbackMessage({ status: 429, code: 'daily_cap' })).toMatch(/^Today's free Gemini use is used up.*last real result/)
    expect(savedFallbackMessage({ status: 429, code: 'model_quota', retryAfterS: 60 })).toMatch(/^Gemini's usage limit is reached.*last real result.*about 1 min/)
    expect(savedFallbackMessage({ status: 0, code: 'network' })).toMatch(/^No connection.*last real result/)
    expect(savedFallbackMessage({ status: 0, code: 'timeout' })).toMatch(/^The check took too long.*last real result/)
    for (const status of [500, 502, 503]) expect(savedFallbackMessage({ status, code: 'model_unavailable' })).toMatch(/^Gemini couldn't run the check.*last real result/)
  })
})

describe('check messages (mutation-tested)', () => {
  it('says "later" when the server gives no wait, and rounds a wait up to whole minutes', () => {
    expect(checkErrorMessage({ status: 429, code: 'rate_limited' })).toBe('Too many checks from this network. Try again later.')
    expect(checkErrorMessage({ status: 429, code: 'rate_limited', retryAfterS: 90 })).toBe('Too many checks from this network. Try again in about 2 min.')
    expect(checkErrorMessage({ status: 429, code: 'rate_limited', retryAfterS: 5 })).toBe('Too many checks from this network. Try again in about 1 min.')
  })

  it('asks for another view when Gemini refuses the photo', () => {
    expect(checkErrorMessage({ status: 422, code: 'model_blocked' })).toBe("This photo couldn't be checked. Try a different view.")
  })

  it('blames the server only for 5xx when a sample falls back to its saved result', () => {
    expect(savedFallbackMessage({ status: 400, code: 'bad_request' })).toBe("The live check didn't run. Showing the last real result for this photo.")
    expect(savedFallbackMessage({ status: 500 })).toBe("Gemini couldn't run the check right now. Showing the last real result for this photo.")
    expect(savedFallbackMessage({ status: 429, code: 'rate_limited' }))
      .toBe("Too many checks from this network, so Gemini didn't run. Showing the last real result for this photo. Try again later.")
  })
})
