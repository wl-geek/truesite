import type { QrRequest, QrResponse } from './protocol'

/**
 * Promise wrapper around the zxing QR worker. Use "latest frame wins": skip a camera frame
 * while `busy` instead of queueing, so a slow frame never builds up lag.
 *
 * Every detect() resolves: if the worker dies (its chunk failed to load, a message can't be read),
 * pending and later frames answer "no detection" at once and `failed` is set.
 */
export class QrWorkerClient {
  private readonly worker: Worker
  private nextId = 1
  private readonly pending = new Map<number, (r: QrResponse) => void>()
  private dead: string | null = null
  private lastError: string | null = null

  constructor() {
    // Must stay a literal `new Worker(new URL(...), { type: 'module' })` so Vite bundles the worker.
    this.worker = new Worker(new URL('./zxing.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<QrResponse>) => {
      this.lastError = e.data.error ?? null
      const cb = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      cb?.(e.data)
    }
    this.worker.onerror = () => this.fail('The QR reader stopped.')
    this.worker.onmessageerror = () => this.fail('The QR reader sent an unreadable message.')
  }

  get busy(): boolean {
    return this.pending.size > 0
  }

  /** The reader can't decode right now: the worker died, or its last answer was a load error (it retries on the next frame). */
  get failed(): boolean {
    return this.dead !== null || this.lastError !== null
  }

  /** Transfers img.data.buffer to the worker (img becomes unusable); the response carries it back. */
  detect(img: ImageData): Promise<QrResponse> {
    const id = this.nextId++
    const buffer = img.data.buffer as ArrayBuffer
    if (this.dead !== null) return Promise.resolve({ id, ms: 0, detection: null, buffer, error: this.dead })
    const req: QrRequest = { id, width: img.width, height: img.height, buffer }
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage(req, [req.buffer])
    })
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }

  private fail(error: string): void {
    this.dead = error
    for (const [id, cb] of this.pending) cb({ id, ms: 0, detection: null, buffer: new ArrayBuffer(0), error })
    this.pending.clear()
  }
}
