// Camera start and interruption handling, with fakes for the browser objects.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRearCamera, watchCamera } from './camera'

afterEach(() => vi.unstubAllGlobals())

describe('startRearCamera', () => {
  it('stops the stream when the video refuses to play', async () => {
    const track = { stop: vi.fn(), getSettings: () => ({}) }
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
    vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 })
    const video = {
      readyState: 1, muted: false, srcObject: null as unknown, videoWidth: 1920, videoHeight: 1080,
      setAttribute: () => undefined, addEventListener: () => undefined,
      play: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    }
    await expect(startRearCamera(video as unknown as HTMLVideoElement)).rejects.toThrow()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })
})

describe('watchCamera', () => {
  function fakes() {
    const track = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const video = { paused: true, play: vi.fn(() => Promise.resolve()) }
    return { track, doc, video }
  }

  it('reports a track that ended (another app took the camera)', () => {
    const { track, doc, video } = fakes()
    const onEnded = vi.fn()
    watchCamera(track as MediaStreamTrack, doc as unknown as Document, video as unknown as HTMLVideoElement, onEnded)
    track.dispatchEvent(new Event('ended'))
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('resumes a paused video when the page is visible again', () => {
    const { track, doc, video } = fakes()
    watchCamera(track as MediaStreamTrack, doc as unknown as Document, video as unknown as HTMLVideoElement, vi.fn())
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(video.play).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('stops listening once unwatched', () => {
    const { track, doc, video } = fakes()
    const onEnded = vi.fn()
    const unwatch = watchCamera(track as MediaStreamTrack, doc as unknown as Document, video as unknown as HTMLVideoElement, onEnded)
    unwatch()
    track.dispatchEvent(new Event('ended'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(onEnded).not.toHaveBeenCalled()
    expect(video.play).not.toHaveBeenCalled()
  })
})
