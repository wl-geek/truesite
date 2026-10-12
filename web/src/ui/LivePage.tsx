import { Link } from './Link'

export type LivePageProps = { projectId: string; anchorId: string }

/** Live AR overlay. Stub: Part 2 replaces this file; the props are final. */
export function LivePage({ projectId, anchorId }: LivePageProps) {
  return (
    <main className="page">
      <h1>Live view</h1>
      <p>
        Anchor <strong>{anchorId}</strong> in project <strong>{projectId}</strong>. The live camera view is not
        available in this build yet.
      </p>
      <Link to="/" className="btn">Open the model viewer</Link>
    </main>
  )
}
