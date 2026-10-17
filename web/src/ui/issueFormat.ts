import type { ApiError } from '../api/client'
import type { Element, Finding, IssueDraft, IssueIn } from '../api/types'
import { askErrorMessage } from './askFormat'
import { NOT_A_SURVEY, statusText } from './findingFormat'

/** A draft without Gemini (saved results have no stored run to draft from). */
export function templateDraft(finding: Finding, element: Element | null): IssueDraft {
  const name = element?.name || finding.name || finding.ifc_class
  const why = finding.explanation ? `${finding.explanation} ` : ''
  return {
    title: `${name}: ${statusText(finding)}`.slice(0, 80),
    description: `${why}${NOT_A_SURVEY}`.slice(0, 500),
    suggested_action: 'Check on site and confirm with the design team before closing.',
  }
}

export function issueBody(projectId: string, finding: Finding, runId: string | null, draft: IssueDraft): IssueIn {
  return {
    project_id: projectId, guid: finding.guid, run_id: runId, finding_ref: runId ? `${runId}:${finding.mark}` : null,
    title: draft.title.trim(), description: draft.description.trim(), suggested_action: draft.suggested_action.trim(),
    severity: finding.severity, crop_box: finding.evidence_box,
  }
}

/**
 * Why saving an issue or writing the site report failed (audit C-23): about that action, not about questions, and
 * no "try again" where a retry can't succeed. Other errors get the generic copy for the action.
 */
export function issueErrorMessage(err: Pick<ApiError, 'status' | 'code' | 'retryAfterS'>, action: 'issue' | 'report' = 'issue'): string {
  switch (err.code) {
    case 'rate_limited':
      return 'Too many requests from this network. Try again in a few minutes.'
    case 'daily_cap':
      return "Today's Gemini limit has been reached. Try again tomorrow."
    case 'issue_cap':
      return 'This browser has reached its issue limit.'
    case 'unknown_run':
      return action === 'report'
        ? 'These checks are no longer on the server. Run Check as-built again, then write the report.'
        : 'This check is no longer on the server. Run Check as-built again, then save.'
    case 'unknown_project':
      return 'This project is no longer on the server.'
    default:
      return askErrorMessage(err).replace("Couldn't answer", action === 'report' ? "Couldn't write the report" : "Couldn't save")
  }
}
