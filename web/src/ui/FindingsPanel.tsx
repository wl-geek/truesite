import type { CheckResult, Finding } from '../api/types'
import { groupFindings, imageQualityMessage, NOT_A_SURVEY, savedLabel, statusText, summaryCounts } from './findingFormat'

export type FindingsPanelProps = {
  result: CheckResult
  selectedMark: number | null
  onSelect: (f: Finding) => void
  /** Shown on deviations once issue drafting is available (issue #11). */
  onDraftIssue?: (f: Finding) => void
  onClose?: () => void
  /** "Checked as shown: ..." when layers were hidden or the model was cut during the check (runCheck). */
  viewNote?: string | null
}

function Row({ f, selected, onSelect, onDraftIssue }: { f: Finding; selected: boolean; onSelect: (f: Finding) => void; onDraftIssue?: (f: Finding) => void }) {
  return (
    <li className={`finding${selected ? ' finding-selected' : ''}`}>
      <button type="button" className="finding-main" onClick={() => onSelect(f)} aria-pressed={selected}>
        <span className="mark-dot">{f.mark}</span>
        <span className="finding-text">
          <strong>{f.name || f.ifc_class}</strong>
          <span>{statusText(f)}</span>
          {f.explanation && <span className="finding-why">{f.explanation}</span>}
        </span>
        {f.severity && <span className={`badge badge-${f.severity}`}>{f.severity}</span>}
      </button>
      {onDraftIssue && f.severity && (
        <button type="button" className="btn btn-small" onClick={() => onDraftIssue(f)}>Draft issue</button>
      )}
    </li>
  )
}

/** Results of an as-built check (spec 4.1, 4.4, 8). Model text is rendered as plain text only. */
export function FindingsPanel({ result, selectedMark, onSelect, onDraftIssue, onClose, viewNote }: FindingsPanelProps) {
  const { deviations, unsure, ok } = groupFindings(result.findings)
  const quality = imageQualityMessage(result.image_quality)
  const greyed = quality !== null
  return (
    <section className="panel findings-panel" aria-label="As-built check results">
      <header className="panel-head">
        <div>
          <p className="eyebrow">{result.saved_at ? savedLabel(result.saved_at) : 'As-built check'}</p>
          <h2>{summaryCounts(result)}</h2>
        </div>
        {onClose && <button type="button" className="icon-btn" onClick={onClose} aria-label="Close results">×</button>}
      </header>
      <p className="note">{NOT_A_SURVEY}</p>
      {viewNote && <p className="note">{viewNote}</p>}
      {result.pose_quality === 'poor' && <p className="warn">The alignment was poor when this photo was taken: treat these results with care.</p>}
      {quality && <p className="warn" role="alert">{quality}</p>}
      {result.summary && <p className="summary">{result.summary}</p>}
      <div className={greyed ? 'findings greyed' : 'findings'}>
        {deviations.length > 0 && (
          <ul aria-label="Possible deviations">
            {deviations.map((f) => <Row key={f.mark} f={f} selected={f.mark === selectedMark} onSelect={onSelect} onDraftIssue={onDraftIssue} />)}
          </ul>
        )}
        {result.unexpected.length > 0 && (
          <>
            <h3>Not in the design</h3>
            <ul>{result.unexpected.map((u, i) => <li key={i} className="finding finding-plain">{u.description}</li>)}</ul>
          </>
        )}
        {unsure.length > 0 && (
          <details>
            <summary>{`Can't judge (${unsure.length})`}</summary>
            <ul>{unsure.map((f) => <Row key={f.mark} f={f} selected={f.mark === selectedMark} onSelect={onSelect} />)}</ul>
          </details>
        )}
        {ok.length > 0 && (
          <details>
            <summary>{`Matches the design (${ok.length})`}</summary>
            <ul>{ok.map((f) => <Row key={f.mark} f={f} selected={f.mark === selectedMark} onSelect={onSelect} />)}</ul>
          </details>
        )}
      </div>
    </section>
  )
}
