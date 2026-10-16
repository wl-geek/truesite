import { describe, expect, it } from 'vitest'
import { parseRoute, viewerPathFor } from './router'

describe('parseRoute', () => {
  it('maps the client routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' })
    expect(parseRoute('/model')).toEqual({ name: 'viewer' })
    expect(parseRoute('/a/room1/A1')).toEqual({ name: 'live', projectId: 'room1', anchorId: 'A1' })
    expect(parseRoute('/a/room1/D2/')).toEqual({ name: 'live', projectId: 'room1', anchorId: 'D2' })
    expect(parseRoute('/samples')).toEqual({ name: 'samples' })
    expect(parseRoute('/samples/')).toEqual({ name: 'samples' })
    expect(parseRoute('/issues')).toEqual({ name: 'home' }) // issues live with their findings, no separate page
  })

  it('keeps the viewer project from the query string', () => {
    expect(parseRoute('/model', '?project=rooftop')).toEqual({ name: 'viewer', projectId: 'rooftop' })
    expect(parseRoute('/model/', '?x=1&project=room1')).toEqual({ name: 'viewer', projectId: 'room1' })
    expect(parseRoute('/model', '?project=')).toEqual({ name: 'viewer' })
    expect(parseRoute('/model', '')).toEqual({ name: 'viewer' })
  })

  it('links to the viewer for one project', () => {
    expect(viewerPathFor('rooftop')).toBe('/model?project=rooftop')
    expect(viewerPathFor('room 1')).toBe('/model?project=room%201')
    expect(parseRoute('/model', viewerPathFor('rooftop').slice('/model'.length))).toEqual({ name: 'viewer', projectId: 'rooftop' })
  })

  it('decodes percent-encoded ids and leaves validation to the live page', () => {
    expect(parseRoute('/a/room%201/A1')).toEqual({ name: 'live', projectId: 'room 1', anchorId: 'A1' })
  })

  it('sends unknown or malformed paths to the start page', () => {
    for (const p of ['/unknown', '/a/room1', '/a/room1/A1/extra', '/a//A1', '/a/%E0%A4%A/A1', '/issuesx', '']) {
      expect(parseRoute(p)).toEqual({ name: 'home' })
    }
  })
})
