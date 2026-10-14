import type { CheckResult } from '../api/types'
import { boxToCss } from './findingFormat'

export type EvidenceViewProps = { imageUrl: string; result: CheckResult; selectedMark: number | null; onSelect: (mark: number) => void }

/** The checked photo with the model's evidence boxes; the selected finding is highlighted. */
export function EvidenceView({ imageUrl, result, selectedMark, onSelect }: EvidenceViewProps) {
  return (
    <figure className="evidence">
      <div className="evidence-frame">
        <img src={imageUrl} alt="Photo used for the as-built check" />
        {result.findings.filter((f) => f.evidence_box && f.status !== 'present_ok').map((f) => (
          <button key={f.mark} type="button" style={boxToCss(f.evidence_box!)} onClick={() => onSelect(f.mark)}
            className={`evidence-box sev-${f.severity ?? 'none'}${f.mark === selectedMark ? ' evidence-selected' : ''}`}
            aria-label={`Mark ${f.mark}: ${f.name}`}>
            <span>{f.mark}</span>
          </button>
        ))}
        {result.unexpected.filter((u) => u.evidence_box).map((u, i) => (
          <span key={`u${i}`} className="evidence-box sev-unexpected" style={boxToCss(u.evidence_box!)} title={u.description} />
        ))}
      </div>
    </figure>
  )
}
