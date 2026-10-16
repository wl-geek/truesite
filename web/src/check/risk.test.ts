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
