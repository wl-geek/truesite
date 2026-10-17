import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { askSuggestions, metres, propLabel, sizeText, summarise, typeLabel } from './elementFacts'

const load = (project: string): Map<string, Element> => new Map(
  (JSON.parse(readFileSync(new URL(`../../../bim/models/${project}/elements.json`, import.meta.url), 'utf8')) as Element[]).map((e) => [e.name, e]))
const site = load('site')
const room = load('room1')
const roof = load('rooftop')
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
    expect(typeLabel(room.get('Partition P-01 West')!)).toBe('Partition wall')
    expect(typeLabel(room.get('Sleeve S-104')!)).toBe('Pipe sleeve')
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
    expect(sizeText(room.get('Wall W-01 South')!)).toBe('4 m long, 100 mm thick, 2.7 m high')
    expect(sizeText(room.get('Sleeve S-104')!)).toBe('Ø100 mm, 200 mm long')
    expect(facts(room.get('Door D-01')!)['Fire rating']).toBe('30 min')
  })

  it('says where it is: grid, bay or truss, and its height, never the IFC storey of a one-storey model', () => {
    expect(summarise(site.get('RC column A1')!).location).toBe('Grid A1 · height 0 to 4.5 m')
    expect(summarise(site.get('Slab L1 A-B')!).location).toBe('Bay A–B · height 4.3 to 4.5 m')
    expect(summarise(site.get('Truss T1 bottom chord')!).location).toBe('Truss T1 · height 8.5 to 8.65 m')
    const upper = [...roof.values()].find((e) => e.storey === 'Level 2')!
    expect(summarise(upper, { multiStorey: true }).location).toMatch(/Level 2|Grid/)
  })

  it('keeps design notes as notes, the IFC data as technical rows, and leaves no raw keys in the facts', () => {
    const s = summarise(site.get('RC column A1')!)
    expect(s.notes[0]).toMatch(/8 T20 \+ T10 links @ 300, 50 mm cover/)
    expect(s.technical.map((t) => t.label)).toEqual(['IFC class', 'IFC type', 'IFC storey', 'GUID'])
    expect(s.more).toEqual([]) // everything it has is in the facts, location, notes or technical rows
    for (const el of [...site.values(), ...room.values(), ...roof.values()]) {
      const all = summarise(el, { multiStorey: true })
      for (const f of [...all.facts, ...all.more]) expect(f.label, `${el.name}: ${f.label}`).not.toMatch(/Pset_|Qto_|TrueSite_|\./)
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
    expect(askSuggestions(room.get('Door D-01')!)).toContain("What's the fire rating?")
    expect(askSuggestions(site.get('Purlin P1 A-B')!)).not.toContain("What's the fire rating?")
  })
})
