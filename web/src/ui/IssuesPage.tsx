import { useEffect, useState } from 'react'
import { fetchRunImage, listIssues } from '../api/client'
import type { Issue } from '../api/types'
import { issueDate } from './issueFormat'
import { DEFAULT_PROJECT_ID } from './ViewerPage'

function Thumb({ runId }: { runId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    fetchRunImage(runId, 'photo.jpg').then((x) => setUrl((u = x))).catch(() => setUrl(null))
    return () => {
      if (u) URL.revokeObjectURL(u)
    }
  }, [runId])
  return url ? <img className="issue-thumb" src={url} alt="" /> : null
}

function IssueCard({ issue, example }: { issue: Issue; example?: boolean }) {
  return (
    <li className="issue-card">
      {issue.run_id && <Thumb runId={issue.run_id} />}
      <div>
        <p className="eyebrow">
          {example ? 'Example · ' : ''}{issueDate(issue.created_at)}{issue.severity && <> · <span className={`badge badge-${issue.severity}`}>{issue.severity}</span></>}
        </p>
        <h3>{issue.title}</h3>
        {issue.description && <p>{issue.description}</p>}
        {issue.suggested_action && <p className="note">Next step: {issue.suggested_action}</p>}
      </div>
    </li>
  )
}

/** This browser's issues, plus the seeded examples everyone sees (labelled). */
export function IssuesPage() {
  const [data, setData] = useState<{ issues: Issue[]; demo: Issue[] } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    listIssues(DEFAULT_PROJECT_ID).then(setData).catch(() => setError(true))
  }, [])
  return (
    <main className="page issues-page">
      <h1>Issues</h1>
      {error && <p className="status status-error" role="alert">Couldn't load issues. Check your connection and try again.</p>}
      {!data && !error && <p className="status">Loading…</p>}
      {data && (
        <>
          {data.issues.length === 0 ? (
            <p>No issues yet. Run an as-built check and tap <strong>Draft issue</strong> on a finding.</p>
          ) : (
            <ul className="issue-list">{data.issues.map((i) => <IssueCard key={i.id} issue={i} />)}</ul>
          )}
          {data.demo.length > 0 && (
            <>
              <h2>Examples</h2>
              <ul className="issue-list">{data.demo.map((i) => <IssueCard key={i.id} issue={i} example />)}</ul>
            </>
          )}
        </>
      )}
    </main>
  )
}
