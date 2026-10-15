// QrWorkerClient against a fake Worker: a dead or failing reader must never leave a frame pending.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QrRequest, QrResponse } from './protocol'
import { QrWorkerClient } from './qrClient'

class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((e: MessageEvent<QrResponse>) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessageerror: ((e: MessageEvent) => void) | null = null
  sent: QrRequest[] = []
  terminated = false
  constructor() {
    FakeWorker.last = this
  }
  postMessage(req: QrRequest): void {
    this.sent.push(req)
  }
  terminate(): void {
    this.terminated = true
  }
  reply(res: QrResponse): void {
    this.onmessage?.({ data: res } as MessageEvent<QrResponse>)
  }
}

const frame = () => ({ width: 4, height: 2, data: new Uint8ClampedArray(32) }) as unknown as ImageData

beforeEach(() => vi.stubGlobal('Worker', FakeWorker))
afterEach(() => vi.unstubAllGlobals())

describe('QrWorkerClient', () => {
  it('resolves pending frames with no detection when the worker dies, and answers later frames at once', async () => {
    const qr = new QrWorkerClient()
    const worker = FakeWorker.last!
    const pending = qr.detect(frame())
    expect(qr.busy).toBe(true)
    worker.onerror?.(new Event('error')) // e.g. the worker chunk failed to load
    const res = await pending
    expect(res.detection).toBeNull()
    expect(res.error).toBeTruthy()
    expect(qr.busy).toBe(false)
    expect(qr.failed).toBe(true)

    const later = await qr.detect(frame())
    expect(later.detection).toBeNull()
    expect(qr.busy).toBe(false)
    expect(worker.sent).toHaveLength(1) // nothing more is posted to a dead worker
  })

  it('treats messageerror like a dead worker', async () => {
    const qr = new QrWorkerClient()
    const pending = qr.detect(frame())
    FakeWorker.last!.onmessageerror?.(new MessageEvent('messageerror'))
    expect((await pending).detection).toBeNull()
    expect(qr.busy).toBe(false)
    expect(qr.failed).toBe(true)
  })

  it('reports failed while the worker answers with a load error, and clears it once a frame decodes', async () => {
    const qr = new QrWorkerClient()
    const worker = FakeWorker.last!
    const a = qr.detect(frame())
    worker.reply({ id: worker.sent[0].id, ms: 1, detection: null, buffer: new ArrayBuffer(0), error: 'failed to fetch' })
    await a
    expect(qr.failed).toBe(true)
    const b = qr.detect(frame())
    worker.reply({ id: worker.sent[1].id, ms: 1, detection: null, buffer: new ArrayBuffer(0) })
    await b
    expect(qr.failed).toBe(false)
  })
})
