// The snapshot's pose inputs: a bounded wait for the QR reader, only this anchor's corners, and the fallbacks.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pose } from '../pose'
import type { QrDetection, QrResponse } from '../qr/protocol'
import { anchorCorners, fallbackPose, readFullFrame, snapshotQuality } from './snapshot'

const ORIGIN = 'http://localhost:5173'
const ANCHOR = { project_id: 'room1', anchor_id: 'A1' }
const CORNERS: QrDetection['corners'] = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]
const frame = () => ({ width: 4, height: 2, data: new Uint8ClampedArray(32) }) as unknown as ImageData

function stubQr(text: string | null, busy = false) {
  const detection: QrDetection | null = text === null ? null : { text, corners: CORNERS, version: 2, dimension: 25 }
  return {
    busy,
    detect: vi.fn(async (): Promise<QrResponse> => ({ id: 1, ms: 5, detection, buffer: new ArrayBuffer(0) })),
  }
}

afterEach(() => vi.useRealTimers())

describe('readFullFrame', () => {
  it('gives up after about 1 s when the reader stays busy, without posting the frame', async () => {
    vi.useFakeTimers()
    const qr = stubQr('https://truesite.test/a/room1/A1', true)
    let done = false
    const p = readFullFrame(qr, frame()).then((d) => {
      done = true
      return d
    })
    await vi.advanceTimersByTimeAsync(900)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(done).toBe(true)
    expect(await p).toBeNull()
    expect(qr.detect).not.toHaveBeenCalled()
  })

  it('reads the frame once the reader is free', async () => {
    const qr = stubQr('https://truesite.test/a/room1/A1')
    expect((await readFullFrame(qr, frame()))?.text).toBe('https://truesite.test/a/room1/A1')
    expect(qr.detect).toHaveBeenCalledTimes(1)
  })
})

describe('anchorCorners', () => {
  it('ignores a foreign code in the frame and keeps this anchor\'s corners', async () => {
    const read = async (text: string) => {
      const d = await readFullFrame(stubQr(text), frame())
      return anchorCorners({ text: d?.text ?? null, corners: d?.corners ?? null }, ANCHOR, ORIGIN)
    }
    expect(await read('PERMIT-2026-0417')).toBeNull()
    expect(await read('https://truesite.test/a/room1/D1')).toBeNull() // another anchor of this project
    expect(await read('https://truesite.test/a/rooftop/A1')).toBeNull() // same anchor id, other project
    expect(await read('https://truesite.test/a/room1/A1')).toEqual(CORNERS)
    expect(anchorCorners({ text: null, corners: null }, ANCHOR, ORIGIN)).toBeNull()
  })
})

describe('fallbackPose', () => {
  const pose: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 1] }
  it('uses the last pose only if it was seen within 0.5 s of the tap', () => {
    expect(fallbackPose({ pose, tSec: 10 }, 10.4)).toBe(pose)
    expect(fallbackPose({ pose, tSec: 10 }, 10.6)).toBeNull()
    expect(fallbackPose(null, 10)).toBeNull()
  })
})

describe('snapshotQuality', () => {
  it('caps an ambiguous estimate at fair unless the tracker had a trusted pose', () => {
    expect(snapshotQuality({ quality: 'good', ambiguous: true }, false)).toBe('fair')
    expect(snapshotQuality({ quality: 'good', ambiguous: true }, true)).toBe('good')
    expect(snapshotQuality({ quality: 'good', ambiguous: false }, false)).toBe('good')
    expect(snapshotQuality({ quality: 'poor', ambiguous: true }, false)).toBe('poor')
  })
})
