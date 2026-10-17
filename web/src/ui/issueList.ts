import { useCallback, useEffect, useState } from 'react'
import { listIssues } from '../api/client'
import type { Issue } from '../api/types'
import { NOT_A_SURVEY } from './findingFormat'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SEVERITY = { high: 'High', medium: 'Medium', low: 'Low' } as const

/** A saved issue as plain text, to paste into a message or an email to the crew. */
export function issueText(issue: Issue, elementName: string | null): string {
  const meta = [issue.severity ? `${SEVERITY[issue.severity]} severity` : null, elementName].filter(Boolean).join(' · ')
  const parts = [[issue.title, meta].filter(Boolean).join('\n'), issue.description,
    issue.suggested_action ? `Suggested action: ${issue.suggested_action}` : '', `From a TrueSite as-built check. ${NOT_A_SURVEY}`]
  return parts.filter(Boolean).join('\n\n')
}

/** When an issue was saved: "just now", "25 min ago", "3 h ago", then "15 Oct, 14:30" (local time). */
export function savedWhen(iso: string, now: Date = new Date()): string {
  const t = new Date(iso)
  const min = Math.floor((now.getTime() - t.getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 12 * 60) return `${Math.floor(min / 60)} h ago`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getDate()} ${MONTHS[t.getMonth()]}, ${pad(t.getHours())}:${pad(t.getMinutes())}`
}

/**
 * This browser session's saved issues for a project, newest first (the server keeps them for 30 days). The 3D model
 * and the virtual demo both read them, so an issue saved in one shows in the other. add() puts a new one on top.
 */
export function useSavedIssues(projectId: string | null): { issues: Issue[]; add: (issue: Issue) => void } {
  const [issues, setIssues] = useState<Issue[]>([])
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    listIssues(projectId)
      .then((list) => !cancelled && setIssues([...list.issues].sort((a, b) => b.created_at.localeCompare(a.created_at))))
      .catch(() => undefined) // no list is no harm: saving still works, and the next save shows up
    return () => { cancelled = true }
  }, [projectId])
  const add = useCallback((issue: Issue) => setIssues((list) => [issue, ...list.filter((i) => i.id !== issue.id)]), [])
  return { issues, add }
}
