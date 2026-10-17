import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { modelFacts, VIEWER_PROJECTS } from './viewerFacts'

const elements = (p: string) => JSON.parse(readFileSync(new URL(`../../../bim/models/${p}/elements.json`, import.meta.url), 'utf8')) as Element[]

describe('modelFacts', () => {
  it('sums a model up from its elements', () => {
    const site = modelFacts({ elements: elements('site') })
    expect(site.size).toBe('19.8 × 13.8 m overall, 10.65 m high') // the pad footings reach past the 18 x 12 m grid
    expect(site.materials).toEqual(['Concrete C30/37', 'Steel S355', 'Scaffold tube', 'Rebar B500B'])
    expect(site.storeys).toBe(1)
    expect(modelFacts({ elements: elements('rooftop') }).storeys).toBe(2)
    expect(modelFacts({ elements: [] }).size).toBe('Empty model')
  })

  it('offers the three shipped models', () => {
    expect(VIEWER_PROJECTS.map((p) => p.id)).toEqual(['site', 'rooftop', 'room1'])
  })
})
