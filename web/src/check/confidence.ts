/**
 * Confidence bands for Gemini's findings, used wherever a finding's confidence is shown (the Checks page and the check
 * results). This is the one place they are set: tune them here once a calibration analysis says what Gemini's numbers
 * mean on site. The server already shows anything under 0.5 as "can't judge" (server/app/validate.py), so a flagged
 * finding is at least 0.5.
 *
 * A band is taken from the number as shown, rounded to two decimals, so "0.85" never sits next to "Medium".
 */
export const CONFIDENCE_BANDS = { high: 0.85, medium: 0.6 } as const

export type ConfidenceBand = 'high' | 'medium' | 'low'

export const BAND_LABEL: Record<ConfidenceBand, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** What a low band asks of the reader. */
export const LOW_CONFIDENCE_HINT = 'take a closer look'

/** The confidence as shown: two decimals, inside 0..1. */
export function shownConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0
  return Math.round(Math.min(1, Math.max(0, c)) * 100) / 100
}

export function confidenceBand(c: number): ConfidenceBand {
  const shown = shownConfidence(c)
  return shown >= CONFIDENCE_BANDS.high ? 'high' : shown >= CONFIDENCE_BANDS.medium ? 'medium' : 'low'
}

/** "High · 0.92", "Medium · 0.71", "Low · 0.55 — take a closer look" (the hint can be left off where space is short). */
export function confidenceText(c: number, { hint = true }: { hint?: boolean } = {}): string {
  const band = confidenceBand(c)
  const text = `${BAND_LABEL[band]} · ${shownConfidence(c).toFixed(2)}`
  return hint && band === 'low' ? `${text} — ${LOW_CONFIDENCE_HINT}` : text
}
