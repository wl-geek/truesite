import type { QrRequest, QrResponse } from './protocol'

/**
 * Promise wrapper around the zxing QR worker. Use "latest frame wins": skip a camera frame
 * while `busy` instead of queueing, so a slow frame never builds up lag.
 */
export class QrWorkerClient {
  private readonly worker: Worker
  private nextId = 1
  private readonly pending = new Map<number, (r: QrResponse) => void>()

  constructor() {
    // Must stay a literal `new Worker(new URL(...), { type: 'module' })` so Vite bundles the worker.
    this.worker = new Worker(new URL('./zxing.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<QrResponse>) => {
      const cb = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      cb?.(e.data)
    }
  }

  get busy(): boolean {
    return this.pending.size > 0
  }

  /** Transfers img.data.buffer to the worker (img becomes unusable); the response carries it back. */
  detect(img: ImageData): Promise<QrResponse> {
    const id = this.nextId++
    const req: QrRequest = { id, width: img.width, height: img.height, buffer: img.data.buffer as ArrayBuffer }
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage(req, [req.buffer])
    })
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}
