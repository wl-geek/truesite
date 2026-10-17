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
  AskAnswer, AskRequest, CheckContext, CheckResponse, CheckResult, Issue, IssueDraft, IssueDraftRequest, IssueIn,
  IssueList, ProjectManifest, ReportRequest, SiteReport,
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

/** `overlay` (optional) is IMAGE 3: the photo with each marked element's design outline (check/outlines.ts). */
export async function postCheck(photo: Blob, render: Blob, ctx: CheckContext, overlay?: Blob | null): Promise<CheckResponse> {
  const form = new FormData()
  form.append('photo', photo, 'photo.jpg')
  form.append('render', render, 'render.png')
  if (overlay) form.append('overlay', overlay, 'overlay.jpg')
  form.append('context', JSON.stringify(ctx))
  return (await (await request('/api/check', { method: 'POST', body: form }, CHECK_TIMEOUT_MS)).json()) as CheckResponse
}

export function getSavedResult(sampleId: string): Promise<CheckResult> {
  return getJson(`/api/saved-results/${encodeURIComponent(sampleId)}`)
}

/** <img src> cannot send X-Session-Id, so fetch the bytes and hand back an object URL (revoke it when done). */
export async function fetchRunImage(runId: string, name: 'photo.jpg' | 'render.png'): Promise<string> {
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
