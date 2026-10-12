import { describe, expect, it } from 'vitest'
import { parseRoute } from './router'

describe('parseRoute', () => {
  it('maps the client routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'viewer' })
    expect(parseRoute('/a/room1/A1')).toEqual({ name: 'live', projectId: 'room1', anchorId: 'A1' })
    expect(parseRoute('/a/room1/D2/')).toEqual({ name: 'live', projectId: 'room1', anchorId: 'D2' })
    expect(parseRoute('/samples')).toEqual({ name: 'samples' })
    expect(parseRoute('/samples/')).toEqual({ name: 'samples' })
    expect(parseRoute('/issues')).toEqual({ name: 'issues' })
  })

  it('decodes percent-encoded ids and leaves validation to the live page', () => {
    expect(parseRoute('/a/room%201/A1')).toEqual({ name: 'live', projectId: 'room 1', anchorId: 'A1' })
  })

  it('sends unknown or malformed paths to the viewer', () => {
    for (const p of ['/unknown', '/a/room1', '/a/room1/A1/extra', '/a//A1', '/a/%E0%A4%A/A1', '/issuesx', '']) {
      expect(parseRoute(p)).toEqual({ name: 'viewer' })
    }
  })
})
