import { useEffect, useState } from 'react'
import { getRun } from '../api/client'
import { countViews, viewsSummary, type ViewsCount } from '../check/multiView'
import { checksPathFor, virtualDemoPathFor } from '../router'
import { Link } from './Link'
import { otherViewpoints, type Viewpoint } from './siteViewpoints'

/**
 * Under a finished check in the virtual demo: what the other QR spots said about the same elements, or, before a
 * second spot has been checked, why to go and check from one. The comparison itself is made by the server
 * (GET /api/runs/{id} `views`) and shown in full on the Checks page.
 */
export function OtherViewpoints({ runId, current, clutter, checkedSpots }: {
  runId: string; current: Viewpoint['id']; clutter: boolean; checkedSpots: readonly string[]
}) {
  const [count, setCount] = useState<ViewsCount | null>(null)
  useEffect(() => {
    let cancelled = false
    setCount(null)
    getRun(runId).then((run) => { if (!cancelled) setCount(countViews(run.views)) }).catch(() => undefined) // the card still offers the other spots
    return () => { cancelled = true }
  }, [runId])
  const others = otherViewpoints(current)
  const compared = others.filter((v) => checkedSpots.includes(v.id)).map((v) => v.id)
  return (
    <section className="vs-views" aria-labelledby="vs-views-title">
      <h3 id="vs-views-title">Other viewpoints</h3>
      {count ? (
        <p><strong>{viewsSummary(count)}</strong> Two viewpoints that agree make a finding surer; where they disagree, take a closer look on site.{' '}
          <Link to={checksPathFor(runId)}>See each finding in Checks</Link></p>
      ) : compared.length > 0 ? (
        <p><strong>Nothing to add from {compared.join(', ')}.</strong> No finding here is flagged or contradicted from there.
          Another spot sees other elements.</p>
      ) : (
        <p>One photo can't show depth, and one view can be wrong. Check from a second spot and TrueSite compares what
          both see of the same elements.</p>
      )}
      <ul className="vs-views-spots">
        {others.map((v) => {
          const done = checkedSpots.includes(v.id)
          return (
            <li key={v.id}>
              <Link to={virtualDemoPathFor(v.id, clutter)} className="btn btn-small">
                Go to {v.id}<span className="vs-views-name"> · {v.name}</span>{done && <span className="vs-views-done"> · checked</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
