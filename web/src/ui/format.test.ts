import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { formatValue, loadBearingText, propertyRows } from './format'

const WALL: Element = {
  guid: '2O2Fr$t4X7Zf8NOew3FLOH', ifc_class: 'IfcWall', name: 'Partition P-01', storey: 'Level 1',
  bbox_m: [[0, 0, 0], [3.2, 0.1, 2.7]], load_bearing: false,
  props: { 'TrueSite_Notes.Install': 'Sleeve S-104 before boarding', 'Pset_WallCommon.FireRating': '60 min',
    'Qto_WallBaseQuantities.Width_mm': 100, 'Pset_WallCommon.IsExternal': true, Material: 'Gypsum board' },
}

describe('element panel formatting', () => {
  it('formats property values for people', () => {
    expect(formatValue(true)).toBe('Yes')
    expect(formatValue(false)).toBe('No')
    expect(formatValue(100)).toBe('100')
    expect(formatValue(0.25)).toBe('0.25')
    expect(formatValue('60 min')).toBe('60 min')
    expect(formatValue(null)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
  })

  it('says when no property set states load bearing', () => {
    expect(loadBearingText(true)).toBe('Yes')
    expect(loadBearingText(false)).toBe('No')
    expect(loadBearingText(null)).toBe('Not stated')
  })

  it('lists Material first, then properties alphabetically', () => {
    expect(propertyRows(WALL)).toEqual([
      ['Material', 'Gypsum board'],
      ['Pset_WallCommon.FireRating', '60 min'],
      ['Pset_WallCommon.IsExternal', 'Yes'],
      ['Qto_WallBaseQuantities.Width_mm', '100'],
      ['TrueSite_Notes.Install', 'Sleeve S-104 before boarding'],
    ])
  })
})

describe('element panel formatting (mutation-tested)', () => {
  it('shows text as it is, without JSON quotes', () => {
    expect(formatValue('S275')).toBe('S275')
    expect(formatValue('')).toBe('')
    expect(formatValue(0)).toBe('0')
  })

  it('puts Material first even when other names sort before it', () => {
    const rows = propertyRows({ ...WALL, props: { Zone: 'B', Area: 12, Material: 'Concrete', LoadBearing: true } })
    expect(rows.map(([k]) => k)).toEqual(['Material', 'Area', 'LoadBearing', 'Zone'])
  })
})
