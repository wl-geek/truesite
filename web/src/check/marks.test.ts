import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import type { VisibleElement } from '../scene/elements'
import { classPriority, keyDims, markCentres, MAX_MARKS, selectMarks } from './marks'

function el(guid: string, ifc_class: string, props: Record<string, unknown> = {}, bbox: Element['bbox_m'] = [[0, 0, 0], [1, 0.1, 2]]): Element {
  return { guid, ifc_class, name: `${ifc_class} ${guid}`, storey: 'L1', bbox_m: bbox, load_bearing: null, props }
}
function vis(index: number, pixels: number, cx = 10, cy = 20): VisibleElement {
  return { index, pixels, coverage: pixels / 1000, box: [0, 0, 100, 100], centroid: { x: cx, y: cy } }
}

describe('marks', () => {
  it('ranks structure, then openings and services, then the rest', () => {
    expect(classPriority('IfcColumn')).toBe(0)
    expect(classPriority('IfcWall')).toBe(0)
    expect(classPriority('IfcPipeSegment')).toBe(1)
    expect(classPriority('IfcFurniture')).toBe(2)
  })

  it('selects known elements once each, by priority then size, numbered from 1', () => {
    const elements = new Map([['w', el('w', 'IfcWall')], ['d', el('d', 'IfcDoor')], ['f', el('f', 'IfcFurniture')], ['s', el('s', 'IfcPipeSegment')]])
    const indexToGuid = ['f', 'd', 'w', 's', 'unknown', 'w']
    const marks = selectMarks([vis(0, 900), vis(1, 50), vis(2, 10), vis(3, 300), vis(4, 999), vis(5, 400)], indexToGuid, elements)
    expect(marks.map((m) => [m.mark, m.guid])).toEqual([[1, 'w'], [2, 's'], [3, 'd'], [4, 'f']])
    expect(marks[0].name).toBe('IfcWall w')
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

  it('places mark centres as fractions of the ID buffer, using the largest region per GUID', () => {
    const elements = new Map([['w', el('w', 'IfcWall')]])
    const visible = [vis(0, 10, 0, 0), vis(1, 99, 320, 180)]
    const marks = selectMarks(visible, ['w', 'w'], elements)
    expect(markCentres(marks, visible, ['w', 'w'], 640, 360).get(1)).toEqual([0.5, 0.5])
  })
})
