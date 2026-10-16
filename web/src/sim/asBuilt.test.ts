import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describeDeviation, direction, SITE_AS_BUILT } from './asBuilt'

const elements: { name: string }[] = JSON.parse(readFileSync(new URL('../../../bim/models/site/elements.json', import.meta.url), 'utf8'))

describe('SITE_AS_BUILT', () => {
  it('names real elements of the site model, each once', () => {
    const names = new Set(elements.map((e) => e.name))
    for (const d of SITE_AS_BUILT) expect(names.has(d.element), d.element).toBe(true)
    expect(new Set(SITE_AS_BUILT.map((d) => d.element)).size).toBe(SITE_AS_BUILT.length)
  })

  it('describes deviations roughly, in centimetres and compass words', () => {
    expect(describeDeviation({ element: 'Steel column B1', kind: 'shifted', offsetM: [0.45, 0, 0] })).toBe('Steel column B1: about 45 cm east of the design')
    expect(describeDeviation({ element: 'X', kind: 'shifted', offsetM: [0, -0.38, 0] })).toBe('X: about 40 cm south of the design')
    expect(describeDeviation({ element: 'Beam B1-C1', kind: 'missing' })).toBe('Beam B1-C1: missing')
    expect(direction([0, 0, 0.3])).toBe('higher')
  })
})
