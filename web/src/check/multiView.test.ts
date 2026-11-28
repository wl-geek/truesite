import { describe, expect, it } from 'vitest'
import type { MarkViews, OtherView, Status } from '../api/types'
import { countViews, viewsNote, viewsSummary } from './multiView'

const view = (anchor_id: string, status: Status): OtherView =>
  ({ anchor_id, run_id: `run-${anchor_id}`, mark: 1, status, confidence: 0.9, created_at: '2026-11-28T09:00:00Z' })

describe('viewsNote', () => {
  it('says a flag is confirmed when another viewpoint flags it too', () => {
    const n = viewsNote({ verdict: 'confirmed', views: [view('P2', 'missing'), view('P3', 'cannot_judge')] })
    expect(n).toMatchObject({ tone: 'confirmed', title: 'Confirmed from P2', text: 'P2 sees it as missing too. Two viewpoints agree.' })
    expect(n.links).toEqual([{ anchorId: 'P2', runId: 'run-P2' }])
  })

  it('asks for a closer look when viewpoints disagree, and never drops the flag', () => {
    const n = viewsNote({ verdict: 'disputed', views: [view('P2', 'present_ok'), view('P4', 'missing')] })
    expect(n.title).toBe('Viewpoints disagree')
    expect(n.text).toBe('P2 sees it as built; P4 sees it as missing. Take a closer look on site before you decide.')
    expect(n.links.map((l) => l.anchorId)).toEqual(['P4', 'P2'])
  })

  it('explains a shift this view cannot see', () => {
    const n = viewsNote({ verdict: 'flagged_elsewhere', views: [view('P2', 'misplaced')] })
    expect(n).toMatchObject({ tone: 'elsewhere', title: 'Flagged from P2' })
    expect(n.text).toBe("P2 sees it as moved. One photo can't show depth, so this view may not see the move. Take a closer look on site.")
    expect(viewsNote({ verdict: 'flagged_elsewhere', views: [view('P1', 'missing')] }).text).toBe('P1 sees it as missing. Take a closer look on site.')
  })

  it('joins viewpoints that agree', () => {
    expect(viewsNote({ verdict: 'confirmed', views: [view('P2', 'missing'), view('P4', 'missing')] }).text)
      .toBe('P2 and P4 see it as missing too. Two viewpoints agree.')
    expect(viewsNote({ verdict: 'seen_ok_elsewhere', views: [view('P2', 'present_ok')] }))
      .toMatchObject({ tone: 'ok', title: 'Seen from P2', text: 'P2 sees it as built.' })
  })
})

describe('countViews', () => {
  it('is null with no other viewpoint, and counts the verdicts otherwise', () => {
    expect(countViews(undefined)).toBeNull()
    expect(countViews({})).toBeNull()
    const views: Record<string, MarkViews> = {
      '1': { verdict: 'confirmed', views: [view('P2', 'missing')] },
      '2': { verdict: 'disputed', views: [view('P4', 'present_ok')] },
      '3': { verdict: 'flagged_elsewhere', views: [view('P2', 'misplaced')] },
      '4': { verdict: 'seen_ok_elsewhere', views: [view('P2', 'present_ok')] },
    }
    const c = countViews(views)!
    expect(c).toEqual({ viewpoints: ['P2', 'P4'], confirmed: 1, disputed: 1, elsewhere: 1 })
    expect(viewsSummary(c)).toBe('Compared with P2 and P4: 1 confirmed, 1 where viewpoints disagree, 1 flagged from another viewpoint.')
    expect(viewsSummary({ viewpoints: ['P2'], confirmed: 0, disputed: 0, elsewhere: 0 })).toBe('Compared with P2.')
  })
})
