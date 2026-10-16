import { describe, expect, it } from 'vitest'
import { reportText } from './ReportDialog'

describe('reportText', () => {
  it('lays the report out as plain text, safety first, skipping empty sections', () => {
    const text = reportText({ title: 'Site report', summary: 'Two checks.', safety: ['Edge protection east at P2: missing.'],
      structure: [], progress: ['RC column C2 at P1: not cast.'], next_steps: ['Refit the guardrail.'], checks: 2 })
    expect(text).toBe('Site report\n\nTwo checks.\n\nSafety\n- Edge protection east at P2: missing.\n\nProgress\n- RC column C2 at P1: not cast.\n\nNext steps\n- Refit the guardrail.\n')
    expect(text.indexOf('Safety')).toBeLessThan(text.indexOf('Progress'))
  })
})
