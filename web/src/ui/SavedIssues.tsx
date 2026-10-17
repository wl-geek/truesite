import { useEffect, useState } from 'react'
import type { Element, Issue } from '../api/types'
import { issueText, savedWhen } from './issueList'
import './savedIssues.css'

/** Copy one issue as plain text, to paste into a message to the crew. Says Copied (or that it couldn't) for a moment. */
export function CopyIssueButton({ issue, elementName }: { issue: Issue; elementName: string | null }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2500)
    return () => clearTimeout(t)
  }, [state])
  const copy = () => {
    if (!navigator.clipboard) return setState('failed') // only on a secure page
    navigator.clipboard.writeText(issueText(issue, elementName)).then(() => setState('copied'), () => setState('failed'))
  }
  return (
    <button type="button" className="btn btn-small copy-issue" onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy issue'}
    </button>
  )
}

/**
 * This browser's saved issues for the project, newest first: tap one to see its element, or copy it. Shared by the
 * 3D model and the virtual demo, so an issue saved in one is listed in the other.
 */
export function SavedIssues({ issues, elements, onSelect }: {
  issues: readonly Issue[]; elements: ReadonlyMap<string, Element>; onSelect: (issue: Issue) => void
}) {
  if (!issues.length) return null
  return (
    <section className="saved-issues" aria-label="Saved issues">
      <h3>Saved issues ({issues.length})</h3>
      <ul>
        {issues.map((issue) => {
          const name = elements.get(issue.guid)?.name ?? null
          return (
            <li key={issue.id} className="saved-issue">
              <button type="button" className="saved-issue-main" onClick={() => onSelect(issue)}>
                <span className="saved-issue-text">
                  <strong>{issue.title}</strong>
                  <span>{[name, savedWhen(issue.created_at)].filter(Boolean).join(' · ')}</span>
                </span>
                {issue.severity && <span className={`badge badge-${issue.severity}`}>{issue.severity}</span>}
              </button>
              <CopyIssueButton issue={issue} elementName={name} />
            </li>
          )
        })}
      </ul>
      <p className="note">Saved for this browser for 30 days.</p>
    </section>
  )
}
