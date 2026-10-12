import { useMemo, useSyncExternalStore } from 'react'

/** Client routes (contract section 4). The server's SPA fallback serves index.html for all of them. */
export type Route =
  | { name: 'viewer' }
  | { name: 'live'; projectId: string; anchorId: string }
  | { name: 'samples' }
  | { name: 'issues' }

const LIVE_RE = /^\/a\/([^/]+)\/([^/]+)\/?$/
const NAV_EVENT = 'truesite:navigate'

/** Unknown paths go to the viewer. Live ids are only decoded here; LivePage checks they exist. */
export function parseRoute(pathname: string): Route {
  const live = LIVE_RE.exec(pathname)
  if (live) {
    try {
      return { name: 'live', projectId: decodeURIComponent(live[1]), anchorId: decodeURIComponent(live[2]) }
    } catch {
      return { name: 'viewer' }
    }
  }
  if (pathname === '/samples' || pathname === '/samples/') return { name: 'samples' }
  if (pathname === '/issues' || pathname === '/issues/') return { name: 'issues' }
  return { name: 'viewer' }
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

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname, () => '/')
  return useMemo(() => parseRoute(pathname), [pathname])
}
