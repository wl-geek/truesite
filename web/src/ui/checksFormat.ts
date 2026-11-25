// Wording for the Checks page (ChecksPage.tsx), following the copy rules (spec 4.4): plain words, and the offline
// stand-in is never passed off as Gemini.
import type { CheckSource, FindingReview, RunSummary, Usage } from '../api/types'
import { SITE_VIEWPOINTS } from './siteViewpoints'

const SOURCE: Record<CheckSource, string> = { virtual: 'Virtual demo', live: 'Live AR', sample: 'Ready-made view' }

export function sourceLabel(source: CheckSource | null): string {
  return source ? SOURCE[source] : 'Source not recorded'
}

/** "P1 · South approach" for the site's viewpoints; any other anchor by its id. */
export function viewpointLabel(projectId: string, anchorId: string): string {
  const vp = projectId === 'site' ? SITE_VIEWPOINTS.find((v) => v.id === anchorId) : undefined
  return vp ? `${vp.id} · ${vp.name}` : anchorId
}

export type ReviewState = { kind: 'todo' | 'done' | 'none'; text: string }

/** "3 to review", "Reviewed", or "Nothing flagged" when Gemini flagged no deviation. */
export function reviewState(run: Pick<RunSummary, 'needs_review' | 'reviewed'>): ReviewState {
  if (run.needs_review > 0) return { kind: 'todo', text: `${run.needs_review} to review` }
  return run.reviewed > 0 ? { kind: 'done', text: 'Reviewed' } : { kind: 'none', text: 'Nothing flagged' }
}

export function needsReview(run: Pick<RunSummary, 'needs_review'>): boolean {
  return run.needs_review > 0
}

export type Totals = {
  checks: number; toReview: number; highOpen: number; reviewed: number; confirmed: number; dismissed: number; checksToReview: number
}

/** The summary tiles: across every listed check. */
export function totals(runs: readonly RunSummary[]): Totals {
  const t: Totals = { checks: runs.length, toReview: 0, highOpen: 0, reviewed: 0, confirmed: 0, dismissed: 0, checksToReview: 0 }
  for (const r of runs) {
    t.toReview += r.needs_review
    t.highOpen += r.high_open
    t.reviewed += r.reviewed
    t.confirmed += r.confirmed
    t.dismissed += r.dismissed
    if (r.needs_review > 0) t.checksToReview += 1
  }
  return t
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function usd(cost: number): string {
  return `US$${cost.toFixed(3)}`
}

/** "US$0.015 · 8.4 s": the estimated Gemini cost and the server's time for the call. */
export function costAndTime(run: Pick<RunSummary, 'cost_usd_est' | 'duration_ms'>): string {
  const parts = [run.cost_usd_est === null ? null : usd(run.cost_usd_est), run.duration_ms === null ? null : seconds(run.duration_ms)]
  return parts.filter(Boolean).join(' · ') || '—'
}

export const OFFLINE_MODEL = 'fake'

/** The model that judged the check. The offline stand-in (GEMINI_MODE=fake) says so. */
export function modelLabel(modelVersion: string | null): string {
  if (modelVersion === OFFLINE_MODEL) return 'Offline stand-in (not Gemini)'
  return modelVersion ?? 'Not recorded'
}

/** "3f2a9c1e8b7d…e81b": enough of a SHA-256 to compare by eye; the full value goes in the title. */
export function shortHash(hex: string): string {
  return hex.length > 20 ? `${hex.slice(0, 12)}…${hex.slice(-4)}` : hex
}

const count = (n: number) => n.toLocaleString('en-US')

export function tokensText(u: Usage): string {
  return `${count(u.prompt_tokens)} in · ${count(u.output_tokens)} out · ${count(u.thought_tokens)} thinking · ${count(u.total_tokens)} total`
}

/** Local hours and minutes, "14:35". */
export function clockTime(iso: string): string {
  const t = new Date(iso)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

/** The full local date and time, for a title or the audit trail. */
export function exactTime(iso: string, locale?: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  return t.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** "Confirmed by you · 14:35" or "Dismissed as a false alarm · 14:35". */
export function decisionLine(review: FindingReview): string {
  const what = review.decision === 'confirmed' ? 'Confirmed by you' : 'Dismissed as a false alarm'
  return `${what} · ${clockTime(review.at)}`
}

/** A crop of the photo around a finding's evidence box: CSS percentages for the photo inside the crop and for the box. */
export type Crop = {
  img: { width: string; height: string; left: string; top: string }
  box: { width: string; height: string; left: string; top: string }
}

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`

/**
 * The thumbnail on a finding: the evidence box with room around it (half its size again, at least 18% of the photo),
 * shaped to the thumbnail (`thumbAspect`, width / height) for a photo of `photoAspect`, kept inside the photo.
 */
export function cropFor(box: readonly [number, number, number, number], photoAspect: number, thumbAspect = 4 / 3): Crop {
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1, Math.max(0, v / 1000)))
  let w = Math.max((x1 - x0) * 1.5, 0.18)
  let h = Math.max((y1 - y0) * 1.5, 0.18)
  // Fractions of the photo; w * photoAspect / h is the crop's pixel aspect.
  if ((w * photoAspect) / h > thumbAspect) h = (w * photoAspect) / thumbAspect
  else w = (h * thumbAspect) / photoAspect
  if (w > 1) { h /= w; w = 1 }
  if (h > 1) { w /= h; h = 1 }
  const left = Math.min(1 - w, Math.max(0, (x0 + x1) / 2 - w / 2))
  const top = Math.min(1 - h, Math.max(0, (y0 + y1) / 2 - h / 2))
  return {
    img: { width: pct(1 / w), height: pct(1 / h), left: pct(-left / w), top: pct(-top / h) },
    box: { width: pct((x1 - x0) / w), height: pct((y1 - y0) / h), left: pct((x0 - left) / w), top: pct((y0 - top) / h) },
  }
}

/** What a review request's failure means, in plain words. */
export function reviewErrorMessage(err: { status: number; code?: string }): string {
  if (err.code === 'rate_limited') return 'Too many decisions from this network. Try again in a few minutes.'
  if (err.code === 'unknown_run') return 'This check is no longer on the server, so the decision was not saved.'
  if (err.status === 0) return 'No connection. Your decision was not saved: try again.'
  return "Couldn't save your decision. Try again."
}
