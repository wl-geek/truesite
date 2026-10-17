import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { modelFacts, VIEWER_PROJECTS, viewerTitle } from './viewerFacts'

const elements = (p: string) => JSON.parse(readFileSync(new URL(`../../../bim/models/${p}/elements.json`, import.meta.url), 'utf8')) as Element[]
const el = (storey: string, z0: number, z1: number): Element => ({
  guid: storey, ifc_class: 'IfcColumn', name: storey, storey, bbox_m: [[0, 0, z0], [1, 1, z1]], load_bearing: true, props: {},
})

describe('modelFacts', () => {
  it('sums a model up from its elements', () => {
    const site = modelFacts({ elements: elements('site') })
    expect(site.size).toBe('19.8 × 13.8 m overall, 10.65 m high') // the pad footings reach past the 18 x 12 m grid
    expect(site.materials).toEqual(['Concrete C30/37', 'Steel S355', 'Scaffold tube', 'Rebar B500B'])
    expect(site.storeys).toBe(1)
    expect(modelFacts({ elements: [el('Ground floor', 0, 3), el('First floor', 3, 6)] }).storeys).toBe(2)
    expect(modelFacts({ elements: [] }).size).toBe('Empty model')
  })

  it('shows one model, the building under construction', () => {
    expect(VIEWER_PROJECTS.map((p) => p.id)).toEqual(['site'])
  })
})

describe('viewerTitle', () => {
  it('names the site plainly, and any other project by its own name without the scale', () => {
    expect(viewerTitle({ project_id: 'site', name: 'Building under construction (1:1)' })).toBe('Building under construction')
    expect(viewerTitle({ project_id: 'other', name: 'Test frame (1:1)' })).toBe('Test frame')
    expect(viewerTitle({ project_id: 'other', name: 'Test frame' })).toBe('Test frame')
  })
})
