import { describe, expect, it } from 'vitest'
import { USDZ_RADII, footprintDistance, pickUsdzRadius, usdzCentre, usdzFile, usdzPlan, withinRadius } from './usdzVariants'

type Box = [[number, number, number], [number, number, number]]
const el = (x0: number, y0: number, x1: number, y1: number) => ({ bbox_m: [[x0, y0, 0], [x1, y1, 1]] as Box })
// The site frame in miniature: centre (9, 6), corner columns about 10.6 m away, a purlin across the middle.
const elements = [el(-0.15, -0.15, 0.15, 0.15), el(5.85, -0.15, 6.15, 0.15), el(0, 5.9, 18, 6.1)]
const floor = { position_m: [9, 6, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], scale: 1 }

describe('Quick Look distance variants', () => {
  it('measures the horizontal distance to an element footprint', () => {
    expect(footprintDistance(el(0, 0, 2, 2).bbox_m, [1, 1])).toBe(0)
    expect(footprintDistance(el(0, 0, 2, 2).bbox_m, [5, 6])).toBe(5)
    expect(footprintDistance(el(0, 5.9, 18, 6.1).bbox_m, [9, 6])).toBe(0)
  })

  it('keeps the elements whose footprint is within R of the spot', () => {
    expect(withinRadius(elements, [9, 6], 8)).toEqual(elements.slice(1))
    expect(withinRadius(elements, [9, 6], 15)).toEqual(elements)
  })

  it('places the model at the first 1:1 floor anchor, else the footprint centre', () => {
    const desk = { ...floor, position_m: [1, 1, 0] as [number, number, number], scale: 0.05 }
    const wall = { ...floor, position_m: [2, 2, 1.3] as [number, number, number], normal: [0, 1, 0] as [number, number, number] }
    expect(usdzCentre([desk, wall, floor], elements)).toEqual([9, 6])
    expect(usdzCentre([desk], [el(0, 0, 4, 2)])).toEqual([2, 1])
  })

  it('writes a variant only for 1:1 floor projects and only when it drops something', () => {
    expect(USDZ_RADII).toEqual([8, 15])
    const plan = usdzPlan([floor], elements)
    expect(plan.centre).toEqual([9, 6])
    expect(plan.radii).toEqual([8])
    expect(plan.reach).toBeCloseTo(Math.hypot(8.85, 5.85))
    expect(usdzPlan([{ ...floor, scale: 0.05 }], elements).radii).toEqual([])
    expect(usdzPlan([floor], elements.slice(1)).radii).toEqual([]) // everything within 8 m: the full file is enough
  })

  it('names the files', () => {
    expect(usdzFile('site', null)).toBe('site.usdz')
    expect(usdzFile('site', 8)).toBe('site-r8.usdz')
  })

  it('opens the variant nearest the View distance setting', () => {
    const plan = { radii: [8, 15], reach: 20 }
    expect(pickUsdzRadius(null, plan)).toBeNull() // "all": the full model
    expect(pickUsdzRadius(6, plan)).toBe(8)
    expect(pickUsdzRadius(11, plan)).toBe(8)
    expect(pickUsdzRadius(12, plan)).toBe(15)
    expect(pickUsdzRadius(11.5, plan)).toBe(15) // a tie goes to the larger one: show more, not less
    expect(pickUsdzRadius(19, plan)).toBeNull() // nearer the full model's reach than 15 m
    expect(pickUsdzRadius(9, { radii: [8], reach: 10.6 })).toBe(8)
    expect(pickUsdzRadius(10, { radii: [8], reach: 10.6 })).toBeNull()
    expect(pickUsdzRadius(5, { radii: [], reach: 6 })).toBeNull() // no variants written: the full model
  })
})

describe('Quick Look distance variants (mutation-tested)', () => {
  it('writes variants when any anchor is a 1:1 floor code, not only when all are', () => {
    const wall = { position_m: [0, 3, 1.3] as [number, number, number], normal: [0, -1, 0] as [number, number, number], scale: 1 }
    expect(usdzPlan([wall, floor], elements).radii).toEqual([8])
  })

  it('writes no variant that would leave out everything', () => {
    const far = [el(40, 40, 41, 41), el(50, 50, 51, 51)]
    expect(usdzPlan([floor], far).radii).toEqual([])
  })
})
