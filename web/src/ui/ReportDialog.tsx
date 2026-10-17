import { useEffect, useState } from 'react'
import { ApiError, writeReport } from '../api/client'
import type { IssueLanguage, SiteReport } from '../api/types'
import { askErrorMessage } from './askFormat'
import { LANGUAGES } from './languages'

/** `offline`: the server runs the offline stand-in, so the draft isn't Gemini's (audit C-04). */
type Props = { runIds: string[]; offline?: boolean; onClose: () => void }

/** Gemini writes the day's site report from this session's checks: safety first, then structure, then progress. */
export function ReportDialog({ runIds, offline = false, onClose }: Props) {
  const [language, setLanguage] = useState<IssueLanguage>('en')
  const [report, setReport] = useState<SiteReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setError(null)
    writeReport({ run_ids: runIds, language })
      .then((r) => !cancelled && setReport(r))
      .catch((e: unknown) => !cancelled && setError(askErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)).replace("Couldn't answer", "Couldn't write the report")))
    return () => { cancelled = true }
  }, [runIds, language])

  async function copy() {
    if (!report) return
    try {
      await navigator.clipboard.writeText(reportText(report))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <div>
            <p className="eyebrow">Draft by {offline ? 'the offline stand-in' : 'Gemini'} · check before sending</p>
            <h2 id="report-title">{report?.title ?? "Today's site report"}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <label className="issue-language">
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value as IssueLanguage)} disabled={!report && !error}>
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        {!report && !error && <p className="status">{offline ? 'The offline stand-in' : 'Gemini'} is writing the report from {runIds.length} check{runIds.length === 1 ? '' : 's'}…</p>}
        {error && <p className="status status-error" role="alert">{error}</p>}
        {report && (
          <div className="report">
            <p>{report.summary}</p>
            <Section title="Safety" items={report.safety} tone="high" />
            <Section title="Structure" items={report.structure} tone="medium" />
            <Section title="Progress" items={report.progress} tone="low" />
            <Section title="Next steps" items={report.next_steps} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy the report'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, items, tone }: { title: string; items: string[]; tone?: 'high' | 'medium' | 'low' }) {
  if (!items.length) return null
  return (
    <section className={`report-section${tone ? ` report-${tone}` : ''}`}>
      <h3>{title}</h3>
      <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </section>
  )
}

/** Plain text for pasting into a chat or an email. */
export function reportText(r: SiteReport): string {
  const part = (title: string, items: string[]) => (items.length ? `\n${title}\n${items.map((t) => `- ${t}`).join('\n')}\n` : '')
  return `${r.title}\n\n${r.summary}\n${part('Safety', r.safety)}${part('Structure', r.structure)}${part('Progress', r.progress)}${part('Next steps', r.next_steps)}`
}
