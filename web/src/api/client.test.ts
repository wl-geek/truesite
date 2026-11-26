import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError, ask, createIssue, draftIssue, fetchRunImage, getProject, getRun, getSavedResult, listIssues, listRuns, postCheck,
  reviewFinding, takeEvents, writeReport,
} from './client'
import type { CheckContext } from './types'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Call = { url: string; init: RequestInit }
let calls: Call[] = []

function mockFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(respond(url, init))
  }))
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('expected an ApiError')
}

const CTX: CheckContext = {
  project_id: 'room1', anchor_id: 'A1', pose_quality: 'good', distance_m: 1.8,
  visible: [{ mark: 1, guid: '2O2Fr$t4X7Zf8NOew3FLOH', ifc_class: 'IfcWall', name: 'Partition P-01',
    box: [100, 50, 900, 400], key_dims: '100 mm thick' }],
}

describe('api client', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.unstubAllGlobals())

  it('sends X-Session-Id on every call and returns the JSON body', async () => {
    mockFetch(() => jsonResponse(200, { project_id: 'room1', name: 'Demo room' }))
    const p = await getProject('room1')
    expect(p.name).toBe('Demo room')
    expect(calls[0].url).toBe('/api/projects/room1')
    expect(new Headers(calls[0].init.headers).get('X-Session-Id')).toMatch(UUID_V4)
  })

  it('parses detail.code and detail.retry_after_s', async () => {
    mockFetch(() => jsonResponse(429, { detail: { code: 'rate_limited', retry_after_s: 120 } }, { 'Retry-After': '120' }))
    const err = await caught(getProject('room1'))
    expect([err.status, err.code, err.retryAfterS, err.message]).toEqual([429, 'rate_limited', 120, 'rate_limited'])
  })

  it('falls back to the Retry-After header', async () => {
    mockFetch(() => jsonResponse(503, { detail: { code: 'busy' } }, { 'Retry-After': '2' }))
    const err = await caught(ask({ project_id: 'room1', guid: 'g', question: 'q' }))
    expect([err.status, err.code, err.retryAfterS]).toEqual([503, 'busy', 2])
  })

  it('keeps string details and survives non-JSON error bodies', async () => {
    mockFetch(() => jsonResponse(404, { detail: 'Not Found' }))
    const notFound = await caught(getSavedResult('room1-door'))
    expect([notFound.status, notFound.code, notFound.message]).toEqual([404, undefined, 'Not Found'])
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    const bad = await caught(getProject('room1'))
    expect([bad.status, bad.code, bad.message, bad.retryAfterS]).toEqual([502, undefined, 'HTTP 502', undefined])
  })

  it('uses the first validation message for 422 lists', async () => {
    mockFetch(() => jsonResponse(422, { detail: [{ loc: ['body', 'title'], msg: 'String should have at least 1 character' }] }))
    const err = await caught(createIssue({ project_id: 'room1', guid: 'g', title: '' }))
    expect([err.status, err.code, err.message]).toEqual([422, undefined, 'String should have at least 1 character'])
  })

  it('reports network failures as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const err = await caught(listIssues('room1'))
    expect([err.status, err.code]).toEqual([0, 'network'])
  })

  it('times a check out after 120 s', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    let settled = false
    const p = caught(postCheck(new Blob(['j']), new Blob(['p']), CTX)).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const err = await p
    expect([err.status, err.code]).toEqual([0, 'timeout'])
  })

  it('posts the check as multipart with photo, render and context', async () => {
    mockFetch(() => jsonResponse(200, { run_id: 'r1', saved: true, photo_url: null, result: {} }))
    const res = await postCheck(new Blob(['jpeg'], { type: 'image/jpeg' }), new Blob(['png'], { type: 'image/png' }), CTX)
    expect(res.run_id).toBe('r1')
    const { url, init } = calls[0]
    expect([url, init.method]).toEqual(['/api/check', 'POST'])
    const form = init.body as FormData
    expect((form.get('photo') as File).name).toBe('photo.jpg')
    expect((form.get('render') as File).name).toBe('render.png')
    expect(JSON.parse(form.get('context') as string)).toEqual(CTX)
  })

  it('posts JSON for ask, drafts and issues, and queries issues by project', async () => {
    mockFetch(() => jsonResponse(200, {}))
    await ask({ project_id: 'room1', guid: 'g', question: 'Fire rating?' })
    await draftIssue({ run_id: 'r1', mark: 3 })
    await createIssue({ project_id: 'room1', guid: 'g', title: 'Door about 30 cm left' })
    await listIssues('room1')
    expect(calls.map((c) => [c.url, c.init.method ?? 'GET'])).toEqual([
      ['/api/ask', 'POST'], ['/api/issues/draft', 'POST'], ['/api/issues', 'POST'], ['/api/issues?project_id=room1', 'GET'],
    ])
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ run_id: 'r1', mark: 3 })
  })

  it('lists issues from every project when no project is given', async () => {
    mockFetch(() => jsonResponse(200, { issues: [], demo: [] }))
    await listIssues()
    await listIssues('rooftop')
    expect(calls.map((c) => c.url)).toEqual(['/api/issues', '/api/issues?project_id=rooftop'])
  })

  it('fetches run images with the session header and returns an object URL', async () => {
    mockFetch(() => new Response(new Blob(['jpeg']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
    const url = await fetchRunImage('r1', 'photo.jpg')
    expect(url).toMatch(/^blob:/)
    expect(calls[0].url).toBe('/api/runs/r1/photo.jpg')
    expect(new Headers(calls[0].init.headers).get('X-Session-Id')).toMatch(UUID_V4)
    URL.revokeObjectURL(url)
  })
})

describe('api client (mutation-tested)', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A fetch that never answers, only rejects when aborted (the timeout). */
  function hangingFetch() {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
  }

  async function timesOutAfter(call: () => Promise<unknown>, ms: number) {
    vi.useFakeTimers()
    hangingFetch()
    let settled = false
    const p = caught(call()).finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(ms - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const err = await p
    expect([err.status, err.code, err.message]).toEqual([0, 'timeout', 'Request timed out'])
    vi.useRealTimers()
  }

  it('names its errors ApiError and says what failed on the client side', async () => {
    mockFetch(() => jsonResponse(404, { detail: 'Not Found' }))
    expect((await caught(getProject('room1'))).name).toBe('ApiError')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect((await caught(getProject('room1'))).message).toBe('Network error')
  })

  it('prefers detail.retry_after_s over the Retry-After header', async () => {
    mockFetch(() => jsonResponse(429, { detail: { code: 'rate_limited', retry_after_s: 120 } }, { 'Retry-After': '30' }))
    expect((await caught(getProject('room1'))).retryAfterS).toBe(120)
  })

  it('reads a Retry-After header of whole seconds only', async () => {
    const cases: [string, number | undefined][] = [['45', 45], ['30s', undefined], ['v2', undefined], ['1.5', undefined],
      ['Wed, 21 Oct 2026 07:28:00 GMT', undefined]]
    for (const [header, want] of cases) {
      mockFetch(() => jsonResponse(503, { detail: { code: 'busy' } }, { 'Retry-After': header }))
      expect((await caught(getProject('room1'))).retryAfterS, header).toBe(want)
    }
  })

  it('clears its timeout as soon as the response arrives', async () => {
    vi.useFakeTimers()
    mockFetch(() => jsonResponse(200, { project_id: 'site' }))
    await getProject('site')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fetches saved results by sample id and posts the site report', async () => {
    mockFetch(() => jsonResponse(200, {}))
    await getSavedResult('site-p1-south')
    await getSavedResult('a b/c')
    await writeReport({ run_ids: ['r1', 'r2'], language: 'th' })
    expect(calls.map((c) => [c.url, c.init.method ?? 'GET'])).toEqual([
      ['/api/saved-results/site-p1-south', 'GET'], ['/api/saved-results/a%20b%2Fc', 'GET'], ['/api/report', 'POST'],
    ])
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ run_ids: ['r1', 'r2'], language: 'th' })
    expect(new Headers(calls[2].init.headers).get('Content-Type')).toBe('application/json')
  })

  it('gives the Gemini calls 60 s and plain calls 30 s', async () => {
    await timesOutAfter(() => ask({ project_id: 'site', guid: 'g', question: 'q' }), 60_000)
    await timesOutAfter(() => draftIssue({ run_id: 'r1', mark: 1 }), 60_000)
    await timesOutAfter(() => writeReport({ run_ids: ['r1'] }), 60_000)
    await timesOutAfter(() => createIssue({ project_id: 'site', guid: 'g', title: 't' }), 30_000)
    await timesOutAfter(() => getProject('site'), 30_000)
  })
})

describe('Checks page calls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists the session\'s runs, optionally for one project', async () => {
    mockFetch(() => jsonResponse(200, { runs: [] }))
    expect(await listRuns()).toEqual({ runs: [] })
    await listRuns('site')
    expect(calls.map((c) => c.url)).toEqual(['/api/runs', '/api/runs?project_id=site'])
    expect(new Headers(calls[0].init.headers).get('X-Session-Id')).toMatch(UUID_V4)
  })

  it('gets one run by id', async () => {
    mockFetch(() => jsonResponse(200, { run_id: 'abc_DEF-1234567890' }))
    expect((await getRun('abc_DEF-1234567890')).run_id).toBe('abc_DEF-1234567890')
    expect(calls[0].url).toBe('/api/runs/abc_DEF-1234567890')
    mockFetch(() => jsonResponse(404, { detail: { code: 'unknown_run' } }))
    const err = await caught(getRun('gone_gone_gone_gone'))
    expect([err.status, err.code]).toEqual([404, 'unknown_run'])
  })

  it('puts a review decision, or null to take it back', async () => {
    mockFetch(() => jsonResponse(200, { run_id: 'r', mark: 3, decision: 'confirmed', at: '2026-11-25T09:00:00Z' }))
    expect((await reviewFinding('r1', 3, 'confirmed')).decision).toBe('confirmed')
    await reviewFinding('r1', 3, null)
    expect(calls.map((c) => [c.url, c.init.method, c.init.body])).toEqual([
      ['/api/runs/r1/review/3', 'PUT', '{"decision":"confirmed"}'],
      ['/api/runs/r1/review/3', 'PUT', '{"decision":null}'],
    ])
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/json')
  })

  it('fetches the outline image like the photo', async () => {
    mockFetch(() => new Response(new Blob(['jpeg']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
    const url = await fetchRunImage('r1', 'overlay.jpg')
    expect(url).toMatch(/^blob:/)
    expect(calls[0].url).toBe('/api/runs/r1/overlay.jpg')
    URL.revokeObjectURL(url)
  })
})

describe('a streamed check', () => {
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const streamed = (chunks: string[], open = false) => new Response(new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(new TextEncoder().encode(ch)))
      if (!open) c.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  const first = { result: { findings: [{ mark: 2, status: 'misplaced' }] }, pending: [2, 5] }
  const done = { run_id: 'r1', saved: true, photo_url: null, result: { findings: [{ mark: 2, status: 'present_ok' }] } }
  const post = (onFirstLook?: (l: unknown) => void) =>
    postCheck(new Blob(['j']), new Blob(['p']), CTX, null, onFirstLook)

  it('asks for the stream, hands over the first look, then returns the settled answer', async () => {
    const whole = sse('first_look', first) + sse('done', done)
    mockFetch(() => streamed([whole.slice(0, 17), whole.slice(17, 90), whole.slice(90)])) // events split across chunks
    const looks: unknown[] = []
    const res = await post((l) => looks.push(l))
    expect(new Headers(calls[0].init.headers).get('Accept')).toBe('text/event-stream, application/json')
    expect(looks).toEqual([first])
    expect(res).toEqual(done)
  })

  it('takes plain JSON when the server has no first look to send', async () => {
    mockFetch(() => jsonResponse(200, done))
    const looks: unknown[] = []
    expect(await post((l) => looks.push(l))).toEqual(done)
    expect(looks).toEqual([])
  })

  it('does not ask for the stream without a first-look handler', async () => {
    mockFetch(() => jsonResponse(200, done))
    await post()
    expect(new Headers(calls[0].init.headers).get('Accept')).toBeNull()
  })

  it('turns an error event into an ApiError, as the HTTP error would have been', async () => {
    mockFetch(() => streamed([sse('first_look', first), sse('error', { status: 503, detail: { code: 'model_unavailable' } })]))
    const err = await caught(post(() => undefined))
    expect([err.status, err.code]).toEqual([503, 'model_unavailable'])
  })

  it('fails as a network error when the stream ends before the answer', async () => {
    mockFetch(() => streamed([sse('first_look', first)]))
    const err = await caught(post(() => undefined))
    expect([err.status, err.code]).toEqual([0, 'network'])
  })

  it('keeps reading when the page fails to show the first look', async () => {
    mockFetch(() => streamed([sse('first_look', first), sse('done', done)]))
    expect(await post(() => { throw new Error('render failed') })).toEqual(done)
  })

  it('times out a stream that stops sending', async () => {
    vi.useFakeTimers()
    try {
      mockFetch(() => streamed([sse('first_look', first)], true))
      const p = caught(post(() => undefined))
      await vi.advanceTimersByTimeAsync(120_000)
      const err = await p
      expect([err.status, err.code]).toEqual([0, 'timeout'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits complete events off the buffer, CRLF or LF', () => {
    expect(takeEvents('event: a\r\ndata: {"x":1}\r\n\r\nevent: b\ndata: 2\n\nevent: c\nda')).toEqual({
      events: [{ event: 'a', data: '{"x":1}' }, { event: 'b', data: '2' }], rest: 'event: c\nda',
    })
  })
})
