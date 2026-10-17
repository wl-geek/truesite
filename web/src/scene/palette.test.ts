import { describe, expect, it } from 'vitest'
import { KIND_COLOURS, isSolid, kindOf, materialParams, paintOf, smoothShaded } from './palette'

describe('colour by element type (issue #36)', () => {
  it('maps classes and IFC predefined types to kinds, like the reference video', () => {
    expect(kindOf('IfcColumn')).toBe('column')
    expect(kindOf('IfcBeam', 'BEAM')).toBe('beam')
    expect(kindOf('IfcMember', 'CHORD')).toBe('truss')
    expect(kindOf('IfcMember', 'MEMBER')).toBe('truss')
    expect(kindOf('IfcMember')).toBe('truss')
    expect(kindOf('IfcMember', 'PURLIN')).toBe('purlin')
    expect(kindOf('IfcMember', 'BRACE')).toBe('brace')
    expect(kindOf('IfcFooting', 'PAD_FOOTING')).toBe('concrete')
    expect(kindOf('IfcSlab')).toBe('concrete')
    expect(kindOf('IfcWall')).toBe('concrete')
    expect(kindOf('IfcReinforcingBar', 'MAIN')).toBe('rebar')
    expect(kindOf('IfcDoor')).toBe('opening')
    expect(kindOf('IfcPipeSegment')).toBe('opening')
    expect(kindOf('IfcFurniture')).toBe('other')
    expect(kindOf('')).toBe('other')
  })

  it('gives each steel kind its own colour and keeps rebar and concrete apart', () => {
    const steel = (['column', 'beam', 'truss', 'purlin', 'brace'] as const).map((k) => KIND_COLOURS[k])
    expect(new Set([...steel, KIND_COLOURS.concrete, KIND_COLOURS.rebar]).size).toBe(7)
  })

  it('draws steel and rebar solid, and concrete (whatever its class) see-through', () => {
    expect(isSolid('column', 'Steel S355')).toBe(true)
    expect(isSolid('column', 'Concrete C40/50')).toBe(false) // a concrete column's cage stays visible inside
    expect(isSolid('beam')).toBe(true)
    expect(isSolid('rebar', 'Rebar B500B')).toBe(true)
    expect(isSolid('concrete', 'Concrete C30/37')).toBe(false)
    expect(isSolid('opening')).toBe(false)
  })

  it('gives the viewer and Quick Look opaque steel and see-through concrete', () => {
    expect(materialParams({ kind: 'truss', solid: true })).toMatchObject({ color: KIND_COLOURS.truss, transparent: false, opacity: 1 })
    expect(materialParams({ kind: 'concrete', solid: false })).toMatchObject({ color: KIND_COLOURS.concrete, transparent: true, opacity: 0.45, depthWrite: false })
    expect(smoothShaded('rebar') && smoothShaded('brace')).toBe(true)
    expect(smoothShaded('column')).toBe(false)
  })

  it('reads the kind and solidity from an elements.json row', () => {
    expect(paintOf({ ifc_class: 'IfcMember', props: { PredefinedType: 'PURLIN', Material: 'Steel S355' } })).toEqual({ kind: 'purlin', solid: true })
    expect(paintOf({ ifc_class: 'IfcColumn', props: { Material: 'Concrete C40/50' } })).toEqual({ kind: 'column', solid: false })
    expect(paintOf({ ifc_class: 'IfcBeam' })).toEqual({ kind: 'beam', solid: true })
  })
})
