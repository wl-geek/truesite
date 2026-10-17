import { describe, expect, it } from 'vitest'
import { formatWait, onUsageLimit, reportUsageLimit, secondsToUtcMidnight, usageLimitOf } from './limits'

const NOW = Date.UTC(2026, 9, 17, 23, 0, 0) // 17 Oct 2026, 23:00 UTC

describe('usage limits', () => {
  it('recognises the three Gemini usage limits, with the server\'s wait', () => {
    expect(usageLimitOf({ status: 429, code: 'model_quota', retryAfterS: 38 }, '/api/check', NOW)).toEqual({ code: 'model_quota', untilMs: NOW + 38_000 })
    expect(usageLimitOf({ status: 429, code: 'rate_limited', retryAfterS: 600 }, '/api/ask', NOW)).toEqual({ code: 'rate_limited', untilMs: NOW + 600_000 })
    expect(usageLimitOf({ status: 429, code: 'daily_cap', retryAfterS: 3600 }, '/api/report', NOW)?.code).toBe('daily_cap')
    expect(usageLimitOf({ status: 429, code: 'model_quota' }, '/api/issues/draft', NOW)?.untilMs).toBe(NOW + 60_000)
  })

  it('works out the daily reset when the server gives no wait', () => {
    expect(secondsToUtcMidnight(NOW)).toBe(3600)
    expect(usageLimitOf({ status: 429, code: 'daily_cap' }, '/api/check', NOW)?.untilMs).toBe(NOW + 3_600_000)
  })

  it('ignores other failures, and limits on calls that make no Gemini call', () => {
    expect(usageLimitOf({ status: 503, code: 'model_unavailable' }, '/api/check', NOW)).toBeNull()
    expect(usageLimitOf({ status: 429, code: 'issue_cap' }, '/api/check', NOW)).toBeNull()
    expect(usageLimitOf({ status: 429, code: 'rate_limited', retryAfterS: 60 }, '/api/issues', NOW)).toBeNull()
  })

  it('announces a limit to every listener until they unsubscribe', () => {
    const seen: string[] = []
    const off = onUsageLimit((l) => seen.push(l.code))
    reportUsageLimit({ code: 'daily_cap', untilMs: NOW })
    off()
    reportUsageLimit({ code: 'model_quota', untilMs: NOW })
    expect(seen).toEqual(['daily_cap'])
  })

  it('counts down in minutes and seconds, with hours from an hour up', () => {
    expect(formatWait(38_000)).toBe('0:38')
    expect(formatWait(61_500)).toBe('1:02')
    expect(formatWait(4 * 3600_000 + 5 * 60_000 + 9_000)).toBe('4:05:09')
    expect(formatWait(-5)).toBe('0:00')
  })
})
