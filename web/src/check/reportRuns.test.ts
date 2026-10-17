import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadReportRuns, MAX_REPORT_RUNS, rememberReportRun, reportScope, withRun, type ReportRun } from './reportRuns'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k) },
    setItem: (k, v) => { m.set(k, String(v)) },
  }
}

const run = (runId: string, spot: string): ReportRun => ({ runId, spot })

describe('withRun', () => {
  it('adds a stored check once, last, and keeps the last 8 (what /api/report accepts)', () => {
    expect(withRun([run('a', 'P1'), run('b', 'P2')], run('a', 'P1'))).toEqual([run('b', 'P2'), run('a', 'P1')])
    const many = Array.from({ length: 12 }, (_, i) => run(`r${i}`, 'P1'))
    const kept = many.reduce<ReportRun[]>(withRun, [])
    expect(MAX_REPORT_RUNS).toBe(8)
    expect(kept.map((r) => r.runId)).toEqual(['r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11'])
  })
})

describe('loadReportRuns and rememberReportRun (audit C-03)', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the checks from earlier QR spots for the next visit, per project', () => {
    expect(loadReportRuns('site')).toEqual([])
    const afterP1 = rememberReportRun('site', loadReportRuns('site'), run('a', 'P1'))
    expect(afterP1).toEqual([run('a', 'P1')])
    // Exit, then step in at P2: a fresh visit starts from what this browser session stored.
    expect(rememberReportRun('site', loadReportRuns('site'), run('b', 'P2'))).toEqual([run('a', 'P1'), run('b', 'P2')])
    expect(loadReportRuns('site')).toEqual([run('a', 'P1'), run('b', 'P2')])
    expect(loadReportRuns('rooftop')).toEqual([])
    expect(sessionStorage.getItem('truesite.reportRuns.site')).not.toBeNull()
  })

  it('drops damaged entries and stored lists that are not lists', () => {
    sessionStorage.setItem('truesite.reportRuns.site', JSON.stringify([run('a', 'P1'), { runId: 3, spot: 'P2' }, null, 'b', { runId: 'c' }]))
    expect(loadReportRuns('site')).toEqual([run('a', 'P1')])
    sessionStorage.setItem('truesite.reportRuns.site', '{"runId":"a"}')
    expect(loadReportRuns('site')).toEqual([])
    sessionStorage.setItem('truesite.reportRuns.site', 'not json')
    expect(loadReportRuns('site')).toEqual([])
  })

  it('still counts this visit when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(loadReportRuns('site')).toEqual([])
    expect(rememberReportRun('site', [run('a', 'P1')], run('b', 'P1'))).toEqual([run('a', 'P1'), run('b', 'P1')])
  })
})

describe('reportScope', () => {
  it('says which QR spots the report covers', () => {
    expect(reportScope([run('a', 'P2')], 'P2')).toBe('this check')
    expect(reportScope([run('a', 'P1')], 'P2')).toBe('your check at P1')
    expect(reportScope([run('a', 'P3'), run('b', 'P3')], 'P3')).toBe('your 2 checks at P3')
    expect(reportScope([run('a', 'P2'), run('b', 'P1')], 'P2')).toBe('your 2 checks at P1 and P2')
    expect(reportScope([run('a', 'P4'), run('b', 'P1'), run('c', 'P2'), run('d', 'P1')], 'P1')).toBe('your 4 checks at P1, P2 and P4')
  })
})
