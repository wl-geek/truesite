import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { UNKNOWN_ANCHOR_MESSAGE, isUnknownProject, liveLoadErrorMessage } from './liveFormat'

describe('live page load errors', () => {
  it('says an unknown project is a QR problem, not a connection problem', () => {
    const err = new ApiError('unknown_project', 404, 'unknown_project')
    expect(isUnknownProject(err)).toBe(true)
    const msg = liveLoadErrorMessage(err)
    expect(msg).toMatch(/QR code/)
    expect(msg).not.toMatch(/connection|network/i)
  })

  it('keeps the unknown-anchor message', () => {
    expect(liveLoadErrorMessage(new Error(UNKNOWN_ANCHOR_MESSAGE))).toBe(UNKNOWN_ANCHOR_MESSAGE)
    expect(isUnknownProject(new Error(UNKNOWN_ANCHOR_MESSAGE))).toBe(false)
  })

  it('blames the connection for everything else', () => {
    for (const err of [new ApiError('Network error', 0, 'network'), new ApiError('HTTP 502', 502), new TypeError('x'), 'boom']) {
      expect(isUnknownProject(err)).toBe(false)
      expect(liveLoadErrorMessage(err)).toBe("Couldn't load the project. Check your connection and try again.")
    }
  })
})

describe('live page load errors (mutation-tested)', () => {
  it('says the code is not set up, which is not a connection problem', () => {
    const msg = liveLoadErrorMessage(new Error(UNKNOWN_ANCHOR_MESSAGE))
    expect(msg).toMatch(/QR code/)
    expect(msg).not.toMatch(/connection|network/i)
  })

  it('never shows a blank message for an error without one', () => {
    expect(liveLoadErrorMessage(new Error(''))).toBe("Couldn't load the project. Check your connection and try again.")
  })
})
