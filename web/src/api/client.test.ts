import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError, ask, createIssue, draftIssue, fetchRunImage, getProject, getSavedResult, listIssues, postCheck,
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
