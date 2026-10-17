import { describe, expect, it } from 'vitest'
import type { Finding } from '../api/types'
import { whyItMatters } from './risk'

const f = (over: Partial<Finding>): Finding => ({
  mark: 1, guid: 'g', name: 'X', ifc_class: 'IfcColumn', status: 'missing', confidence: 0.9, evidence_box: null, offset: null,
  explanation: '', severity: 'high', ...over,
})

describe('whyItMatters', () => {
  it('names the site risk of each kind of deviation', () => {
    expect(whyItMatters(f({ ifc_class: 'IfcRailing', name: 'Edge protection east' }))).toMatch(/Fall hazard/)
    expect(whyItMatters(f({ name: 'RC column C2' }))).toMatch(/propped/)
    expect(whyItMatters(f({ name: 'RC column C1', status: 'misplaced' }))).toMatch(/Setting-out error/)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Brace roof south A-B (1)' }))).toMatch(/stability/)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Truss T3 vertical 7' }))).toMatch(/truss/)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Purlin P6 B-C' }))).toMatch(/sheeting/)
    expect(whyItMatters(f({ ifc_class: 'IfcBeam', name: 'Edge beam B3-C3' }))).toMatch(/tied together/)
    expect(whyItMatters(f({ ifc_class: 'IfcSlab', status: 'different_from_design' }))).toMatch(/specification/)
  })

  it('says nothing when the element matches or can\'t be judged', () => {
    expect(whyItMatters(f({ status: 'present_ok' }))).toBeNull()
    expect(whyItMatters(f({ status: 'cannot_judge' }))).toBeNull()
  })
})

describe('whyItMatters: which rule wins (mutation-tested)', () => {
  const GENERIC_MISSING = 'Missing from the design: check whether it is still to come or was left out.'
  const GENERIC_MISPLACED = 'Built away from the design: confirm with the engineer before work continues here.'
  const GENERIC_DIFFERENT = 'Built differently from the design: check the drawing and the specification.'

  it('gives the full fixed text of each specific rule', () => {
    expect(whyItMatters(f({ ifc_class: 'IfcRailing', name: 'Edge protection east' })))
      .toBe('Fall hazard: keep people away from this edge until the guardrail is back.')
    expect(whyItMatters(f({ name: 'RC column C2' })))
      .toBe('The floor above is not carried as designed: keep it propped and unloaded until the column is cast.')
    expect(whyItMatters(f({ name: 'Steel column B1', status: 'misplaced' })))
      .toBe("Setting-out error: what sits on this column won't bear as designed. Get the engineer to confirm before the next pour or lift.")
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Brace wall north A-B (2)' })))
      .toBe('The frame relies on this brace for stability in wind: fit it before more steel goes up.')
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Truss T3 vertical 7' })))
      .toBe("An incomplete truss can't carry its roof load: no sheeting or loads on this truss until it's fixed.")
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Purlin P6 B-C' })))
      .toBe('The roof sheeting has nothing to fix to here: fit the purlin before sheeting this bay.')
    expect(whyItMatters(f({ ifc_class: 'IfcBeam', name: 'Beam C2-D2' })))
      .toBe('The frame is not tied together here: brace it temporarily until the beam is in.')
  })

  it('falls back to the general rule for each status when no element rule fits', () => {
    // missing, but not a rule's element: a steel column, a slab, a footing, a rebar cage
    for (const over of [{ name: 'Steel column C3' }, { ifc_class: 'IfcSlab', name: 'Slab L1 A-B' }, { ifc_class: 'IfcFooting', name: 'Pad footing A1' },
      { ifc_class: 'IfcReinforcingBar', name: 'Column cage C2' }]) {
      expect(whyItMatters(f(over)), over.name).toBe(GENERIC_MISSING)
    }
    // misplaced, but not a column: each element rule above is for missing elements only
    for (const over of [{ ifc_class: 'IfcRailing', name: 'Edge protection east' }, { ifc_class: 'IfcBeam', name: 'Edge beam B3-C3' },
      { ifc_class: 'IfcMember', name: 'Brace roof south A-B (1)' }, { ifc_class: 'IfcMember', name: 'Purlin P4 C-D' }]) {
      expect(whyItMatters(f({ ...over, status: 'misplaced' })), over.name).toBe(GENERIC_MISPLACED)
    }
    // different from design: never an element rule, even for a column or a guardrail
    for (const over of [{ name: 'RC column C2' }, { ifc_class: 'IfcRailing', name: 'Edge protection north' }, { ifc_class: 'IfcBeam', name: 'Beam A1-A2' }]) {
      expect(whyItMatters(f({ ...over, status: 'different_from_design' })), over.name).toBe(GENERIC_DIFFERENT)
    }
  })

  it('matches element names on whole words only', () => {
    expect(whyItMatters(f({ name: 'RCC column C2' }))).toBe(GENERIC_MISSING) // not "RC"
    expect(whyItMatters(f({ name: 'Column RC C2' }))).toBe(GENERIC_MISSING) // "RC" must lead the name
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Bracket B1' }))).toBe(GENERIC_MISSING)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Trussed rafter 4' }))).toBe(GENERIC_MISSING)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Purlins bay 2' }))).toBe(GENERIC_MISSING)
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'brace roof north A-B (3)' }))).toMatch(/stability in wind/) // any case
    // the member rules are for IfcMember: a beam called "Truss ..." is still a beam
    expect(whyItMatters(f({ ifc_class: 'IfcBeam', name: 'Truss support beam' }))).toMatch(/tied together/)
    expect(whyItMatters(f({ ifc_class: 'IfcBeam', name: 'Purlin P6 B-C' }))).toMatch(/tied together/)
    expect(whyItMatters(f({ ifc_class: 'IfcColumn', name: 'Brace column' }))).toBe(GENERIC_MISSING)
    // the column rule is for columns: an RC beam or slab is not propping a floor
    expect(whyItMatters(f({ ifc_class: 'IfcBeam', name: 'RC beam B1-B2' }))).toMatch(/tied together/)
    expect(whyItMatters(f({ ifc_class: 'IfcSlab', name: 'RC slab L1' }))).toBe(GENERIC_MISSING)
    // a truss member that is there but misplaced gets the general setting-out text
    expect(whyItMatters(f({ ifc_class: 'IfcMember', name: 'Truss T2 diagonal 3', status: 'misplaced' }))).toBe(GENERIC_MISPLACED)
  })
})
