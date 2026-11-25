import { describe, expect, it } from 'vitest'
import type { RunSummary } from '../api/types'
import {
  costAndTime, cropFor, decisionLine, exactTime, modelLabel, needsReview, reviewErrorMessage, reviewState, shortHash, sourceLabel, tokensText,
  totals, viewpointLabel,
} from './checksFormat'

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  run_id: 'r'.repeat(22), created_at: '2026-11-25T09:00:00Z', project_id: 'site', anchor_id: 'P1', source: 'virtual',
  image_quality: 'good', by_status: { present_ok: 10, missing: 2, misplaced: 1, different_from_design: 0, cannot_judge: 3 },
  by_severity: { high: 2, medium: 1, low: 0 }, unexpected: 0, lowest_confidence: 0.55, needs_review: 3, confirmed: 0,
  dismissed: 0, reviewed: 0, high_open: 2, model_version: 'gemini-3.8-flash', cost_usd_est: 0.0151, duration_ms: 8400,
  summary: '', ...over,
})

describe('Checks page wording', () => {
  it('names where a check came from', () => {
    expect([sourceLabel('virtual'), sourceLabel('live'), sourceLabel('sample'), sourceLabel(null)])
      .toEqual(['Virtual demo', 'Live AR', 'Ready-made view', 'Source not recorded'])
  })

  it('names the site viewpoints and leaves other anchors as they are', () => {
    expect(viewpointLabel('site', 'P1')).toBe('P1 · South approach')
    expect(viewpointLabel('site', 'D1')).toBe('D1')
    expect(viewpointLabel('room1', 'P1')).toBe('P1')
  })

  it('says what is left to review', () => {
    expect(reviewState(run())).toEqual({ kind: 'todo', text: '3 to review' })
    expect(reviewState(run({ needs_review: 1 }))).toEqual({ kind: 'todo', text: '1 to review' })
    expect(reviewState(run({ needs_review: 0, confirmed: 2, dismissed: 1, reviewed: 3 }))).toEqual({ kind: 'done', text: 'Reviewed' })
    const clean = run({ needs_review: 0, by_severity: { high: 0, medium: 0, low: 0 }, lowest_confidence: null, high_open: 0 })
    expect(reviewState(clean)).toEqual({ kind: 'none', text: 'Nothing flagged' })
    expect([needsReview(run()), needsReview(clean)]).toEqual([true, false])
  })

  it('adds up the summary tiles', () => {
    const runs = [run(), run({ needs_review: 0, confirmed: 1, dismissed: 2, reviewed: 3, high_open: 1 }), run({ needs_review: 1, high_open: 0 })]
    expect(totals(runs)).toEqual({ checks: 3, toReview: 4, highOpen: 3, reviewed: 3, confirmed: 1, dismissed: 2, checksToReview: 2 })
    expect(totals([])).toEqual({ checks: 0, toReview: 0, highOpen: 0, reviewed: 0, confirmed: 0, dismissed: 0, checksToReview: 0 })
  })

  it('writes cost and time small and plain', () => {
    expect(costAndTime(run())).toBe('US$0.015 · 8.4 s')
    expect(costAndTime(run({ cost_usd_est: null }))).toBe('8.4 s')
    expect(costAndTime(run({ duration_ms: null }))).toBe('US$0.015')
    expect(costAndTime(run({ cost_usd_est: null, duration_ms: null }))).toBe('—')
    expect(costAndTime(run({ cost_usd_est: 0.0004, duration_ms: 960 }))).toBe('US$0.000 · 1.0 s')
  })

  it('never passes the offline stand-in off as Gemini', () => {
    expect(modelLabel('fake')).toBe('Offline stand-in (not Gemini)')
    expect(modelLabel('gemini-3.8-flash')).toBe('gemini-3.8-flash')
    expect(modelLabel(null)).toBe('Not recorded')
  })

  it('shortens a SHA-256 and spells out tokens', () => {
    expect(shortHash('3f2a9c1e8b7d6a5f4e3d2c1b0a998877665544332211ffeeddccbbaa0099e81b')).toBe('3f2a9c1e8b7d…e81b')
    expect(shortHash('abc')).toBe('abc')
    expect(tokensText({ prompt_tokens: 6912, output_tokens: 1404, thought_tokens: 1200, total_tokens: 9516, cost_usd_est: 0.015 }))
      .toBe('6,912 in · 1,404 out · 1,200 thinking · 9,516 total')
  })

  it('writes the full time in 24-hour form, like the decisions', () => {
    const iso = new Date(2026, 10, 25, 18, 10, 31).toISOString()
    expect(exactTime(iso, 'en-US')).toBe('Wed, Nov 25, 2026, 18:10:31')
    expect(exactTime('not a time')).toBe('not a time')
  })

  it('says who decided and when, in local time', () => {
    const at = new Date(2026, 10, 25, 14, 35).toISOString()
    expect(decisionLine({ decision: 'confirmed', at })).toBe('Confirmed by you · 14:35')
    expect(decisionLine({ decision: 'dismissed', at })).toBe('Dismissed as a false alarm · 14:35')
  })

  it('crops the photo around the evidence box, shaped to the thumbnail and inside the photo', () => {
    // A 4:3 photo and a box in the middle, 20% of the width and 30% of the height: the crop is 45% high and 45% wide.
    const c = cropFor([350, 400, 650, 600], 4 / 3)
    expect(c.img).toEqual({ width: '222.22%', height: '222.22%', left: '-61.11%', top: '-61.11%' })
    expect(c.box).toEqual({ width: '44.44%', height: '66.67%', left: '27.78%', top: '16.67%' })
    // A small box in a corner of a 16:9 photo: at least 18% of the photo, pushed back inside it.
    const corner = cropFor([0, 990, 10, 1000], 16 / 9)
    expect(corner.img.left).toBe(`-${Math.round(((1 - 0.18) / 0.18) * 10000) / 100}%`)
    expect(corner.img.top).toBe('0%')
    // A box as big as the photo: the whole photo, no zoom.
    expect(cropFor([0, 0, 1000, 1000], 4 / 3).img).toEqual({ width: '100%', height: '100%', left: '0%', top: '0%' })
  })

  it('explains a failed decision in plain words', () => {
    expect(reviewErrorMessage({ status: 429, code: 'rate_limited' })).toBe('Too many decisions from this network. Try again in a few minutes.')
    expect(reviewErrorMessage({ status: 404, code: 'unknown_run' })).toBe('This check is no longer on the server, so the decision was not saved.')
    expect(reviewErrorMessage({ status: 0, code: 'network' })).toBe('No connection. Your decision was not saved: try again.')
    expect(reviewErrorMessage({ status: 500 })).toBe("Couldn't save your decision. Try again.")
  })
})
