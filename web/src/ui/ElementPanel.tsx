import type { Element, Finding, Issue } from '../api/types'
import { whyItMatters } from '../check/risk'
import { KIND_COLOURS } from '../scene/palette'
import { AskBox } from './AskBox'
import { askSuggestions, summarise } from './elementFacts'
import { NOT_A_SURVEY, statusText } from './findingFormat'
import { CopyIssueButton } from './SavedIssues'
import { savedWhen } from './issueList'
import './elementPanel.css'

export type ElementPanelProps = {
  projectId: string
  element: Element
  /** The model has more than one storey, so the IFC storey says something (elementFacts.ts). */
  multiStorey?: boolean
  onClose: () => void
  /** Bring the camera to this element. */
  onZoom?: () => void
  /** The camera button's words: the viewer zooms, the virtual demo turns to face it. */
  zoomLabel?: string
  /** Its icon: a magnifier to zoom, a target to aim the view. */
  zoomIcon?: 'zoom' | 'aim'
  /** This element's finding from the last as-built check, if it was marked. */
  finding?: Finding | null
  /** Draft an issue from the finding; left out when the photo wasn't good enough to draft from. */
  onDraftIssue?: (f: Finding) => void
  /** The virtual demo only: what was planted on this element, said once a check has run. */
  planted?: string | null
  /** This browser's saved issues for this element. */
  savedIssues?: readonly Issue[]
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/**
 * The tapped element in plain words (bottom sheet on phones, side panel on wide screens): what it is, where, its size,
 * material and role, the design notes, Ask Gemini about it, and the IFC data folded away for BIM people.
 */
export function ElementPanel({ projectId, element, multiStorey = false, onClose, onZoom, zoomLabel = 'Zoom to element', zoomIcon = 'zoom',
  finding, onDraftIssue, planted, savedIssues = [] }: ElementPanelProps) {
  const title = element.name || 'Unnamed element'
  const s = summarise(element, { multiStorey })
  return (
    <aside className="panel element-panel" aria-label={`${s.typeLabel}: ${title}`}>
      <header className="ep-head">
        <div className="ep-title">
          <p className="ep-type"><span className="swatch" style={{ background: hex(KIND_COLOURS[s.kind]) }} aria-hidden="true" />{s.typeLabel}</p>
          <h2>{title}</h2>
          {s.location && <p className="ep-where">{s.location}</p>}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close element details">×</button>
      </header>
      {onZoom && (
        <button type="button" className="btn btn-small ep-zoom" onClick={onZoom}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {zoomIcon === 'aim'
              ? <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>
              : <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M11 8v6M8 11h6" /></>}
          </svg>
          {zoomLabel}
        </button>
      )}
      {finding && <CheckSection finding={finding} onDraftIssue={onDraftIssue} />}
      {savedIssues.length > 0 && (
        <section className="ep-issues" aria-label="Saved issues for this element">
          {savedIssues.map((issue) => (
            <div key={issue.id} className="ep-issue">
              <p className="ep-issue-head"><span aria-hidden="true">✓ </span>Issue saved · {savedWhen(issue.created_at)}</p>
              <p className="ep-issue-title">{issue.title}</p>
              <CopyIssueButton issue={issue} elementName={title} />
            </div>
          ))}
        </section>
      )}
      {planted && <p className="ep-planted"><strong>Planted in this demo:</strong> {planted}</p>}
      {s.facts.length > 0 && (
        <dl className="ep-facts">
          {s.facts.map((f) => (
            <div key={f.label} className="ep-fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      )}
      {s.notes.length > 0 && (
        <section className="ep-notes" aria-label="Design notes">
          <h3>Design notes</h3>
          {s.notes.map((n) => <p key={n}>{n}</p>)}
        </section>
      )}
      {s.more.length > 0 && (
        <dl className="ep-more">
          {s.more.map((f) => (<div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>))}
        </dl>
      )}
      {/* Keyed by element: a new element gets a fresh Ask box, so an earlier (or in-flight) answer never shows under it. */}
      <AskBox key={element.guid} projectId={projectId} element={element} suggestions={askSuggestions(element)} />
      <details className="ep-tech">
        <summary>BIM data (IFC)</summary>
        <dl>
          {s.technical.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd className={f.label === 'GUID' ? 'mono' : undefined}>{f.value}</dd></div>
          ))}
        </dl>
      </details>
    </aside>
  )
}

/** The element's result from the last as-built check, with Draft issue for a deviation. */
function CheckSection({ finding: f, onDraftIssue }: { finding: Finding; onDraftIssue?: (f: Finding) => void }) {
  const why = whyItMatters(f)
  const deviation = f.severity !== null
  return (
    <section className={`ep-check${deviation ? ` ep-check-${f.severity}` : ''}`} aria-label="As-built check result">
      <div className="ep-check-head">
        <h3>As-built check · mark {f.mark}</h3>
        {f.severity && <span className={`badge badge-${f.severity}`}>{f.severity}</span>}
      </div>
      <p className="ep-check-status">{statusText(f)}</p>
      {f.explanation && <p className="ep-check-why"><span className="finding-src">Gemini:</span> {f.explanation}</p>}
      {why && <p className="finding-risk"><span className="finding-src">Why it matters:</span> {why}</p>}
      {deviation && onDraftIssue && (
        <button type="button" className="btn btn-small" onClick={() => onDraftIssue(f)}>Draft issue</button>
      )}
      <p className="ep-check-note">{NOT_A_SURVEY}</p>
    </section>
  )
}
