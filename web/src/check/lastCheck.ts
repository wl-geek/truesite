// The last check of this browser session, so the model viewer can show its pins and findings.
import type { CheckResult } from '../api/types'

export type LastCheck = { result: CheckResult; runId: string | null; at: string }

const key = (projectId: string) => `truesite.lastCheck.${projectId}`

export function saveLastCheck(projectId: string, value: LastCheck): void {
  try {
    sessionStorage.setItem(key(projectId), JSON.stringify(value))
  } catch {
    /* storage unavailable: the viewer just won't show the last check */
  }
}

export function loadLastCheck(projectId: string): LastCheck | null {
  try {
    const raw = sessionStorage.getItem(key(projectId))
    const v = raw ? (JSON.parse(raw) as LastCheck) : null
    return v && Array.isArray(v.result?.findings) ? v : null
  } catch {
    return null
  }
}
