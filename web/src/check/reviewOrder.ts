/**
 * "Review first": the order the Checks page lists a check's findings in, so a site engineer sees what needs attention
 * first. Flagged findings (those with a severity, set by code) come first, high to low; within a severity the less
 * sure finding comes first, since it most needs a person's eye. Then the can't-judge marks, then the matches (least
 * sure first). Ties go by mark.
 */
import type { Finding, Severity } from '../api/types'

type Orderable = Pick<Finding, 'mark' | 'status' | 'confidence' | 'severity'>

const GROUP: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** A deviation that a person should confirm or dismiss. */
export function isFlagged(f: Pick<Finding, 'severity'>): boolean {
  return f.severity !== null
}

function group(f: Orderable): number {
  if (f.severity) return GROUP[f.severity]
  return f.status === 'present_ok' ? 4 : 3
}

export function reviewFirst<F extends Orderable>(findings: readonly F[]): F[] {
  return [...findings].sort((a, b) => {
    const ga = group(a)
    const gb = group(b)
    if (ga !== gb) return ga - gb
    if (ga !== 3 && a.confidence !== b.confidence) return a.confidence - b.confidence
    return a.mark - b.mark
  })
}
