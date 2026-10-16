/**
 * The simulated as-built state of the building site demo: what was "built" differently from the BIM design.
 * The virtual site (ui/VirtualSite.tsx) and the sample photos (scripts/make-samples.mjs) both render this,
 * and both show the list in plain words, so a reader can compare Gemini's findings with the truth.
 */
export type ViewpointId = 'P1' | 'P2' | 'P3' | 'P4'

/** One deviation of the as-built from the design; `featuredAt` is the QR spot whose opening view shows it. */
export type Deviation =
  | { element: string; kind: 'missing'; note?: string; featuredAt: ViewpointId }
  | { element: string; kind: 'shifted'; offsetM: [number, number, number]; featuredAt: ViewpointId }

/**
 * Realistic site defects: setting-out errors, a column not cast yet, steel not erected or left out, a missing
 * guardrail. Each QR spot opens with two or three of them in view (asBuilt.test.ts checks the framing).
 */
export const SITE_AS_BUILT: readonly Deviation[] = [
  { element: 'RC column C2', kind: 'missing', note: 'not cast yet: only its rebar cage stands', featuredAt: 'P1' },
  { element: 'RC column B2', kind: 'shifted', offsetM: [-0.4, 0, 0], featuredAt: 'P1' },
  { element: 'Brace wall north C-D (2)', kind: 'missing', featuredAt: 'P1' },
  { element: 'RC column C1', kind: 'shifted', offsetM: [0, 0.4, 0], featuredAt: 'P2' },
  { element: 'Edge protection east', kind: 'missing', note: 'missing (a fall hazard at level 1)', featuredAt: 'P2' },
  { element: 'Truss T3 vertical 7', kind: 'missing', featuredAt: 'P3' },
  { element: 'Purlin P6 B-C', kind: 'missing', featuredAt: 'P3' },
  { element: 'Edge beam B3-C3', kind: 'missing', note: 'not erected yet', featuredAt: 'P3' },
  { element: 'Truss T3 diagonal 4', kind: 'missing', featuredAt: 'P4' },
  { element: 'Brace roof south A-B (1)', kind: 'missing', featuredAt: 'P4' },
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
