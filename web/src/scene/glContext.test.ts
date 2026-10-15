import { PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_RESTORE_GRACE_MS, releaseRenderer, watchContextLoss } from './glContext'

afterEach(() => vi.useRealTimers())

describe('releaseRenderer (audit A-56)', () => {
  it('disposes the renderer, then drops its WebGL context', () => {
    const calls: string[] = []
    releaseRenderer({ dispose: () => calls.push('dispose'), forceContextLoss: () => calls.push('forceContextLoss') })
    expect(calls).toEqual(['dispose', 'forceContextLoss'])
  })
})

describe('watchContextLoss (audit A-64)', () => {
  const lose = (t: EventTarget) => t.dispatchEvent(new Event('webglcontextlost'))
  const restore = (t: EventTarget) => t.dispatchEvent(new Event('webglcontextrestored'))

  it('reports a loss that is not restored within about 5 s, once', () => {
    vi.useFakeTimers()
    const canvas = new EventTarget()
    const onDead = vi.fn()
    watchContextLoss(canvas, onDead)
    lose(canvas)
    vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS - 1)
    expect(onDead).not.toHaveBeenCalled()
    lose(canvas) // a second event doesn't restart the clock
    vi.advanceTimersByTime(1)
    expect(onDead).toHaveBeenCalledTimes(1)
    lose(canvas)
    vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS * 2)
    expect(onDead).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when three restores the context in time', () => {
    vi.useFakeTimers()
    const canvas = new EventTarget()
    const onDead = vi.fn()
    watchContextLoss(canvas, onDead)
    lose(canvas)
    vi.advanceTimersByTime(2000)
    restore(canvas)
    vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS * 2)
    expect(onDead).not.toHaveBeenCalled()
  })

  it('stops watching once unsubscribed (before the renderer is released on purpose)', () => {
    vi.useFakeTimers()
    const canvas = new EventTarget()
    const onDead = vi.fn()
    const stop = watchContextLoss(canvas, onDead)
    lose(canvas)
    stop() // a pending timer is cleared too
    lose(canvas)
    vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS * 2)
    expect(onDead).not.toHaveBeenCalled()
  })
})

describe('OrbitControls keydown listener (why ViewerPage disposes in a layout effect, audit A-56)', () => {
  // A canvas whose root node is the document while attached and itself once React has removed it.
  function fakeCanvas(doc: EventTarget) {
    const el = Object.assign(new EventTarget(), { style: {} as Record<string, string>, ownerDocument: doc, attached: true })
    return Object.assign(el, { getRootNode: () => (el.attached ? doc : el) })
  }

  it('is removed from the document only when disposed while the canvas is still attached', () => {
    for (const attached of [true, false]) {
      const doc = new EventTarget()
      const add = vi.spyOn(doc, 'addEventListener')
      const remove = vi.spyOn(doc, 'removeEventListener')
      const canvas = fakeCanvas(doc)
      const controls = new OrbitControls(new PerspectiveCamera(), canvas as unknown as HTMLElement)
      expect(add.mock.calls.some(([type]) => type === 'keydown')).toBe(true)
      remove.mockClear() // connect() disconnects first
      canvas.attached = attached
      controls.dispose()
      expect(remove.mock.calls.some(([type]) => type === 'keydown')).toBe(attached)
    }
  })
})
