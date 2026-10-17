import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import type { VisibleElement } from '../scene/elements'
import { classPriority, keyDims, markCentres, markWeight, MAX_MARKS, selectMarks } from './marks'

function el(guid: string, ifc_class: string, props: Record<string, unknown> = {}, bbox: Element['bbox_m'] = [[0, 0, 0], [1, 0.1, 2]]): Element {
  return { guid, ifc_class, name: `${ifc_class} ${guid}`, storey: 'L1', bbox_m: bbox, load_bearing: null, props }
}
function vis(index: number, pixels: number, cx = 10, cy = 20, anchor = { x: cx, y: cy }): VisibleElement {
  return { index, pixels, coverage: pixels / 1000, box: [0, 0, 100, 100], centroid: { x: cx, y: cy }, anchor }
}

describe('marks', () => {
  it('ranks structure and guardrails, then openings, services, slabs and footings, then the rest', () => {
    expect(classPriority('IfcColumn')).toBe(0)
    expect(classPriority('IfcRailing')).toBe(0)
    expect(classPriority('IfcFooting')).toBe(1)
    expect(classPriority('IfcWall')).toBe(0)
    expect(classPriority('IfcPipeSegment')).toBe(1)
    expect(classPriority('IfcFurniture')).toBe(2)
  })

  it('ranks rebar after structure and openings, so cages never crowd columns out of the 25 marks (audit A-65)', () => {
    for (const cls of ['IfcReinforcingBar', 'IfcReinforcingMesh', 'IfcTendon']) {
      expect(classPriority(cls)).toBeGreaterThan(classPriority('IfcColumn'))
      expect(classPriority(cls)).toBeGreaterThan(classPriority('IfcDoor'))
    }
  })

  it('selects known elements once each, by priority then size, numbered from 1', () => {
    const elements = new Map([['w', el('w', 'IfcWall')], ['d', el('d', 'IfcDoor')], ['f', el('f', 'IfcFurniture')], ['s', el('s', 'IfcPipeSegment')]])
    const indexToGuid = ['f', 'd', 'w', 's', 'unknown', 'w']
    const marks = selectMarks([vis(0, 900), vis(1, 50), vis(2, 10), vis(3, 300), vis(4, 999), vis(5, 400)], indexToGuid, elements)
    expect(marks.map((m) => [m.mark, m.guid])).toEqual([[1, 'w'], [2, 's'], [3, 'd'], [4, 'f']])
    expect(marks[0].name).toBe('IfcWall w')
  })

  it('lets element types take turns, so thin members and guardrails get marks in a view full of big beams', () => {
    const elements = new Map<string, Element>([
      ...Array.from({ length: 10 }, (_, i) => [`b${i}`, el(`b${i}`, 'IfcBeam')] as const),
      ['m1', el('m1', 'IfcMember', { PredefinedType: 'PURLIN' })], ['m2', el('m2', 'IfcMember', { PredefinedType: 'PURLIN' })],
      ['r', el('r', 'IfcRailing')], ['f', el('f', 'IfcFooting')],
    ])
    const guids = [...elements.keys()]
    const visible = guids.map((g, i) => vis(i, g.startsWith('b') ? 1000 - i : g === 'r' ? 30 : g === 'f' ? 5000 : 60 - i))
    const marks = selectMarks(visible, guids, elements, 5)
    expect(marks.map((m) => m.guid)).toEqual(['b0', 'm1', 'r', 'b1', 'm2']) // the big footing waits behind structure
  })

  it('prefers elements where the person aimed: the middle of the frame beats a bigger one in a corner', () => {
    const centre = { ...vis(0, 100), box: [450, 450, 550, 550] as [number, number, number, number] }
    const corner = { ...vis(1, 150), box: [0, 0, 60, 60] as [number, number, number, number] }
    expect(markWeight(centre)).toBeGreaterThan(markWeight(corner))
    const elements = new Map([['a', el('a', 'IfcMember')], ['b', el('b', 'IfcMember')]])
    expect(selectMarks([centre, corner], ['a', 'b'], elements, 1).map((m) => m.guid)).toEqual(['a'])
  })

  it('caps at 25 marks', () => {
    const elements = new Map(Array.from({ length: 40 }, (_, i) => [`g${i}`, el(`g${i}`, 'IfcWall')] as const))
    const marks = selectMarks(Array.from({ length: 40 }, (_, i) => vis(i, 100 + i)), Array.from({ length: 40 }, (_, i) => `g${i}`), elements)
    expect(marks).toHaveLength(MAX_MARKS)
    expect(new Set(marks.map((m) => m.guid)).size).toBe(MAX_MARKS)
    expect(marks[0].guid).toBe('g39')
  })

  it('writes short key dimensions from quantities, else from the bounding box', () => {
    expect(keyDims(el('w', 'IfcWall', { 'Qto_WallBaseQuantities.Width_mm': 100, 'Qto_WallBaseQuantities.Height_mm': 2700 }))).toBe('100 mm thick, 2700 mm high')
    expect(keyDims(el('s', 'IfcPipeSegment', { 'Qto_PipeSegmentBaseQuantities.OuterDiameter_mm': 100, 'Qto_PipeSegmentBaseQuantities.Length_mm': 200 }))).toBe('Ø100 mm, 200 mm long')
    expect(keyDims(el('x', 'IfcFurniture', {}, [[0, 0, 0], [0.9, 0.45, 0.75]]))).toBe('900 × 450 × 750 mm')
  })

  it('gives columns and beams a cross-section from the bounding box, and columns a height', () => {
    expect(keyDims(el('c', 'IfcColumn', { 'Qto_ColumnBaseQuantities.Length_mm': 3300 }, [[-0.2, -0.2, 0], [0.2, 0.2, 3.3]])))
      .toBe('400 × 400 mm section, 3300 mm high')
    expect(keyDims(el('b', 'IfcBeam', { 'Qto_BeamBaseQuantities.Length_mm': 2600 }, [[-0.15, 0.2, 2.7], [0.15, 2.8, 3.3]])))
      .toBe('300 × 600 mm section, 2600 mm long')
    expect(keyDims(el('b', 'IfcBeam', { 'Qto_BeamBaseQuantities.Length_mm': 2600 }, [[0.2, -0.15, 2.7], [2.8, 0.15, 3.3]])))
      .toBe('300 × 600 mm section, 2600 mm long') // along X
    expect(keyDims(el('c', 'IfcColumn', { 'Qto_ColumnBaseQuantities.Width_mm': 300, 'Qto_ColumnBaseQuantities.Length_mm': 2700 })))
      .toBe('300 mm wide, 2700 mm high') // quantities win over the box
  })

  it('places mark centres as fractions of the ID buffer, using the largest region per GUID', () => {
    const elements = new Map([['w', el('w', 'IfcWall')]])
    const visible = [vis(0, 10, 0, 0), vis(1, 99, 320, 180)]
    const marks = selectMarks(visible, ['w', 'w'], elements)
    expect(markCentres(marks, visible, ['w', 'w'], 640, 360).get(1)).toEqual([0.5, 0.5])
  })

  it('draws each mark at its anchor (on the element), not at the centroid', () => {
    const elements = new Map([['b', el('b', 'IfcBeam')]])
    const visible = [vis(0, 500, 320, 180, { x: 64, y: 36 })]
    const marks = selectMarks(visible, ['b'], elements)
    expect(markCentres(marks, visible, ['b'], 640, 360).get(1)).toEqual([0.1, 0.1])
  })
})

describe('marks (mutation-tested)', () => {
  it('ranks structure and guardrails first; openings, services, slabs and footings second; the rest last', () => {
    for (const cls of ['IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPile', 'IfcPlate', 'IfcWall', 'IfcWallStandardCase', 'IfcRailing']) {
      expect(classPriority(cls), cls).toBe(0)
    }
    for (const cls of ['IfcDoor', 'IfcWindow', 'IfcPipeSegment', 'IfcPipeFitting', 'IfcDuctSegment', 'IfcDuctFitting', 'IfcFlowSegment',
      'IfcFlowFitting', 'IfcCableCarrierSegment', 'IfcOpeningElement', 'IfcSlab', 'IfcFooting']) {
      expect(classPriority(cls), cls).toBe(1)
    }
    expect(classPriority('')).toBe(2)
    expect(classPriority('IfcReinforcingBar')).toBe(2)
    expect(classPriority('IfcColumnType')).toBe(2) // exact class names only
  })

  it('ignores zero, negative and non-numeric quantities', () => {
    const box: Element['bbox_m'] = [[0, 0, 0], [0.3, 0.3, 3]]
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Width_mm': 0, 'Q.Length_mm': 3000 }, box))).toBe('300 × 300 mm section, 3000 mm high')
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Width_mm': -200, 'Q.Length_mm': 3000 }, box))).toBe('300 × 300 mm section, 3000 mm high')
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Width_mm': '200', 'Q.Length_mm': Infinity }, box))).toBe('300 × 300 mm section')
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Width_mm': 199.6 }, box))).toBe('200 mm wide') // whole millimetres
  })

  it('skips a degenerate box section and a box with no size at all', () => {
    // a column modelled as a line (zero plan size) gets no section, only its height
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Length_mm': 3000 }, [[1, 1, 0], [1, 1, 3]]))).toBe('3000 mm high')
    expect(keyDims(el('c', 'IfcColumn', { 'Q.Length_mm': 3000 }, [[1, 1, 0], [1, 1.3, 3]]))).toBe('3000 mm high') // a wall-thin box
    expect(keyDims(el('b', 'IfcBeam', { 'Q.Length_mm': 2000 }, [[0, 0, 3], [2, 0.2, 3]]))).toBe('2000 mm long') // no depth
    expect(keyDims(el('x', 'IfcFurniture', {}, [[2, 2, 2], [2, 2, 2]]))).toBe('')
    // the box fallback measures each side, wherever the box sits
    expect(keyDims(el('x', 'IfcFurniture', {}, [[10, 20, 3], [10.9, 20.45, 3.75]]))).toBe('900 × 450 × 750 mm')
    expect(keyDims(el('x', 'IfcFurniture', {}, [[0, 0, 0], [0, 0, 0.75]]))).toBe('0 × 0 × 750 mm')
  })

  it('words wall widths as thickness, other widths and depths plainly, and keeps it short', () => {
    expect(keyDims(el('w', 'IfcWallStandardCase', { 'Q.Width_mm': 200 }))).toBe('200 mm thick')
    expect(keyDims(el('s', 'IfcSlab', { 'Q.Width_mm': 3000, 'Q.Depth_mm': 250 }))).toBe('3000 mm wide, 250 mm deep')
    expect(keyDims(el('s', 'IfcSlab', { 'Q.Depth_mm': 250 }))).toBe('250 mm deep')
    const long = keyDims(el('p', 'IfcPipeSegment', {
      'Q.OuterDiameter_mm': 123456789, 'Q.Width_mm': 123456789, 'Q.Depth_mm': 123456789, 'Q.Height_mm': 123456789, 'Q.Length_mm': 123456789,
    }))
    expect(long).toHaveLength(80)
    expect(long.startsWith('Ø123456789 mm, 123456789 mm wide, ')).toBe(true)
  })

  it('keeps the largest region of an element, whichever comes first', () => {
    const elements = new Map([['w', el('w', 'IfcWall')]])
    for (const visible of [[vis(0, 50, 1, 1), vis(1, 500, 2, 2)], [vis(1, 500, 2, 2), vis(0, 50, 1, 1)]]) {
      const marks = selectMarks(visible, ['w', 'w'], elements)
      expect(marks).toHaveLength(1)
      expect(markCentres(marks, visible, ['w', 'w'], 100, 100).get(1)).toEqual([0.02, 0.02])
    }
    // equal regions: the first one seen wins in both places
    const tie = [vis(0, 300, 10, 10), vis(1, 300, 90, 90)]
    expect(markCentres(selectMarks(tie, ['w', 'w'], elements), tie, ['w', 'w'], 100, 100).get(1)).toEqual([0.1, 0.1])
  })

  it('gives no centre to a mark whose element is no longer visible, and skips unknown pixels', () => {
    const elements = new Map([['a', el('a', 'IfcWall')], ['b', el('b', 'IfcWall')]])
    const marks = selectMarks([vis(0, 100), vis(1, 50)], ['a', 'b'], elements)
    const centres = markCentres(marks, [vis(0, 100, 30, 40), vis(2, 999, 1, 1)], ['a', 'b', ''], 100, 100)
    expect([...centres.entries()]).toEqual([[1, [0.3, 0.4]]])
  })
})
