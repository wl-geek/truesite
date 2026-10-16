/**
 * The simulated as-built state of the building site demo: what was "built" differently from the BIM design.
 * The virtual site (ui/VirtualSite.tsx) and the sample photos (scripts/make-samples.mjs) both render this,
 * and both show the list in plain words, so a reader can compare Gemini's findings with the truth.
 */
export type ViewpointId = 'P1' | 'P2' | 'P3' | 'P4'

/**
 * One deviation of the as-built from the design; `featuredAt` is the QR spot whose opening view shows it. A shifted
 * concrete column takes its rebar cage with it (`alsoMoves`), as it would on site.
 */
export type Deviation =
  | { element: string; kind: 'missing'; note?: string; featuredAt: ViewpointId }
  | { element: string; kind: 'shifted'; offsetM: [number, number, number]; alsoMoves?: string[]; featuredAt: ViewpointId }

/**
 * Realistic site defects, each big enough for a camera to resolve from its QR spot (thin bracing far away is not):
 * an uncast column, setting-out errors, the open bay's beams not cast, steel not erected, a missing guardrail.
 * Each spot opens with two or three of them in view (asBuilt.test.ts checks the framing).
 * The stands sit on grid lines, so a purlin or truss member in line with the stand hides behind a slab-mat bar:
 * choose members off that line (measured in the check's ID buffer: every one here gets a numbered mark).
 */
export const SITE_AS_BUILT: readonly Deviation[] = [
  { element: 'RC column C2', kind: 'missing', note: 'not cast yet: only its rebar cage stands', featuredAt: 'P1' },
  { element: 'RC column B2', kind: 'shifted', offsetM: [-0.6, 0, 0], alsoMoves: ['Column cage B2'], featuredAt: 'P1' },
  { element: 'RC column C1', kind: 'shifted', offsetM: [0, 0.6, 0], alsoMoves: ['Column cage C1'], featuredAt: 'P2' },
  { element: 'Beam C2-D2', kind: 'missing', note: 'not cast yet: the open bay is still to pour', featuredAt: 'P2' },
  { element: 'Beam D1-D2', kind: 'missing', note: 'not cast yet: the open bay is still to pour', featuredAt: 'P2' },
  { element: 'Truss T3 diagonal 6', kind: 'missing', featuredAt: 'P3' },
  { element: 'Purlin P4 B-C', kind: 'missing', featuredAt: 'P3' },
  { element: 'Edge beam B3-C3', kind: 'missing', note: 'not erected yet', featuredAt: 'P3' },
  { element: 'Edge protection east', kind: 'missing', note: 'missing (a fall hazard at level 1)', featuredAt: 'P4' },
  { element: 'Purlin P6 C-D', kind: 'missing', featuredAt: 'P4' },
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
