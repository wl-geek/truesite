import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { idBufferSize, poseDistance, shouldUseSaved, storedRunId } from './runCheck'
import { photoSize } from './snapshot'

describe('runCheck helpers', () => {
  it('falls back to the saved result only for samples, on network, limit and server/model failures', () => {
    for (const status of [0, 429, 500, 502, 503, 504]) expect(shouldUseSaved(new ApiError('x', status), 'room1-door')).toBe(true)
    expect(shouldUseSaved(new ApiError('x', 500, 'model_bad_request'), 'room1-door')).toBe(true) // Gemini key revoked, model retired
    expect(shouldUseSaved(new ApiError('x', 503))).toBe(false)
    for (const status of [400, 404, 413, 422]) expect(shouldUseSaved(new ApiError('x', status), 'room1-door')).toBe(false)
  })

  it('keeps the run id only when the run was stored (issues need a stored run)', () => {
    expect(storedRunId({ run_id: 'r1', saved: true })).toBe('r1')
    expect(storedRunId({ run_id: 'r1', saved: false })).toBeNull()
    expect(storedRunId(null)).toBeNull()
  })

  it('sizes the ID buffer at 640 px wide with the video aspect', () => {
    expect(idBufferSize(1920, 1080)).toEqual({ w: 640, h: 360 })
    expect(idBufferSize(1080, 1920)).toEqual({ w: 640, h: 1138 })
  })

  it('keeps the photo long side at 1600 px or less, same aspect', () => {
    expect(photoSize(1920, 1080)).toEqual({ w: 1600, h: 900 })
    expect(photoSize(1280, 720)).toEqual({ w: 1280, h: 720 })
    expect(photoSize(1080, 1920)).toEqual({ w: 900, h: 1600 })
  })

  it('reports the camera-to-code distance, clamped for the API', () => {
    expect(poseDistance({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0.3, 0.4, 1.2] })).toBe(1.3)
    expect(poseDistance({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 80] })).toBe(50)
  })
})
