import { describe, expect, it } from 'vitest'
import type { Finding, Severity, Status } from '../api/types'
import { isFlagged, reviewFirst } from './reviewOrder'

const f = (mark: number, status: Status, confidence: number, severity: Severity | null): Finding => ({
  mark, guid: `g${mark}`, name: `E${mark}`, ifc_class: 'IfcColumn', status, confidence, evidence_box: null, offset: null,
  explanation: '', severity,
})

describe('review first', () => {
  it('puts severity high to low first, then the less sure finding first, then by mark', () => {
    const findings = [
      f(1, 'present_ok', 0.95, null),
      f(2, 'missing', 0.9, 'low'),
      f(3, 'misplaced', 0.92, 'high'),
      f(4, 'cannot_judge', 0.3, null),
      f(5, 'missing', 0.55, 'high'),
      f(6, 'different_from_design', 0.71, 'medium'),
      f(7, 'missing', 0.92, 'high'),
      f(8, 'present_ok', 0.6, null),
      f(9, 'cannot_judge', 0.8, null),
    ]
    expect(reviewFirst(findings).map((x) => x.mark)).toEqual([5, 3, 7, 6, 2, 4, 9, 8, 1])
  })

  it('leaves the input alone', () => {
    const findings = [f(2, 'missing', 0.9, 'low'), f(1, 'missing', 0.9, 'high')]
    reviewFirst(findings)
    expect(findings.map((x) => x.mark)).toEqual([2, 1])
  })

  it('flags only findings with a severity', () => {
    expect([f(1, 'missing', 0.9, 'high'), f(2, 'cannot_judge', 0.3, null), f(3, 'present_ok', 0.9, null)].map(isFlagged))
      .toEqual([true, false, false])
  })
})
