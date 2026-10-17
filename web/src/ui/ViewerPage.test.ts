import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { viewerLoadError } from './ViewerPage'

describe('viewerLoadError (audit C-34)', () => {
  it("says an unknown project doesn't exist, with no Try again, instead of blaming the connection", () => {
    const e = viewerLoadError(new ApiError('unknown_project', 404, 'unknown_project'))
    expect(e).toEqual({ message: "This link points to a project TrueSite doesn't have.", unknownProject: true })
    expect(e.message).not.toMatch(/connection|try again/i)
  })

  it('keeps Try again for anything else', () => {
    for (const err of [new ApiError('network', 0, 'network'), new ApiError('HTTP 500', 500), new Error('WebGL'), 'oops']) {
      expect(viewerLoadError(err)).toEqual({ message: "Couldn't load the model. Check your connection and try again.", unknownProject: false })
    }
  })
})
