/**
 * WebGL context lifecycle (audit A-56, A-64). iPad Safari caps how many WebGL contexts a page can hold, so a
 * context is released as soon as its view goes, not at garbage collection; and a context that is lost for good
 * gets a reload prompt instead of a silent blank canvas.
 */
import { type WebGLRenderer } from 'three'

export const CONTEXT_LOST_MESSAGE = 'The 3D view stopped. Tap to reload.'
/** three restores a recoverable loss itself; no restore by then means the context is gone for good. */
export const CONTEXT_RESTORE_GRACE_MS = 5000

/** Free the renderer's GPU resources and its WebGL context now. The renderer can't be used afterwards. */
export function releaseRenderer(renderer: Pick<WebGLRenderer, 'dispose' | 'forceContextLoss'>): void {
  renderer.dispose()
  renderer.forceContextLoss()
}

/**
 * A new canvas in `host` (replacing any earlier one) for one renderer. A context dropped with forceContextLoss
 * stays lost on its canvas, so a page that starts a renderer again (retry, camera restart, StrictMode's second
 * mount) needs a new canvas each time. React renders `host` empty and never touches its children.
 */
export function freshCanvas(host: HTMLElement, className: string, label: string): HTMLCanvasElement {
  const canvas = host.ownerDocument.createElement('canvas')
  canvas.className = className
  canvas.setAttribute('aria-label', label)
  host.replaceChildren(canvas)
  return canvas
}

/**
 * Calls `onDead` once when the canvas loses its WebGL context and it isn't restored within `graceMs`.
 * Returns a function that stops watching; call it before releasing the renderer (forceContextLoss fires the event).
 */
export function watchContextLoss(canvas: EventTarget, onDead: () => void, graceMs = CONTEXT_RESTORE_GRACE_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let dead = false
  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const onLost = () => {
    if (dead || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      dead = true
      onDead()
    }, graceMs)
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', clear)
  return () => {
    clear()
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webglcontextrestored', clear)
  }
}
