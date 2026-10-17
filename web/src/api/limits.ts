/**
 * Gemini usage limits, which are not errors: the demo's daily cap (it runs on free-trial credits), the per-network
 * hourly cap, and Google's own quota. A Gemini call refused by one of them is announced here, and LimitDialog shows
 * what happened with a countdown, so a judge doesn't take it for a bug in TrueSite.
 */
export type LimitCode = 'daily_cap' | 'rate_limited' | 'model_quota'
export type UsageLimit = { code: LimitCode; untilMs: number }

const LIMIT_CODES: ReadonlySet<string> = new Set<LimitCode>(['daily_cap', 'rate_limited', 'model_quota'])
/** The API calls that use Gemini (issue saves have their own per-network limit and no Gemini). */
const GEMINI_PATHS: ReadonlySet<string> = new Set(['/api/check', '/api/ask', '/api/issues/draft', '/api/report'])

/** Seconds from `nowMs` to the next midnight UTC, when the daily cap resets. */
export function secondsToUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs)
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs) / 1000))
}

/** The usage limit behind a refused Gemini call, or null for any other failure. */
export function usageLimitOf(err: { status: number; code?: string; retryAfterS?: number }, path: string, nowMs: number): UsageLimit | null {
  if (err.status !== 429 || !err.code || !LIMIT_CODES.has(err.code) || !GEMINI_PATHS.has(path)) return null
  const code = err.code as LimitCode
  const fallbackS = code === 'model_quota' ? 60 : code === 'rate_limited' ? 3600 : secondsToUtcMidnight(nowMs)
  return { code, untilMs: nowMs + (err.retryAfterS ?? fallbackS) * 1000 }
}

const listeners = new Set<(limit: UsageLimit) => void>()

export function reportUsageLimit(limit: UsageLimit): void {
  listeners.forEach((cb) => cb(limit))
}

export function onUsageLimit(cb: (limit: UsageLimit) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** A countdown: "4:05:09" from an hour up, else "4:09"; never below "0:00". */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
