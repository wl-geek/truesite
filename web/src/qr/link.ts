// QR payloads are deep links: https://<host>/a/<project_id>/<anchor_id> (spec section 6).

const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ANCHOR_RE = /^[A-Za-z0-9_-]{1,16}$/

/**
 * The project and anchor named by a scanned payload, or null when it is not one of our anchor links.
 * Any host is accepted (a printed sheet points at the deployed host even when testing on localhost);
 * `origin` resolves relative payloads such as "/a/room1/A1".
 */
export function parseAnchorLink(text: string, origin: string): { projectId: string; anchorId: string } | null {
  let url: URL
  try {
    url = new URL(text.trim(), origin)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 3 || parts[0] !== 'a') return null
  // No percent-decoding: the id patterns never need it, and a malformed escape in a foreign code would throw.
  const [, projectId, anchorId] = parts
  if (!PROJECT_RE.test(projectId) || !ANCHOR_RE.test(anchorId)) return null
  return { projectId, anchorId }
}
