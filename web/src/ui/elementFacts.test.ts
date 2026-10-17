import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { askSuggestions, metres, propLabel, sizeText, summarise, typeLabel } from './elementFacts'

const load = (project: string): Map<string, Element> => new Map(
  (JSON.parse(readFileSync(new URL(`../../../bim/models/${project}/elements.json`, import.meta.url), 'utf8')) as Element[]).map((e) => [e.name, e]))
const site = load('site')
/** Element types the site doesn't have (walls, a door, a window, a pipe sleeve) and an upper-storey beam, made up inline. */
const el = (name: string, ifc_class: string, storey: string, bbox_m: Element['bbox_m'], load_bearing: boolean | null, props: Record<string, unknown>): Element =>
  ({ guid: name, ifc_class, name, storey, bbox_m, load_bearing, props })
const wall = el('Wall W-01 South', 'IfcWall', 'Level 1', [[0, 0, 0], [4, 0.1, 2.7]], true, {
  'Pset_WallCommon.LoadBearing': true, 'Pset_WallCommon.FireRating': '60 min', 'Pset_WallCommon.IsExternal': true,
  'Qto_WallBaseQuantities.Length_mm': 4000, 'Qto_WallBaseQuantities.Width_mm': 100, 'Qto_WallBaseQuantities.Height_mm': 2700,
  Material: 'Concrete C30/37', PredefinedType: 'SOLIDWALL',
})
const partition = el('Partition P-01 West', 'IfcWall', 'Level 1', [[0, 0.1, 0], [0.1, 2.9, 2.7]], false, {
  'Pset_WallCommon.LoadBearing': false, 'Pset_WallCommon.FireRating': '30 min', 'Pset_WallCommon.IsExternal': false,
  'Qto_WallBaseQuantities.Length_mm': 2800, 'Qto_WallBaseQuantities.Width_mm': 100, 'Qto_WallBaseQuantities.Height_mm': 2700,
  Material: 'Gypsum board', PredefinedType: 'PARTITIONING',
})
const door = el('Door D-01', 'IfcDoor', 'Level 1', [[0.975, -0.015, 0], [1.925, 0.105, 2.125]], null, {
  'Pset_DoorCommon.FireRating': '30 min', 'Pset_DoorCommon.IsExternal': true,
  'TrueSite_Notes.Install': 'Hang door after floor finish; check swing clears column', Material: 'Timber (oak veneer)', PredefinedType: 'DOOR',
})
const window_ = el('Window WN-01', 'IfcWindow', 'Level 1', [[2, 2.925, 0.9], [3.2, 2.975, 2.1]], null, {
  'Pset_WindowCommon.IsExternal': true, Material: 'Aluminium frame + glass', PredefinedType: 'WINDOW',
})
const sleeve = el('Sleeve S-104', 'IfcPipeSegment', 'Level 1', [[3.85, 1.45, 0.5504], [4.05, 1.55, 0.6496]], null, {
  'Qto_PipeSegmentBaseQuantities.Length_mm': 200, 'Qto_PipeSegmentBaseQuantities.OuterDiameter_mm': 100,
  'TrueSite_Notes.Install': 'Sleeve S-104 before boarding', 'TrueSite_Notes.Service': 'Chilled water', Material: 'uPVC',
  PredefinedType: 'SLEEVE', ObjectType: 'SLEEVE',
})
const upper = el('Beam 2', 'IfcBeam', 'Level 2', [[-0.15, 0.2, 6], [0.15, 2.8, 6.6]], true, {
  'Pset_BeamCommon.LoadBearing': true, 'Qto_BeamBaseQuantities.Length_mm': 2600, Material: 'Concrete C40/50', PredefinedType: 'BEAM',
})
const others = [wall, partition, door, window_, sleeve, upper]
const facts = (el: Element, opts = {}) => Object.fromEntries(summarise(el, opts).facts.map((f) => [f.label, f.value]))

describe('element facts in plain words', () => {
  it('names each kind of element as a builder would', () => {
    expect(typeLabel(site.get('RC column A1')!)).toBe('Reinforced concrete column')
    expect(typeLabel(site.get('Purlin P1 A-B')!)).toBe('Roof purlin')
    expect(typeLabel(site.get('Truss T1 diagonal 1')!)).toBe('Truss diagonal')
    expect(typeLabel(site.get('Edge protection east')!)).toBe('Edge protection guardrail')
    expect(typeLabel(site.get('Column cage A1')!)).toBe('Rebar cage')
    expect(typeLabel(site.get('Pad footing A1')!)).toBe('Pad footing')
    expect(typeLabel(site.get('Slab L1 A-B')!)).toBe('Concrete floor slab')
    expect(typeLabel(wall)).toBe('Load-bearing wall')
    expect(typeLabel(partition)).toBe('Partition wall')
    expect(typeLabel(door)).toBe('Door')
    expect(typeLabel(window_)).toBe('Window')
    expect(typeLabel(sleeve)).toBe('Pipe sleeve')
    expect(typeLabel(upper)).toBe('Reinforced concrete beam')
  })

  it('gives sizes, material, role and concrete volume from the model', () => {
    const col = site.get('RC column A1')!
    expect(facts(col)).toEqual({
      Size: '450 × 450 mm section, 4.5 m high', Material: 'Concrete C30/37', 'Structural role': 'Load-bearing',
      'Concrete volume': 'about 0.91 m³', Exposure: 'Internal',
    })
    expect(sizeText(site.get('Beam A1-A2')!)).toBe('400 wide × 600 deep, 5.55 m long')
    expect(sizeText(site.get('Slab L1 A-B')!)).toBe('12 × 6 m, 200 mm thick')
    expect(sizeText(site.get('Purlin P1 A-B')!)).toBe('6 m long')
    expect(sizeText(wall)).toBe('4 m long, 100 mm thick, 2.7 m high')
    expect(sizeText(sleeve)).toBe('Ø100 mm, 200 mm long')
    expect(sizeText(window_)).toBe('1200 wide × 1200 high (mm)')
    expect(facts(door)['Fire rating']).toBe('30 min')
    expect(facts(partition)['Structural role']).toBe('Not load-bearing')
    expect(facts(sleeve).Service).toBe('Chilled water')
  })

  it('says where it is: grid, bay or truss, and its height, never the IFC storey of a one-storey model', () => {
    expect(summarise(site.get('RC column A1')!).location).toBe('Grid A1 · height 0 to 4.5 m')
    expect(summarise(site.get('Slab L1 A-B')!).location).toBe('Bay A–B · height 4.3 to 4.5 m')
    expect(summarise(site.get('Truss T1 bottom chord')!).location).toBe('Truss T1 · height 8.5 to 8.65 m')
    expect(summarise(upper, { multiStorey: true }).location).toBe('Level 2 · height 6 to 6.6 m')
    expect(summarise(upper).location).toBe('height 6 to 6.6 m')
  })

  it('keeps design notes as notes, the IFC data as technical rows, and leaves no raw keys in the facts', () => {
    const s = summarise(site.get('RC column A1')!)
    expect(s.notes[0]).toMatch(/8 T20 \+ T10 links @ 300, 50 mm cover/)
    expect(s.technical.map((t) => t.label)).toEqual(['IFC class', 'IFC type', 'IFC storey', 'GUID'])
    expect(s.more).toEqual([]) // everything it has is in the facts, location, notes or technical rows
    for (const e of [...site.values(), ...others]) {
      const all = summarise(e, { multiStorey: true })
      for (const f of [...all.facts, ...all.more]) expect(f.label, `${e.name}: ${f.label}`).not.toMatch(/Pset_|Qto_|TrueSite_|\./)
    }
  })

  it('labels properties and units for people', () => {
    expect(propLabel('Pset_WallCommon.FireRating')).toBe('Fire rating')
    expect(propLabel('Qto_SlabBaseQuantities.GrossArea_m2')).toBe('Gross area')
    expect(propLabel('TrueSite_Notes.Install')).toBe('Install notes')
    expect(propLabel('load_bearing')).toBe('Load-bearing')
    expect(metres(5.55)).toBe('5.55 m')
    expect(metres(12)).toBe('12 m')
    expect(metres(4.5)).toBe('4.5 m')
  })

  it('suggests questions this element can answer', () => {
    expect(askSuggestions(site.get('RC column A1')!)).toEqual(['How is it reinforced?', 'What concrete cover is needed?', 'What is it made of?', 'How big is it?'])
    expect(askSuggestions(door)).toContain("What's the fire rating?")
    expect(askSuggestions(site.get('Purlin P1 A-B')!)).not.toContain("What's the fire rating?")
  })
})
