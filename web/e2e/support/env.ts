import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the suite points. By default two local servers that playwright.config.ts starts: the app on E2E_PORT
 * (8813; an app server already running there is reused) and a fresh copy with tight check limits for the 429 copy
 * on E2E_LIMITS_PORT (8815; never reused, so its counters start at zero; `off` skips it and the limit tests).
 * E2E_BASE_URL points the suite at a running deployment instead: no local servers and no limit tests.
 */
const port = (name: string, fallback: number) => Number(process.env[name] || fallback)

export const PORT = port('E2E_PORT', 8813)
export const EXTERNAL = process.env.E2E_BASE_URL?.replace(/\/+$/, '') || null
export const BASE_URL = EXTERNAL ?? `http://127.0.0.1:${PORT}`

const limitsOff = EXTERNAL !== null || process.env.E2E_LIMITS_PORT === 'off'
export const LIMITS_PORT = limitsOff ? null : port('E2E_LIMITS_PORT', PORT + 2)
/**
 * CHECKS_PER_IP_PER_HOUR=1 and DAILY_CHECK_CAP=3: the second check from one address gets 429 rate_limited, and
 * once three checks have run, every check gets 429 daily_cap (limits.e2e.ts runs its tests in order).
 */
export const LIMITS_URL = LIMITS_PORT === null ? null : `http://127.0.0.1:${LIMITS_PORT}`
export const LIMITS_ENV = { CHECKS_PER_IP_PER_HOUR: '1', DAILY_CHECK_CAP: '3' }

/**
 * The live AR spec (tests/live-ar.e2e.ts) plays synthetic camera videos made by scripts/live-ar-videos.py (about
 * 1.7 GB, git-ignored) from E2E_LIVE_AR_VIDEOS (default web/e2e/.videos). Their QR codes point at the base URL they
 * were made for, so that is where the spec opens the app: playwright.config.ts starts a server there when it is a
 * local port. Without the videos the live-ar project is left out.
 */
export const LIVE_AR_VIDEOS = process.env.E2E_LIVE_AR_VIDEOS || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.videos')
const liveManifest = path.join(LIVE_AR_VIDEOS, 'live-ar-videos.json')
export const LIVE_AR_URL: string | null = existsSync(liveManifest)
  ? (JSON.parse(readFileSync(liveManifest, 'utf8')) as { baseUrl: string }).baseUrl.replace(/\/+$/, '')
  : null
/** The port of a local live AR server, or null when the videos point elsewhere (or are missing). */
export const LIVE_AR_PORT: number | null = (() => {
  const m = LIVE_AR_URL ? /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(LIVE_AR_URL) : null
  return m ? Number(m[1]) : null
})()
