import type { Element, Finding, IssueDraft, IssueIn } from '../api/types'
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

export function issueDate(iso: string, locale?: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
