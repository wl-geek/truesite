import type { Element } from '../api/types'
import { KIND_COLOURS } from '../scene/palette'
import { AskBox } from './AskBox'
import { askSuggestions, summarise } from './elementFacts'

export type ElementPanelProps = {
  projectId: string
  element: Element
  /** The model has more than one storey, so the IFC storey says something (elementFacts.ts). */
  multiStorey?: boolean
  onClose: () => void
  /** Bring the camera to this element. */
  onZoom?: () => void
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/**
 * The tapped element in plain words (bottom sheet on phones, side panel on wide screens): what it is, where, its size,
 * material and role, the design notes, Ask Gemini about it, and the IFC data folded away for BIM people.
 */
export function ElementPanel({ projectId, element, multiStorey = false, onClose, onZoom }: ElementPanelProps) {
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
            <circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M11 8v6M8 11h6" />
          </svg>
          Zoom to element
        </button>
      )}
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
