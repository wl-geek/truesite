import { useMemo, useSyncExternalStore } from 'react'

/** Client routes (contract section 4). The server's SPA fallback serves index.html for all of them. */
export type Route =
  | { name: 'home' }
  | { name: 'viewer'; projectId?: string }
  | { name: 'live'; projectId: string; anchorId: string }
  | { name: 'samples' }
  | { name: 'issues' }

const LIVE_RE = /^\/a\/([^/]+)\/([^/]+)\/?$/
const NAV_EVENT = 'truesite:navigate'

/**
 * Unknown paths go to the start page. Live ids are only decoded here; LivePage checks they exist.
 * The viewer takes its project from `?project=` (default room1 when absent).
 */
export function parseRoute(pathname: string, search = ''): Route {
  const live = LIVE_RE.exec(pathname)
  if (live) {
    try {
      return { name: 'live', projectId: decodeURIComponent(live[1]), anchorId: decodeURIComponent(live[2]) }
    } catch {
      return { name: 'home' }
    }
  }
  if (pathname === '/samples' || pathname === '/samples/') return { name: 'samples' }
  if (pathname === '/issues' || pathname === '/issues/') return { name: 'issues' }
  if (pathname === '/model' || pathname === '/model/') {
    const projectId = new URLSearchParams(search).get('project')
    return projectId ? { name: 'viewer', projectId } : { name: 'viewer' }
  }
  return { name: 'home' }
}

/** The model viewer for one project, so links from Live and Samples keep the project. */
export function viewerPathFor(projectId: string): string {
  return `/model?project=${encodeURIComponent(projectId)}`
}

export function navigate(path: string): void {
  if (path !== window.location.pathname + window.location.search) window.history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAV_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAV_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAV_EVENT, onChange)
  }
}

/** Re-renders on path and query changes (e.g. /model?project=rooftop -> /model). */
export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search, () => '/')
  return useMemo(() => {
    const q = location.indexOf('?')
    return q < 0 ? parseRoute(location) : parseRoute(location.slice(0, q), location.slice(q))
  }, [location])
}
