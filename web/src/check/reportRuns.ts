// The stored checks of this browser session that the day's site report covers, across QR spots (audit C-03).
// Each spot is a fresh VirtualSite, so the list lives here, like lastCheck.ts, not in the component's state.

/** One stored check run and the QR spot it was taken at. */
export type ReportRun = { runId: string; spot: string }

/** The most runs POST /api/report takes (ReportRequest.run_ids). */
export const MAX_REPORT_RUNS = 8

const key = (projectId: string) => `truesite.reportRuns.${projectId}`

const isRun = (v: unknown): v is ReportRun =>
  typeof v === 'object' && v !== null && typeof (v as ReportRun).runId === 'string' && typeof (v as ReportRun).spot === 'string'

/** The list with `run` added last, once, keeping the last MAX_REPORT_RUNS. */
export function withRun(runs: readonly ReportRun[], run: ReportRun): ReportRun[] {
  return [...runs.filter((r) => r.runId !== run.runId), run].slice(-MAX_REPORT_RUNS)
}

export function loadReportRuns(projectId: string): ReportRun[] {
  try {
    const raw = sessionStorage.getItem(key(projectId))
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter(isRun).slice(-MAX_REPORT_RUNS) : []
  } catch {
    return []
  }
}

/** Adds a stored check to this session's list and returns the new list (this visit's, if storage is blocked). */
export function rememberReportRun(projectId: string, runs: readonly ReportRun[], run: ReportRun): ReportRun[] {
  const next = withRun(runs, run)
  try {
    sessionStorage.setItem(key(projectId), JSON.stringify(next))
  } catch {
    /* storage unavailable: the report covers this visit only */
  }
  return next
}

/** "this check", "your check at P1", "your 3 checks at P1 and P2": what the report covers, seen from `spot`. */
export function reportScope(runs: readonly ReportRun[], spot: string): string {
  if (runs.length === 1 && runs[0].spot === spot) return 'this check'
  const spots = [...new Set(runs.map((r) => r.spot))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const where = spots.length > 1 ? `${spots.slice(0, -1).join(', ')} and ${spots[spots.length - 1]}` : spots[0]
  return `your ${runs.length === 1 ? 'check' : `${runs.length} checks`} at ${where}`
}
