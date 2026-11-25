import { BAND_LABEL, confidenceBand, LOW_CONFIDENCE_HINT, shownConfidence } from '../check/confidence'

/**
 * Gemini's confidence in one finding, as its band and the number ("High · 0.92"), with one, two or three bars so the
 * band doesn't rest on colour alone. A low band adds "take a closer look". Used by the Checks page and the check
 * results, so both read the same. The bands are set in check/confidence.ts.
 */
export function ConfidenceBadge({ value, label = true, hint = true }: { value: number; label?: boolean; hint?: boolean }) {
  const band = confidenceBand(value)
  return (
    <span className={`conf conf-${band}`}>
      <span className="conf-bars" aria-hidden="true"><i /><i /><i /></span>
      <span>{label ? 'Confidence ' : ''}<span className="conf-band">{BAND_LABEL[band]}</span> · {shownConfidence(value).toFixed(2)}</span>
      {hint && band === 'low' && <span className="conf-hint">— {LOW_CONFIDENCE_HINT}</span>}
    </span>
  )
}
