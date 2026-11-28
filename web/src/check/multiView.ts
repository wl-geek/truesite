import type { MarkViews, OtherView, Status } from '../api/types'

/**
 * Words for what the other viewpoints said about one element. An element keeps its id whichever printed code it is
 * seen from, so two checks can be put side by side. Agreement makes a flag surer; a disagreement is a reason to look
 * closer, never a reason to drop the flag (in our logged sweeps a disputed flag was real two times out of three).
 */
export type ViewsTone = 'confirmed' | 'disputed' | 'elsewhere' | 'ok'

export interface ViewsNote {
  tone: ViewsTone
  title: string
  text: string
  /** The other checks worth opening, flagged ones first. */
  links: { anchorId: string; runId: string }[]
}

const SEEN_AS: Record<Status, string> = {
  present_ok: 'as built', missing: 'as missing', misplaced: 'as moved', different_from_design: 'as different from the design',
  cannot_judge: '',
}
const FLAGGED = new Set<Status>(['missing', 'misplaced', 'different_from_design'])

const list = (ids: readonly string[]): string =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`

const ids = (views: readonly OtherView[]): string => list(views.map((v) => v.anchor_id))

/** "P2 sees it as moved", "P2 and P4 see it as missing", or one clause per status when they differ. */
function seenAs(views: readonly OtherView[]): string {
  const groups = new Map<Status, OtherView[]>()
  for (const v of views) groups.set(v.status, [...(groups.get(v.status) ?? []), v])
  return [...groups].map(([status, vs]) => `${ids(vs)} ${vs.length === 1 ? 'sees' : 'see'} it ${SEEN_AS[status]}`).join('; ')
}

export function viewsNote(mv: MarkViews): ViewsNote {
  const flags = mv.views.filter((v) => FLAGGED.has(v.status))
  const oks = mv.views.filter((v) => v.status === 'present_ok')
  const links = [...flags, ...oks].map((v) => ({ anchorId: v.anchor_id, runId: v.run_id }))
  switch (mv.verdict) {
    case 'confirmed':
      return { tone: 'confirmed', title: `Confirmed from ${ids(flags)}`, text: `${seenAs(flags)} too. Two viewpoints agree.`, links }
    case 'disputed':
      return {
        tone: 'disputed', title: 'Viewpoints disagree',
        text: `${seenAs(oks)}${flags.length ? `; ${seenAs(flags)}` : ''}. Take a closer look on site before you decide.`, links,
      }
    case 'flagged_elsewhere':
      return {
        tone: 'elsewhere', title: `Flagged from ${ids(flags)}`,
        text: `${seenAs(flags)}. ${flags.some((v) => v.status === 'misplaced') ? "One photo can't show depth, so this view may not see the move. " : ''}Take a closer look on site.`, links,
      }
    case 'seen_ok_elsewhere':
      return { tone: 'ok', title: `Seen from ${ids(oks)}`, text: `${seenAs(oks)}.`, links }
  }
}

export interface ViewsCount { viewpoints: string[]; confirmed: number; disputed: number; elsewhere: number }

/** For the line above the findings: which other viewpoints were compared, and how the verdicts fell. */
export function countViews(views: Readonly<Record<string, MarkViews>> | undefined): ViewsCount | null {
  const all = Object.values(views ?? {})
  if (all.length === 0) return null
  const by = (v: MarkViews['verdict']) => all.filter((m) => m.verdict === v).length
  return {
    viewpoints: [...new Set(all.flatMap((m) => m.views.map((v) => v.anchor_id)))].sort(),
    confirmed: by('confirmed'), disputed: by('disputed'), elsewhere: by('flagged_elsewhere'),
  }
}

/** "Compared with P2 and P4: 2 confirmed, 1 where viewpoints disagree, 1 flagged from another viewpoint." */
export function viewsSummary(c: ViewsCount): string {
  const parts = [
    c.confirmed ? `${c.confirmed} confirmed` : '',
    c.disputed ? `${c.disputed} where viewpoints disagree` : '',
    c.elsewhere ? `${c.elsewhere} flagged from another viewpoint` : '',
  ].filter(Boolean)
  return `Compared with ${list(c.viewpoints)}${parts.length ? `: ${parts.join(', ')}` : ''}.`
}
