/**
 * How the check did against what we planted (virtual demo only): for each planted defect in this view, did
 * Gemini flag it? Plus anything flagged that we didn't plant. Gemini never sees the planted list.
 */
import type { Finding } from '../api/types'
import type { Deviation } from './asBuilt'

const DEVIATIONS = new Set<Finding['status']>(['missing', 'misplaced', 'different_from_design'])

export type Score = {
  /** Planted defects among the elements checked in this view, with the finding Gemini gave each. */
  inView: { planted: Deviation; finding: Finding; found: boolean }[]
  /** Deviations Gemini reported on elements we didn't change. */
  falseAlarms: Finding[]
  /** Planted defects outside this view: not checked, not counted. */
  outOfView: Deviation[]
}

/** The elements a planted defect changed: the element, plus what moved with it (a shifted column's cage). */
const touched = (d: Deviation): string[] => [d.element, ...(d.kind === 'shifted' ? d.alsoMoves ?? [] : [])]

export function scoreCheck(findings: readonly Finding[], planted: readonly Deviation[]): Score {
  const byName = new Map(findings.map((f) => [f.name, f]))
  const plantedNames = new Set(planted.flatMap(touched))
  const inView = planted.filter((d) => byName.has(d.element)).map((d) => {
    const finding = byName.get(d.element)!
    const flagged = touched(d).some((n) => DEVIATIONS.has(byName.get(n)?.status ?? 'present_ok'))
    return { planted: d, finding, found: flagged }
  })
  return {
    inView,
    falseAlarms: findings.filter((f) => DEVIATIONS.has(f.status) && !plantedNames.has(f.name)),
    outOfView: planted.filter((d) => !byName.has(d.element)),
  }
}

/** "Gemini found 2 of 3 planted defects in this view · no false alarms". */
export function scoreLine(s: Score): string {
  const found = s.inView.filter((x) => x.found).length
  const alarms = s.falseAlarms.length
  const head = s.inView.length
    ? `Gemini found ${found} of ${s.inView.length} planted defect${s.inView.length === 1 ? '' : 's'} in this view`
    : 'No planted defect is in this view'
  return `${head} · ${alarms === 0 ? 'no false alarms' : `${alarms} false alarm${alarms === 1 ? '' : 's'}`}`
}
