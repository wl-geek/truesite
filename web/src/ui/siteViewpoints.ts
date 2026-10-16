/**
 * The building site viewpoints, as laid out by bim/truesite_bim/site.py (VIEWPOINTS, STAND_OFF, CODE_Z).
 * siteViewpoints.test.ts checks them against bim/models/site/anchors.json, so the start page can't drift.
 */
export type Viewpoint = {
  id: 'P1' | 'P2' | 'P3' | 'P4'
  name: string
  /** Where the filmer stands (plan metres from point O, grid corner A1). */
  stand: [number, number]
  /** Looking direction from the standing spot towards the code (unit, along a grid axis). */
  look: [number, number]
  /** What this view shows, in a few words. */
  shows: string
}

export const STAND_OFF_M = 1.5
export const CODE_HEIGHT_M = 1.4

export const SITE_VIEWPOINTS: readonly Viewpoint[] = [
  { id: 'P1', name: 'South approach', stand: [9, -4], look: [0, 1], shows: 'The whole long side, both storeys' },
  { id: 'P2', name: 'Under the slab', stand: [3, 3], look: [1, 0], shows: 'Concrete columns, cages and beams overhead' },
  { id: 'P3', name: 'Under the open bay', stand: [15, 9], look: [-1, 0], shows: 'The rebar mat and the trusses above it' },
  { id: 'P4', name: 'East gable', stand: [22, 6], look: [-1, 0], shows: 'The truss profile and end-bay bracing' },
]

const COMPASS: Record<string, string> = { '0,1': 'north', '0,-1': 'south', '1,0': 'east', '-1,0': 'west' }

export function compass([dx, dy]: [number, number]): string {
  return COMPASS[`${dx},${dy}`] ?? ''
}

/** Code centre in plan metres: STAND_OFF_M ahead of the standing spot. */
export function codeAt(v: Viewpoint): [number, number] {
  return [v.stand[0] + STAND_OFF_M * v.look[0], v.stand[1] + STAND_OFF_M * v.look[1]]
}
