import { useEffect, useState } from 'react'
import { ApiError, createIssue, draftIssue } from '../api/client'
import type { Element, Finding, Issue, IssueDraft } from '../api/types'
import { askErrorMessage } from './askFormat'
import { issueBody, templateDraft } from './issueFormat'

export type IssueDialogProps = {
  open: boolean
  projectId: string
  runId: string | null
  mark: number | null
  finding: Finding | null
  element: Element | null
  onClose: () => void
  onSaved: (issue: Issue) => void
}

/** Draft an issue from a finding (Gemini when the run is stored, else a template), edit, save (spec 4.2 step 5). */
export function IssueDialog({ open, projectId, runId, mark, finding, element, onClose, onSaved }: IssueDialogProps) {
  const [draft, setDraft] = useState<IssueDraft | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !finding) return
    let cancelled = false
    setError(null)
    setDraft(null)
    if (!runId || mark === null) {
      setDraft(templateDraft(finding, element))
      return
    }
    setDrafting(true)
    draftIssue({ run_id: runId, mark })
      .then((d) => !cancelled && setDraft(d))
      .catch(() => !cancelled && setDraft(templateDraft(finding, element)))
      .finally(() => !cancelled && setDrafting(false))
    return () => {
      cancelled = true
    }
  }, [open, runId, mark, finding, element])

  if (!open || !finding) return null

  async function save() {
    if (!draft || !finding || !draft.title.trim()) return
    setSaving(true)
    setError(null)
    try {
      onSaved(await createIssue(issueBody(projectId, finding, runId, draft)))
    } catch (e) {
      setError(askErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)).replace("Couldn't answer", "Couldn't save"))
    } finally {
      setSaving(false)
    }
  }

  const set = (k: keyof IssueDraft) => (e: { target: { value: string } }) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label="New issue" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <div>
            <p className="eyebrow">Draft — check before saving</p>
            <h2>New issue · mark {finding.mark}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        {drafting && <p className="status">Drafting…</p>}
        {draft && (
          <form className="issue-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <label>Title<input value={draft.title} maxLength={120} onChange={set('title')} required /></label>
            <label>Description<textarea value={draft.description} maxLength={2000} rows={4} onChange={set('description')} /></label>
            <label>Suggested next step<textarea value={draft.suggested_action} maxLength={600} rows={2} onChange={set('suggested_action')} /></label>
            {finding.severity && <p className="note">Severity: <span className={`badge badge-${finding.severity}`}>{finding.severity}</span> (set by TrueSite from the element type)</p>}
            {error && <p className="status status-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !draft.title.trim()}>{saving ? 'Saving…' : 'Save issue'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
