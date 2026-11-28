import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CODE_HEIGHT_M, codeAt, compass, otherViewpoints, SITE_VIEWPOINTS } from './siteViewpoints'

type Anchor = { anchor_id: string; position_m: number[]; normal: number[]; up: number[] }
const anchors: Anchor[] = JSON.parse(readFileSync(new URL('../../../bim/models/site/anchors.json', import.meta.url), 'utf8'))

describe('SITE_VIEWPOINTS', () => {
  it('match the site anchors: code ahead of the standing spot, facing it, at chest height', () => {
    expect(SITE_VIEWPOINTS.map((v) => v.id)).toEqual(anchors.filter((a) => a.anchor_id.startsWith('P')).map((a) => a.anchor_id))
    for (const v of SITE_VIEWPOINTS) {
      const a = anchors.find((x) => x.anchor_id === v.id)!
      expect(a.position_m).toEqual([...codeAt(v), CODE_HEIGHT_M])
      expect(a.normal.map((n) => n + 0)).toEqual([0 - v.look[0], 0 - v.look[1], 0])
      expect(a.up).toEqual([0, 0, 1])
    }
  })

  it('name the looking direction', () => {
    expect(SITE_VIEWPOINTS.map((v) => compass(v.look))).toEqual(['north', 'east', 'west', 'west'])
  })
})

describe('compass (mutation-tested)', () => {
  it('names all four grid directions and nothing else', () => {
    expect([compass([0, 1]), compass([0, -1]), compass([1, 0]), compass([-1, 0])]).toEqual(['north', 'south', 'east', 'west'])
    expect(compass([1, 1])).toBe('')
  })
})

describe('otherViewpoints', () => {
  it('lists the three other spots, the one sharing most elements first', () => {
    expect(otherViewpoints('P1').map((v) => v.id)).toEqual(['P2', 'P3', 'P4'])
    expect(otherViewpoints('P4').map((v) => v.id)).toEqual(['P2', 'P3', 'P1'])
    for (const v of SITE_VIEWPOINTS) {
      const others = otherViewpoints(v.id).map((o) => o.id)
      expect(new Set([...others, v.id]).size).toBe(4)
    }
  })
})
