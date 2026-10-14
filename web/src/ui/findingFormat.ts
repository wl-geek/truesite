// Wording for check results, following the spec's copy rules (4.4): rough offsets, never
// millimetres; "Can't judge from this photo" instead of guessing.
import type { Box, CheckResult, Finding, ImageQuality, Offset, Severity, Status } from '../api/types'

export const NOT_A_SURVEY = 'Visual check, not a survey.'

const STATUS: Record<Status, string> = {
  present_ok: 'Matches the design',
  missing: 'Missing',
  misplaced: 'Misplaced',
  different_from_design: 'Different from design',
  cannot_judge: "Can't judge from this photo",
}

const DIRECTION: Record<Offset['direction'], string> = {
  left: 'left', right: 'right', up: 'higher', down: 'lower', forward: 'closer', back: 'further away', none: '',
}

export function offsetText(offset: Offset | null): string {
  if (!offset || offset.direction === 'none') return ''
  const word = DIRECTION[offset.direction]
  return offset.approx_cm > 0 ? `about ${offset.approx_cm} cm ${word}` : `slightly ${word}`
}

export function statusText(f: Pick<Finding, 'status' | 'offset'>): string {
  const off = f.status === 'misplaced' ? offsetText(f.offset) : ''
  return off ? `${STATUS[f.status]}, ${off}` : STATUS[f.status]
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** Deviations first (high -> low, then by mark), then can't-judge, then matches. */
export function groupFindings(findings: readonly Finding[]): { deviations: Finding[]; unsure: Finding[]; ok: Finding[] } {
  const deviations = findings.filter((f) => f.severity !== null)
    .sort((a, b) => SEVERITY_RANK[a.severity!] - SEVERITY_RANK[b.severity!] || a.mark - b.mark)
  return {
    deviations,
    unsure: findings.filter((f) => f.status === 'cannot_judge'),
    ok: findings.filter((f) => f.status === 'present_ok'),
  }
}

/** A 0-1000 [ymin, xmin, ymax, xmax] box as CSS percentages over the photo. */
export function boxToCss(box: Box): { top: string; left: string; width: string; height: string } {
  const [y0, x0, y1, x1] = box
  return { top: `${y0 / 10}%`, left: `${x0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }
}

const QUALITY: Record<Exclude<ImageQuality, 'good'>, string> = {
  too_dark: 'The photo is too dark to judge. Add light and take it again.',
  blurred: 'The photo is blurred. Hold still and take it again.',
  marker_far: 'You are too far from the code. Move closer and take it again.',
  occluded: 'Something is in the way. Clear the view and take it again.',
}

export function imageQualityMessage(q: ImageQuality): string | null {
  return q === 'good' ? null : QUALITY[q]
}

export function savedLabel(iso: string, locale?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Saved result'
  return `Saved result from ${d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

export function summaryCounts(result: CheckResult): string {
  const { deviations, unsure, ok } = groupFindings(result.findings)
  return `${deviations.length} possible deviation${deviations.length === 1 ? '' : 's'} · ${ok.length} match · ${unsure.length} can't judge`
}
