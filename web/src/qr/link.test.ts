import { describe, expect, it } from 'vitest'
import { parseAnchorLink } from './link'

const ORIGIN = 'http://localhost:5173'

describe('parseAnchorLink', () => {
  it('accepts our deep links on any host', () => {
    expect(parseAnchorLink('https://truesite-123.asia-southeast1.run.app/a/room1/A1', ORIGIN)).toEqual({ projectId: 'room1', anchorId: 'A1' })
    expect(parseAnchorLink('https://example.test/a/room1/D2/', ORIGIN)).toEqual({ projectId: 'room1', anchorId: 'D2' })
    expect(parseAnchorLink('  /a/room1/D1 ', ORIGIN)).toEqual({ projectId: 'room1', anchorId: 'D1' })
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'hello', 'https://x.test/', 'https://x.test/a/room1', 'https://x.test/a/room1/A1/extra',
      'https://x.test/b/room1/A1', 'https://x.test/a/Room1/A1', 'https://x.test/a/room1/%2E%2E', 'javascript:alert(1)',
      'ftp://x.test/a/room1/A1', 'https://x.test/a/room1/THIS-ID-IS-WAY-TOO-LONG']) {
      expect(parseAnchorLink(bad, ORIGIN), bad).toBeNull()
    }
  })

  it('returns null (does not throw) for malformed percent-encoding in a foreign code', () => {
    for (const bad of ['https://x.test/a/room1/%E0%A4%A', 'https://x.test/a/%zz/A1', '/a/room1/%']) {
      expect(() => parseAnchorLink(bad, ORIGIN), bad).not.toThrow()
      expect(parseAnchorLink(bad, ORIGIN), bad).toBeNull()
    }
  })
})

describe('parseAnchorLink (mutation-tested)', () => {
  it('matches the whole project id, not just its start', () => {
    expect(parseAnchorLink('https://h.test/a/site!x/P1', ORIGIN)).toBeNull()
    expect(parseAnchorLink('https://h.test/a/site.x/P1', ORIGIN)).toBeNull()
    expect(parseAnchorLink('https://h.test/a/site/P1', ORIGIN)).toEqual({ projectId: 'site', anchorId: 'P1' })
  })
})
