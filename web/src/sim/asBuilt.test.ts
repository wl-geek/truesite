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
    expect(describeDeviation({ element: 'Steel column B1', kind: 'shifted', offsetM: [0.45, 0, 0], featuredAt: 'P1' })).toBe('Steel column B1: about 45 cm east of the design')
    expect(describeDeviation({ element: 'X', kind: 'shifted', offsetM: [0, -0.38, 0], featuredAt: 'P1' })).toBe('X: about 40 cm south of the design')
    expect(describeDeviation({ element: 'Beam B1-C1', kind: 'missing', featuredAt: 'P1' })).toBe('Beam B1-C1: missing')
    expect(direction([0, 0, 0.3])).toBe('higher')
  })
})

describe('the defects featured at each QR spot', () => {
  type Bbox = [[number, number, number], [number, number, number]]
  const els: { name: string; bbox_m: Bbox }[] = JSON.parse(readFileSync(new URL('../../../bim/models/site/elements.json', import.meta.url), 'utf8'))
  const byName = new Map(els.map((e) => [e.name, e]))

  it('are two or three per spot, and each sits inside that spot\'s opening view (iPad landscape, 4:3)', async () => {
    const { SITE_VIEWPOINTS } = await import('../ui/siteViewpoints')
    const halfV = 25 // HALF_FOV_SHORT_DEG in VirtualSite: half the field of view across the short side
    const halfH = (Math.atan(Math.tan((halfV * Math.PI) / 180) * (4 / 3)) * 180) / Math.PI
    for (const v of SITE_VIEWPOINTS) {
      const featured = SITE_AS_BUILT.filter((d) => d.featuredAt === v.id)
      expect(featured.length, v.id).toBeGreaterThanOrEqual(2)
      expect(featured.length, v.id).toBeLessThanOrEqual(3)
      const eye = [v.stand[0], v.stand[1], 1.5]
      const yaw = Math.atan2(v.look[1], v.look[0])
      for (const d of featured) {
        const [[x0, y0, z0], [x1, y1, z1]] = byName.get(d.element)!.bbox_m
        const p = [(x0 + x1) / 2 - eye[0], (y0 + y1) / 2 - eye[1], (z0 + z1) / 2 - eye[2]]
        const bearing = (((Math.atan2(p[1], p[0]) - yaw) * 180) / Math.PI + 540) % 360 - 180
        const elev = (Math.atan2(p[2], Math.hypot(p[0], p[1])) * 180) / Math.PI - v.startPitchDeg
        expect(Math.abs(bearing), `${v.id} ${d.element} bearing`).toBeLessThan(halfH - 2)
        expect(Math.abs(elev), `${v.id} ${d.element} elevation`).toBeLessThan(halfV - 2)
      }
    }
  })
})
