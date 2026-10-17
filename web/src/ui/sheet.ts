import type { Anchor } from '../api/types'

/** The printable sheet behind an anchor's code, and how to print and place it, from the anchor's own data. */
export type SheetInfo = {
  href: string
  /** "US Letter", or null when the anchor's label doesn't say. */
  paper: string | null
  /** Lies flat (desk or floor) rather than standing upright. */
  flat: boolean
  /** How to print it so the code has its true size. */
  print: string
  /** Where it goes. */
  place: string
}

export function sheetInfo(anchor: Pick<Anchor, 'project_id' | 'anchor_id' | 'label' | 'normal' | 'position_m' | 'scale'>): SheetInfo {
  const named = /\b(Letter|A[0-5])\b/.exec(anchor.label)?.[0] ?? null
  const paper = named === 'Letter' ? 'US Letter' : named
  const flat = anchor.normal[2] > 0.9
  const place = !flat ? `Fix it upright, with the centre of the code ${anchor.position_m[2].toFixed(1)} m above the ground.`
    : anchor.scale < 1 ? 'Lay it flat on a table.' : 'Lay it flat on the floor, with room to walk around it.'
  return {
    href: `/sheets/${anchor.project_id}-${anchor.anchor_id}.pdf`,
    paper,
    flat,
    print: `Print it${paper ? ` on ${paper}` : ''} at 100%, not "Fit to page". Its check bar must measure 10.0 cm.`,
    place,
  }
}
