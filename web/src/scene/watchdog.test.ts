import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrameWatchdog } from './watchdog'

afterEach(() => vi.useRealTimers())

describe('createFrameWatchdog', () => {
  it('reports a stall once after 1 s without frames, and again only after frames resume and stop', () => {
    vi.useFakeTimers()
    const onStall = vi.fn()
    const dog = createFrameWatchdog(onStall)
    dog.start()
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(100)
      dog.frame()
    }
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500) // the camera stopped delivering frames (call, app switch)
    expect(onStall).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(onStall).toHaveBeenCalledTimes(1)
    dog.frame()
    vi.advanceTimersByTime(1500)
    expect(onStall).toHaveBeenCalledTimes(2)
  })

  it('stays quiet while stopped (tracking is paused for a check)', () => {
    vi.useFakeTimers()
    const onStall = vi.fn()
    const dog = createFrameWatchdog(onStall)
    dog.start()
    dog.stop()
    vi.advanceTimersByTime(10_000)
    expect(onStall).not.toHaveBeenCalled()
    dog.start() // restarting resets the clock
    vi.advanceTimersByTime(800)
    expect(onStall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(onStall).toHaveBeenCalledTimes(1)
    dog.stop()
  })
})
