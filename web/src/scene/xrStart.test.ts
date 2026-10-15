import { afterEach, describe, expect, it, vi } from 'vitest'
import { XR_DESK_MESSAGE, XR_FAILED_MESSAGE, XR_WALK_NOTICE, endOnFailure, xrFallback } from './xrStart'
import { startXrPlace, type XrPlaceOptions } from './xrPlace'
import { startXrWalk, type XrWalkOptions } from './xrWalk'

// A renderer whose XR setup fails after the AR session has started (no WebGL in node anyway).
const { setSession } = vi.hoisted(() => ({ setSession: vi.fn<(s: unknown) => Promise<void>>() }))
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  class WebGLRenderer {
    xr = { enabled: false, setReferenceSpaceType: () => undefined, setSession }
    localClippingEnabled = false
    setPixelRatio(): void {}
    dispose(): void {}
  }
  return { ...three, WebGLRenderer }
})

const err = (name: string) => new DOMException('AR failed', name)

describe('Start AR fallback (audit A-09)', () => {
  it('ignores a second tap while a session is starting or running', () => {
    expect(xrFallback(err('InvalidStateError'), false)).toEqual({ kind: 'ignore' })
    expect(xrFallback(err('InvalidStateError'), true)).toEqual({ kind: 'ignore' })
  })

  it('falls back to Walk inside with a notice when the phone has no camera access in AR', () => {
    for (const name of ['NotSupportedError', 'NotAllowedError']) {
      expect(xrFallback(err(name), false)).toEqual({ kind: 'walk', notice: XR_WALK_NOTICE })
    }
  })

  it('never falls back to a 1:1 walk for a desk model', () => {
    for (const name of ['NotSupportedError', 'NotAllowedError']) {
      expect(xrFallback(err(name), true)).toEqual({ kind: 'message', message: XR_DESK_MESSAGE })
    }
  })

  it('explains any other failure instead of switching mode silently', () => {
    for (const e of [err('SecurityError'), new Error('WebGL context lost'), 'oops', null]) {
      expect(xrFallback(e, false)).toEqual({ kind: 'message', message: XR_FAILED_MESSAGE })
      expect(xrFallback(e, true)).toEqual({ kind: 'message', message: XR_FAILED_MESSAGE })
    }
  })

  it('says the walk model is not lined up with the code', () => {
    expect(XR_WALK_NOTICE).toMatch(/isn't lined up with the code/)
  })
})

describe('ending the AR session when setup fails', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setSession.mockReset()
  })

  function fakeXr() {
    const session = { end: vi.fn(() => Promise.resolve()), addEventListener: vi.fn(), enabledFeatures: [] as string[] }
    const xr = { requestSession: vi.fn(() => Promise.resolve(session)), isSessionSupported: vi.fn(() => Promise.resolve(true)) }
    vi.stubGlobal('navigator', { xr })
    vi.stubGlobal('document', { createElement: () => ({}) })
    vi.stubGlobal('window', { devicePixelRatio: 1 })
    return { session, xr }
  }

  it('endOnFailure ends the session once and rethrows', async () => {
    const session = { end: vi.fn(() => Promise.resolve()) }
    await expect(endOnFailure(session, () => Promise.reject(new Error('setup')))).rejects.toThrow('setup')
    expect(session.end).toHaveBeenCalledTimes(1)
    await expect(endOnFailure(session, () => Promise.resolve(7))).resolves.toBe(7)
    expect(session.end).toHaveBeenCalledTimes(1)
  })

  it('endOnFailure still rethrows the setup error when end() fails too', async () => {
    const session = { end: vi.fn(() => Promise.reject(new Error('already ended'))) }
    await expect(endOnFailure(session, () => Promise.reject(new Error('setup')))).rejects.toThrow('setup')
  })

  it('place by code: setSession throws, the session is ended once', async () => {
    const { session, xr } = fakeXr()
    setSession.mockRejectedValue(new Error('no XR framebuffer'))
    await expect(startXrPlace({ overlay: {} } as unknown as XrPlaceOptions)).rejects.toThrow('no XR framebuffer')
    expect(xr.requestSession).toHaveBeenCalledTimes(1)
    expect(session.end).toHaveBeenCalledTimes(1)
  })

  it('walk inside: setSession throws, the session is ended once', async () => {
    const { session } = fakeXr()
    setSession.mockRejectedValue(new Error('no XR framebuffer'))
    await expect(startXrWalk({ overlay: {} } as unknown as XrWalkOptions)).rejects.toThrow('no XR framebuffer')
    expect(session.end).toHaveBeenCalledTimes(1)
  })
})
