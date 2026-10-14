import { describe, expect, it } from 'vitest'
import type { CheckResult, Finding } from '../api/types'
import { boxToCss, groupFindings, imageQualityMessage, offsetText, savedLabel, statusText, summaryCounts } from './findingFormat'

const f = (mark: number, status: Finding['status'], severity: Finding['severity'], offset: Finding['offset'] = null): Finding =>
  ({ mark, guid: `g${mark}`, name: `E${mark}`, ifc_class: 'IfcWall', status, confidence: 0.9, evidence_box: null, offset, explanation: '', severity })

describe('findingFormat', () => {
  it('writes rough offsets, never millimetres', () => {
    expect(offsetText({ direction: 'left', approx_cm: 30 })).toBe('about 30 cm left')
    expect(offsetText({ direction: 'back', approx_cm: 50 })).toBe('about 50 cm further away')
    expect(offsetText({ direction: 'up', approx_cm: 0 })).toBe('slightly higher')
    expect(offsetText({ direction: 'none', approx_cm: 0 })).toBe('')
    expect(offsetText(null)).toBe('')
  })

  it('labels statuses per the copy rules', () => {
    expect(statusText({ status: 'misplaced', offset: { direction: 'right', approx_cm: 30 } })).toBe('Misplaced, about 30 cm right')
    expect(statusText({ status: 'cannot_judge', offset: null })).toBe("Can't judge from this photo")
    expect(statusText({ status: 'missing', offset: { direction: 'left', approx_cm: 10 } })).toBe('Missing')
  })

  it('orders deviations by severity then mark', () => {
    const g = groupFindings([f(1, 'present_ok', null), f(2, 'missing', 'low'), f(3, 'misplaced', 'high'), f(4, 'cannot_judge', null), f(5, 'missing', 'high')])
    expect(g.deviations.map((x) => x.mark)).toEqual([3, 5, 2])
    expect(g.unsure.map((x) => x.mark)).toEqual([4])
    expect(g.ok.map((x) => x.mark)).toEqual([1])
  })

  it('maps 0-1000 boxes to CSS percentages', () => {
    expect(boxToCss([100, 250, 500, 750])).toEqual({ top: '10%', left: '25%', width: '50%', height: '40%' })
  })

  it('explains bad photos and labels saved results', () => {
    expect(imageQualityMessage('good')).toBeNull()
    expect(imageQualityMessage('blurred')).toMatch(/blurred/)
    expect(savedLabel('2026-10-14T09:05:00Z', 'en-GB')).toMatch(/^Saved result from 14 Oct/)
    expect(savedLabel('nope')).toBe('Saved result')
  })

  it('summarises counts', () => {
    const r = { findings: [f(1, 'present_ok', null), f(2, 'missing', 'high')] } as CheckResult
    expect(summaryCounts(r)).toBe("1 possible deviation · 1 match · 0 can't judge")
  })
})
