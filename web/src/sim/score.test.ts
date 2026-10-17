import { describe, expect, it } from 'vitest'
import type { Finding } from '../api/types'
import type { Deviation } from './asBuilt'
import { scoreCheck, scoreLine } from './score'

const f = (name: string, status: Finding['status']): Finding => ({
  mark: 1, guid: name, name, ifc_class: 'IfcColumn', status, confidence: 0.9, evidence_box: null, offset: null, explanation: '', severity: null,
})
const planted: Deviation[] = [
  { element: 'A', kind: 'missing', featuredAt: 'P1' },
  { element: 'B', kind: 'shifted', offsetM: [0.4, 0, 0], featuredAt: 'P1' },
  { element: 'C', kind: 'missing', featuredAt: 'P2' },
]

describe('scoreCheck', () => {
  it('counts planted defects in view as found when Gemini flags any deviation, and lists the rest', () => {
    const s = scoreCheck([f('A', 'missing'), f('B', 'present_ok'), f('D', 'misplaced'), f('E', 'present_ok')], planted)
    expect(s.inView.map((x) => [x.planted.element, x.found])).toEqual([['A', true], ['B', false]])
    expect(s.falseAlarms.map((x) => x.name)).toEqual(['D'])
    expect(s.outOfView.map((d) => d.element)).toEqual(['C'])
    expect(scoreLine(s)).toBe('Gemini found 1 of 2 planted defects in this view · 1 false alarm')
  })

  it('reads well with nothing planted in view and nothing flagged', () => {
    expect(scoreLine(scoreCheck([f('E', 'present_ok')], planted))).toBe('No planted defect is in this view · no false alarms')
    expect(scoreLine(scoreCheck([f('C', 'different_from_design')], planted))).toBe('Gemini found 1 of 1 planted defect in this view · no false alarms')
  })
})


describe('scoreCheck with elements that moved together', () => {
  it('counts a flagged cage of a shifted column towards that defect, not as a false alarm', () => {
    const moved: Deviation[] = [{ element: 'RC column B2', kind: 'shifted', offsetM: [-0.6, 0, 0], alsoMoves: ['Column cage B2'], featuredAt: 'P1' }]
    const s = scoreCheck([f('RC column B2', 'present_ok'), f('Column cage B2', 'misplaced')], moved)
    expect(s.inView[0].found).toBe(true)
    expect(s.falseAlarms).toEqual([])
  })
})

describe('scoreCheck edge cases (mutation-tested)', () => {
  it('counts every deviation status as found, but not "can\'t judge" or a match', () => {
    for (const status of ['missing', 'misplaced', 'different_from_design'] as const) {
      expect(scoreCheck([f('A', status)], planted).inView[0].found, status).toBe(true)
    }
    for (const status of ['present_ok', 'cannot_judge'] as const) {
      expect(scoreCheck([f('A', status)], planted).inView[0].found, status).toBe(false)
    }
  })

  it('never counts a match or a "can\'t judge" on an unchanged element as a false alarm', () => {
    const s = scoreCheck([f('D', 'present_ok'), f('E', 'cannot_judge'), f('F', 'different_from_design'), f('G', 'missing')], planted)
    expect(s.falseAlarms.map((x) => x.name)).toEqual(['F', 'G'])
    expect(s.inView).toEqual([])
    expect(s.outOfView.map((d) => d.element)).toEqual(['A', 'B', 'C'])
    expect(scoreLine(s)).toBe('No planted defect is in this view · 2 false alarms')
  })

  it('keeps the planted entry and Gemini\'s finding together', () => {
    const finding = f('B', 'misplaced')
    const [x] = scoreCheck([finding], planted).inView
    expect(x.planted).toBe(planted[1])
    expect(x.finding).toBe(finding)
  })

  it('counts several planted defects found in one view', () => {
    const s = scoreCheck([f('A', 'missing'), f('B', 'misplaced'), f('C', 'missing')], planted)
    expect(scoreLine(s)).toBe('Gemini found 3 of 3 planted defects in this view · no false alarms')
    expect(scoreLine(scoreCheck([f('A', 'present_ok'), f('B', 'cannot_judge')], planted)))
      .toBe('Gemini found 0 of 2 planted defects in this view · no false alarms')
  })
})
