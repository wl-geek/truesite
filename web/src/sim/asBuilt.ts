/**
 * The simulated as-built state of the building site demo: what was "built" differently from the BIM design.
 * The virtual site (ui/VirtualSite.tsx) and the sample photos (scripts/make-samples.mjs) both render this,
 * and both show the list in plain words, so a reader can compare Gemini's findings with the truth.
 */
export type Deviation =
  | { element: string; kind: 'missing'; note?: string }
  | { element: string; kind: 'shifted'; offsetM: [number, number, number] }

export const SITE_AS_BUILT: readonly Deviation[] = [
  { element: 'Steel column B1', kind: 'shifted', offsetM: [0.45, 0, 0] },
  { element: 'Steel column D3', kind: 'shifted', offsetM: [0, -0.4, 0] },
  { element: 'Brace wall south A-B (2)', kind: 'missing' },
  { element: 'Brace roof north C-D (1)', kind: 'missing' },
  { element: 'Edge protection south', kind: 'missing', note: 'missing (a fall hazard at level 1)' },
  { element: 'Edge protection north', kind: 'missing', note: 'missing (a fall hazard at level 1)' },
  { element: 'RC column C2', kind: 'missing', note: 'not cast yet: only its rebar cage stands' },
  { element: 'Beam B1-C1', kind: 'missing' },
  { element: 'Purlin P4 C-D', kind: 'missing' },
  { element: 'Truss T4 diagonal 3', kind: 'missing' },
]

/** Compass word for a plan offset (IFC x east, y north, z up). */
export function direction([dx, dy, dz]: [number, number, number]): string {
  if (Math.abs(dz) > Math.hypot(dx, dy)) return dz > 0 ? 'higher' : 'lower'
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'north' : 'south')
}

/** "Steel column B1: about 45 cm east of the design" (rough, never millimetres: spec copy rules). */
export function describeDeviation(d: Deviation): string {
  if (d.kind === 'missing') return `${d.element}: ${d.note ?? 'missing'}`
  const cm = Math.round((Math.hypot(...d.offsetM) * 100) / 5) * 5
  return `${d.element}: about ${cm} cm ${direction(d.offsetM)} of the design`
}
