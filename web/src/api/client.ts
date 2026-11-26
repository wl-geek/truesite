/**
 * Typed calls to the TrueSite API (contract sections 4 and 7). Same origin: in dev, Vite proxies
 * /api to FastAPI. Every call sends X-Session-Id. Failures throw ApiError:
 *   status  HTTP status, or 0 for network failures and timeouts
 *   code    detail.code from the server ("rate_limited", "daily_cap", "model_quota", "busy", "model_unavailable", ...),
 *           or "network" / "timeout" on the client side
 *   retryAfterS  detail.retry_after_s, else the Retry-After header
 */
import { getSessionId } from '../session'
import { reportUsageLimit, usageLimitOf } from './limits'
import type {
  AskAnswer, AskRequest, CheckContext, CheckResponse, CheckResult, FirstLook, Issue, IssueDraft, IssueDraftRequest, IssueIn,
  IssueList, ProjectManifest, ReportRequest, ReviewDecision, ReviewOut, RunDetail, RunList, SiteReport,
} from './types'

export const DEFAULT_TIMEOUT_MS = 30_000
// Ask and draft: a Gemini call times out at 25 s; with the SDK's HTTP retry and a parse retry the rare worst case
// (about 100 s) outlasts this, and the user sees "took too long".
export const MODEL_TIMEOUT_MS = 60_000
export const CHECK_TIMEOUT_MS = 120_000 // matches Cloud Run's --timeout 120

export class ApiError extends Error {
  status: number
  code?: string
  retryAfterS?: number

  constructor(message: string, status: number, code?: string, retryAfterS?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterS = retryAfterS
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`
  let code: string | undefined
  let retryAfterS: number | undefined
  try {
    const detail = ((await res.json()) as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      message = detail
    } else if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: unknown } | undefined
      if (typeof first?.msg === 'string') message = first.msg
    } else if (detail && typeof detail === 'object') {
      const d = detail as { code?: unknown; retry_after_s?: unknown }
      if (typeof d.code === 'string') message = code = d.code
      if (typeof d.retry_after_s === 'number') retryAfterS = d.retry_after_s
    }
  } catch {
    // not JSON (e.g. a proxy error page): keep "HTTP <status>"
  }
  const header = res.headers.get('Retry-After')
  if (retryAfterS === undefined && header && /^\d+$/.test(header)) retryAfterS = Number(header)
  return new ApiError(message, res.status, code, retryAfterS)
}

async function request(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Session-Id', getSessionId())
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(path, { ...init, headers, signal: ctrl.signal })
  } catch {
    throw ctrl.signal.aborted ? new ApiError('Request timed out', 0, 'timeout') : new ApiError('Network error', 0, 'network')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const err = await errorFrom(res)
    const limit = usageLimitOf(err, path, Date.now()) // a usage limit, not an error: LimitDialog explains it
    if (limit) reportUsageLimit(limit)
    throw err
  }
  return res
}

async function getJson<T>(path: string, timeoutMs?: number): Promise<T> {
  return (await (await request(path, {}, timeoutMs)).json()) as T
}

async function postJson<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  return (await (await request(path, init, timeoutMs)).json()) as T
}

export function getProject(projectId: string): Promise<ProjectManifest> {
  return getJson(`/api/projects/${encodeURIComponent(projectId)}`)
}

/**
 * `overlay` (optional) is IMAGE 3: the photo with each marked element's design outline (check/outlines.ts).
 * With `onFirstLook`, the server may stream (text/event-stream, contract section 4): Gemini's first look comes as soon as it
 * answers, while the close-up second look settles; the settled CheckResponse is still what this returns.
 */
export async function postCheck(photo: Blob, render: Blob, ctx: CheckContext, overlay?: Blob | null,
  onFirstLook?: (look: FirstLook) => void): Promise<CheckResponse> {
  const form = new FormData()
  form.append('photo', photo, 'photo.jpg')
  form.append('render', render, 'render.png')
  if (overlay) form.append('overlay', overlay, 'overlay.jpg')
  form.append('context', JSON.stringify(ctx))
  const started = Date.now()
  const init: RequestInit = { method: 'POST', body: form }
  if (onFirstLook) init.headers = { Accept: 'text/event-stream, application/json' }
  const res = await request('/api/check', init, CHECK_TIMEOUT_MS)
  if (!onFirstLook || !res.body || !(res.headers.get('Content-Type') ?? '').startsWith('text/event-stream')) {
    return (await res.json()) as CheckResponse
  }
  return readCheckStream(res.body, onFirstLook, CHECK_TIMEOUT_MS - (Date.now() - started))
}

export type StreamEvent = { event: string; data: string }

/** The complete server-sent events (each ends with a blank line) at the front of `buffer`, and what is left after them. */
export function takeEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n')
  const events: StreamEvent[] = []
  let start = 0
  for (let end = text.indexOf('\n\n'); end !== -1; end = text.indexOf('\n\n', start)) {
    let event = 'message'
    const data: string[] = []
    for (const line of text.slice(start, end).split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    events.push({ event, data: data.join('\n') })
    start = end + 2
  }
  return { events, rest: text.slice(start) }
}

function streamError(data: string): ApiError {
  const { status, detail } = JSON.parse(data) as { status?: number; detail?: { code?: string; retry_after_s?: number } }
  const code = typeof detail?.code === 'string' ? detail.code : undefined
  return new ApiError(code ?? `HTTP ${status}`, typeof status === 'number' ? status : 0, code, detail?.retry_after_s)
}

async function readCheckStream(body: ReadableStream<Uint8Array>, onFirstLook: (look: FirstLook) => void,
  timeoutMs: number): Promise<CheckResponse> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('Request timed out', 0, 'timeout')), Math.max(0, timeoutMs))
  })
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timedOut])
      if (value) buffer += decoder.decode(value, { stream: true })
      const { events, rest } = takeEvents(buffer)
      buffer = rest
      for (const e of events) {
        if (e.event === 'done') return JSON.parse(e.data) as CheckResponse
        if (e.event === 'error') throw streamError(e.data)
        if (e.event === 'first_look') {
          try {
            onFirstLook(JSON.parse(e.data) as FirstLook)
          } catch {
            /* showing the first look is extra: the settled answer still comes */
          }
        }
      }
      if (done) throw new ApiError('The check stopped before it finished', 0, 'network')
    }
  } catch (e) {
    throw e instanceof ApiError ? e : new ApiError('Network error', 0, 'network')
  } finally {
    clearTimeout(timer)
    reader.cancel().catch(() => undefined)
  }
}

export function getSavedResult(sampleId: string): Promise<CheckResult> {
  return getJson(`/api/saved-results/${encodeURIComponent(sampleId)}`)
}

/** <img src> cannot send X-Session-Id, so fetch the bytes and hand back an object URL (revoke it when done). */
export async function fetchRunImage(runId: string, name: 'photo.jpg' | 'render.png' | 'overlay.jpg'): Promise<string> {
  const res = await request(`/api/runs/${encodeURIComponent(runId)}/${name}`)
  return URL.createObjectURL(await res.blob())
}

export function ask(req: AskRequest): Promise<AskAnswer> {
  return postJson('/api/ask', req, MODEL_TIMEOUT_MS)
}

export function draftIssue(req: IssueDraftRequest): Promise<IssueDraft> {
  return postJson('/api/issues/draft', req, MODEL_TIMEOUT_MS)
}

export function writeReport(req: ReportRequest): Promise<SiteReport> {
  return postJson('/api/report', req, MODEL_TIMEOUT_MS)
}

export function createIssue(req: IssueIn): Promise<Issue> {
  return postJson('/api/issues', req)
}

/** This session's issues plus the demo issues; every project when projectId is omitted. */
export function listIssues(projectId?: string): Promise<IssueList> {
  return getJson(projectId === undefined ? '/api/issues' : `/api/issues?project_id=${encodeURIComponent(projectId)}`)
}

/** This session's stored checks, newest first, with counts and review state (the Checks page). */
export function listRuns(projectId?: string): Promise<RunList> {
  return getJson(projectId === undefined ? '/api/runs' : `/api/runs?project_id=${encodeURIComponent(projectId)}`)
}

/** One of this session's checks in full: context, result, review decisions, provenance and image paths. */
export function getRun(runId: string): Promise<RunDetail> {
  return getJson(`/api/runs/${encodeURIComponent(runId)}`)
}

/** A person's decision on one finding; null takes it back. */
export async function reviewFinding(runId: string, mark: number, decision: ReviewDecision | null): Promise<ReviewOut> {
  const init = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }
  return (await (await request(`/api/runs/${encodeURIComponent(runId)}/review/${mark}`, init)).json()) as ReviewOut
}
