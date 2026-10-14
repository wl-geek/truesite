import { describe, expect, it } from 'vitest'
import { makeEvalMarkers, parseEvalPoints } from './evalMarkers'
import { EDGE_LAYER } from './overlay'

describe('eval markers', () => {
  it('keeps well-formed points only', () => {
    const pts = parseEvalPoints([{ id: 'P1', label: 'a', position_m: [0, 1, 2] }, { id: 'P2', label: 'b', position_m: [0, 1] }, 'x'])
    expect(pts.map((p) => p.id)).toEqual(['P1'])
    expect(parseEvalPoints({})).toEqual([])
  })
  it('draws one cross per point on the edge layer', () => {
    const g = makeEvalMarkers(parseEvalPoints([{ id: 'P1', label: 'a', position_m: [1, 2, 3] }]))
    expect(g.children).toHaveLength(1)
    expect(g.children[0].layers.isEnabled(EDGE_LAYER)).toBe(true)
    expect(g.children[0].layers.isEnabled(0)).toBe(false)
  })
})
