import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Finding, RunDetail, RunSummary } from '../api/types'
import { AuditTrail, ChecksPage, FindingCard, RunCards, RunTable, Tiles } from './ChecksPage'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()

const finding = (over: Partial<Finding> = {}): Finding => ({
  mark: 3, guid: 'g'.repeat(22), name: 'RC column C2', ifc_class: 'IfcColumn', status: 'missing', confidence: 0.55,
  evidence_box: [100, 200, 400, 300], offset: null, explanation: 'Nothing visible where the design shows it.', severity: 'high', ...over,
})

const card = (over: Partial<Parameters<typeof FindingCard>[0]> = {}) => renderToStaticMarkup(createElement(FindingCard, {
  f: finding(), runId: 'r'.repeat(22), element: null, photoUrl: 'blob:photo', aspect: 4 / 3, selected: false, onSelect: () => undefined,
  review: null, busy: false, error: null, onDecide: () => undefined, onDraft: () => undefined, issueSaved: false, ...over,
}))

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  run_id: 'AbC_d-1234567890xyz', created_at: '2026-11-25T09:00:00Z', project_id: 'site', anchor_id: 'P1', source: 'virtual',
  image_quality: 'good', by_status: { present_ok: 10, missing: 2, misplaced: 1, different_from_design: 0, cannot_judge: 3 },
  by_severity: { high: 2, medium: 1, low: 0 }, unexpected: 1, lowest_confidence: 0.55, needs_review: 3, confirmed: 0, dismissed: 0,
  reviewed: 0, high_open: 2, model_version: 'gemini-3.8-flash', cost_usd_est: 0.0151, duration_ms: 8400, summary: '', ...over,
})

describe('ChecksPage', () => {
  it('starts by loading the list, or the one check asked for', () => {
    expect(text(renderToStaticMarkup(createElement(ChecksPage, {})))).toContain('Checks Every check from this browser, newest first.')
    expect(text(renderToStaticMarkup(createElement(ChecksPage, { runId: 'AbC_d-1234567890xyz' })))).toBe('Loading the check…')
  })

  it('offers Confirm, Dismiss and Draft issue on a flagged finding, with its band, why it matters and the crop', () => {
    const html = card()
    const t = text(html)
    expect(t).toContain('3 RC column C2 IfcColumn'.replace('IfcColumn', 'Column'))
    expect(t).toContain('Missing High severity Confidence Low · 0.55 — take a closer look')
    expect(t).toContain('Gemini: Nothing visible where the design shows it.')
    expect(t).toContain('Why it matters: The floor above is not carried as designed')
    expect(t).toContain('Confirm finding Dismiss as false alarm Draft issue')
    expect(html).toContain('class="fcard-crop"')
    expect(html).toContain('id="finding-3"')
  })

  it('shows a decision with its time and Undo decision, and no Draft issue once dismissed', () => {
    const at = new Date(2026, 10, 25, 14, 35).toISOString()
    const confirmed = text(card({ review: { decision: 'confirmed', at } }))
    expect(confirmed).toContain('✓ Confirmed by you · 14:35 Undo decision Draft issue')
    const dismissed = card({ review: { decision: 'dismissed', at } })
    expect(text(dismissed)).toContain('Dismissed as a false alarm · 14:35 Undo decision')
    expect(dismissed).not.toContain('Draft issue')
    expect(dismissed).toContain('fcard-dismissed')
    expect(text(card({ busy: true, review: { decision: 'confirmed', at } }))).toContain('Saving…')
    expect(text(card({ error: "Couldn't save your decision. Try again." }))).toContain("Couldn't save your decision. Try again.")
  })

  it('offers no decision on a can\'t-judge or matching mark, and no Draft issue from a poor photo', () => {
    const unsure = text(card({ f: finding({ status: 'cannot_judge', severity: null, confidence: 0.3, explanation: 'Low confidence.' }) }))
    expect(unsure).toContain("Can't judge from this photo")
    expect(unsure).not.toContain('Confidence')
    expect(unsure).not.toContain('Confirm finding')
    expect(text(card({ onDraft: undefined }))).not.toContain('Draft issue')
  })

  it('names the offline stand-in as the author of its explanations, never Gemini', () => {
    expect(text(card({ by: 'Stand-in' }))).toContain('Stand-in: Nothing visible where the design shows it.')
    expect(text(card({ by: 'Stand-in' }))).not.toContain('Gemini:')
  })

  it('renders model text as text, never as HTML', () => {
    const html = card({ f: finding({ explanation: '<img src=x onerror=alert(1)>' }) })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('lists checks as table rows that link to the check', () => {
    const html = renderToStaticMarkup(createElement(RunTable, { runs: [summary(), summary({ run_id: 'x'.repeat(22), anchor_id: 'P3', needs_review: 0, reviewed: 3, model_version: 'fake', source: null })] }))
    expect(html).toContain('href="/checks?run=AbC_d-1234567890xyz"')
    const t = text(html)
    expect(t).toContain("P1 · South approach Virtual demo 2 high 1 medium 3 can't judge 1 not in design Low · 0.55 3 to review US$0.015 · 8.4 s")
    expect(t).toContain('P3 · Under the open bay Source not recorded · offline stand-in')
    expect(t).toContain('✓ Reviewed')
  })

  it('lists checks as cards on phones', () => {
    const t = text(renderToStaticMarkup(createElement(RunCards, { runs: [summary({ lowest_confidence: null, by_severity: { high: 0, medium: 0, low: 0 }, by_status: { present_ok: 12, missing: 0, misplaced: 0, different_from_design: 0, cannot_judge: 0 }, unexpected: 0, needs_review: 0 })] })))
    expect(t).toContain('P1 · South approach Nothing flagged Virtual demo')
    expect(t).toContain('All match the design')
  })

  it('sums the tiles', () => {
    const t = text(renderToStaticMarkup(createElement(Tiles, { sum: { checks: 4, toReview: 5, highOpen: 2, reviewed: 3, confirmed: 2, dismissed: 1, checksToReview: 2 } })))
    expect(t).toBe('Checks run 4 from this browser Findings to review 5 in 2 checks High severity 2 structure and guardrails, false alarms left out Reviewed 3 2 confirmed · 1 dismissed')
  })
})

describe('AuditTrail', () => {
  const run = (warnings: string[]): RunDetail => ({
    run_id: 'AbC_d-1234567890xyz', created_at: '2026-11-25T09:00:00Z', project_id: 'site', anchor_id: 'P1', source: 'live',
    context: {}, review: {}, provenance: null, duration_ms: 27300, images: { photo: 'p', render: 'r', overlay: null },
    result: {
      project_id: 'site', anchor_id: 'P1', image_quality: 'good', pose_quality: 'good', findings: [], unexpected: [], summary: '',
      warnings, usage: null, model_version: 'gemini-3.8-flash', saved_at: null,
    },
  })
  const trail = (warnings: string[]) => text(renderToStaticMarkup(createElement(AuditTrail, { run: run(warnings), findings: [], judge: 'Gemini' })))

  it('shows the second look as one line, never the raw verify notes or timing', () => {
    const t = trail(['Photo is a little dark', 'verify: mark 7 Guardrail G1: missing -> present_ok', 'verify: mark 11 ran out of time',
      'verify: timing {"model":"gemini-3.8-flash","unfinished":1,"total_s":27.29}'])
    expect(t).toContain('Second look 2 marks looked at again close up: 1 changed, 0 unchanged, 1 not back in time')
    expect(t).toContain('Server notes Photo is a little dark')
    expect(t).not.toContain('verify:')
  })

  it('hides Server notes when only second-look notes were left', () => {
    const t = trail(['verify: mark 3 Steel column C2: present_ok kept (present_ok 0.91)', 'verify: timing {"total_s":9}'])
    expect(t).not.toContain('Server notes')
    expect(t).not.toContain('verify:')
  })
})
