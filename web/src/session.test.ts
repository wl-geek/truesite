import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

async function freshSession() {
  vi.resetModules()
  return import('./session')
}

describe('getSessionId', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('creates a lowercase UUID v4 once and keeps it in localStorage', async () => {
    const { getSessionId, SESSION_KEY } = await freshSession()
    const id = getSessionId()
    expect(id).toMatch(UUID_V4)
    expect(localStorage.getItem(SESSION_KEY)).toBe(id)
    expect(getSessionId()).toBe(id)
    expect(SESSION_KEY).toBe('truesite.session')
  })

  it('reuses a stored id and replaces a malformed one', async () => {
    const { getSessionId, SESSION_KEY } = await freshSession()
    localStorage.setItem(SESSION_KEY, '0b0b6a43-1f4c-4b1e-9d3e-5a0e3c2f1a77')
    expect(getSessionId()).toBe('0b0b6a43-1f4c-4b1e-9d3e-5a0e3c2f1a77')
    localStorage.setItem(SESSION_KEY, 'demo')
    const id = getSessionId()
    expect(id).toMatch(UUID_V4)
    expect(id).not.toBe('demo')
  })

  it('builds a v4 from getRandomValues when randomUUID is missing (plain-http LAN dev)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xff) })
    const { getSessionId } = await freshSession()
    expect(getSessionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('keeps one id per page load when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') },
    })
    const { getSessionId } = await freshSession()
    const id = getSessionId()
    expect(id).toMatch(UUID_V4)
    expect(getSessionId()).toBe(id)
  })
})
