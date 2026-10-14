import { describe, expect, it } from 'vitest'
import type { Element, Finding } from '../api/types'
import { findingAnchorPoint, makePins } from './pins'

const el: Element = { guid: 'g1', ifc_class: 'IfcDoor', name: 'Door', storey: 'L1', bbox_m: [[1, 0, 0], [2, 0.2, 2]], load_bearing: null, props: {} }
const f = (status: Finding['status'], severity: Finding['severity']): Finding =>
  ({ mark: 1, guid: 'g1', name: 'Door', ifc_class: 'IfcDoor', status, confidence: 0.9, evidence_box: null, offset: null, explanation: '', severity })

describe('pins', () => {
  it('sits at the element bbox centre in IFC coordinates', () => {
    expect(findingAnchorPoint(el)).toEqual([1.5, 0.1, 1])
  })
  it('pins only deviations with a known element', () => {
    const map = new Map([['g1', el]])
    expect(makePins([f('misplaced', 'medium')], map).children).toHaveLength(1)
    expect(makePins([f('present_ok', null), f('cannot_judge', null)], map).children).toHaveLength(0)
    expect(makePins([{ ...f('missing', 'high'), guid: 'zz' }], map).children).toHaveLength(0)
  })
})
