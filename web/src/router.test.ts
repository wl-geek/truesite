import { afterEach, describe, expect, it, vi } from 'vitest'
import { checksPathFor, navigate, parseRoute, viewerPathFor, virtualDemoPathFor } from './router'

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

  it('opens the Checks page, or one check on it by run id', () => {
    expect(parseRoute('/checks')).toEqual({ name: 'checks' })
    expect(parseRoute('/checks/')).toEqual({ name: 'checks' })
    expect(parseRoute('/checks', '?run=AbC_d-1234567890xyz')).toEqual({ name: 'checks', runId: 'AbC_d-1234567890xyz' })
    expect(parseRoute('/checks', '?run=')).toEqual({ name: 'checks' })
    expect(checksPathFor()).toBe('/checks')
    expect(checksPathFor('AbC_d-1234567890xyz')).toBe('/checks?run=AbC_d-1234567890xyz')
    expect(checksPathFor('a b')).toBe('/checks?run=a%20b')
    expect(parseRoute('/checks', checksPathFor('a b').slice('/checks'.length))).toEqual({ name: 'checks', runId: 'a b' })
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

describe('router (mutation-tested)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('matches live links from the start of the path only', () => {
    expect(parseRoute('/x/a/site/P1')).toEqual({ name: 'home' })
    expect(parseRoute('/model/a/site/P1')).toEqual({ name: 'home' })
    expect(parseRoute('/a/site/P1')).toEqual({ name: 'live', projectId: 'site', anchorId: 'P1' })
  })

  /** A window stand-in: an event target with a location and a history that moves it. */
  function fakeWindow(pathname: string, search = '') {
    const w = Object.assign(new EventTarget(), {
      location: { pathname, search },
      history: {
        pushState: vi.fn((_state: unknown, _title: string, url: string) => {
          const q = url.indexOf('?')
          w.location.pathname = q < 0 ? url : url.slice(0, q)
          w.location.search = q < 0 ? '' : url.slice(q)
        }),
      },
    })
    vi.stubGlobal('window', w)
    const heard: string[] = []
    w.addEventListener('truesite:navigate', () => heard.push(w.location.pathname + w.location.search))
    return { w, heard }
  }

  it('pushes a history entry for a new path and tells the app', () => {
    const { w, heard } = fakeWindow('/')
    navigate('/model?project=site')
    expect(w.history.pushState).toHaveBeenCalledWith(null, '', '/model?project=site')
    expect(heard).toEqual(['/model?project=site'])
  })

  it('does not push the same path twice, but still tells the app (to scroll or re-render)', () => {
    const { w, heard } = fakeWindow('/samples', '?at=P1')
    navigate('/samples?at=P1')
    expect(w.history.pushState).not.toHaveBeenCalled()
    expect(heard).toEqual(['/samples?at=P1'])
    navigate('/samples?at=P2') // same page, another query: a new entry
    expect(w.history.pushState).toHaveBeenCalledTimes(1)
  })
})

describe('virtualDemoPathFor', () => {
  it('opens a QR spot on the tidy site, or on the cluttered one', () => {
    expect(virtualDemoPathFor('P2')).toBe('/samples?at=P2')
    expect(virtualDemoPathFor('P2', true)).toBe('/samples?at=P2&clutter')
    expect(parseRoute('/samples', '?at=P2&clutter').name).toBe(parseRoute('/samples', '?at=P2').name)
  })
})
