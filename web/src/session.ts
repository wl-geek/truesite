/**
 * Anonymous browser session (spec section 6): a random lowercase UUID v4 kept in localStorage and
 * sent as X-Session-Id on every /api call. Check runs and issues are visible only to that session.
 */
export const SESSION_KEY = 'truesite.session'
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let pageSession: string | null = null

function newUuidV4(): string {
  const c = globalThis.crypto
  // randomUUID exists only in secure contexts; plain-http LAN dev pages fall back to getRandomValues.
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function getSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY)
    if (stored && SESSION_ID_RE.test(stored)) return stored
    const id = newUuidV4()
    localStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    // Storage blocked (private mode, embedded views): one id for this page load.
    pageSession ??= newUuidV4()
    return pageSession
  }
}
