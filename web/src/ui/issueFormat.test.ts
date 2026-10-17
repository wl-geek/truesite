import { describe, expect, it } from 'vitest'
import type { Finding } from '../api/types'
import { issueBody, templateDraft } from './issueFormat'

const f: Finding = { mark: 2, guid: 'g', name: 'Door D-01', ifc_class: 'IfcDoor', status: 'misplaced', confidence: 0.8,
  evidence_box: [1, 2, 3, 4], offset: { direction: 'right', approx_cm: 30 }, explanation: 'Opening sits right.', severity: 'medium' }

describe('issueFormat', () => {
  it('drafts from the finding without Gemini', () => {
    const d = templateDraft(f, null)
    expect(d.title).toBe('Door D-01: Misplaced, about 30 cm right')
    expect(d.description).toBe('Opening sits right. Visual check, not a survey.')
  })
  it('builds the save body with the run reference, severity and crop box', () => {
    const body = issueBody('room1', f, 'RUN123', { title: ' T ', description: 'D', suggested_action: 'A' })
    expect(body).toEqual({ project_id: 'room1', guid: 'g', run_id: 'RUN123', finding_ref: 'RUN123:2', title: 'T', description: 'D',
      suggested_action: 'A', severity: 'medium', crop_box: [1, 2, 3, 4] })
    expect(issueBody('room1', f, null, templateDraft(f, null)).finding_ref).toBeNull()
  })
})

describe('issueFormat (mutation-tested)', () => {
  it('keeps a template draft within the issue limits (title 80, description 500)', () => {
    const d = templateDraft({ ...f, name: 'N'.repeat(120), explanation: 'E'.repeat(600) }, null)
    expect(d.title).toHaveLength(80)
    expect(d.title).toBe('N'.repeat(80))
    expect(d.description).toHaveLength(500)
    expect(d.suggested_action).toBe('Check on site and confirm with the design team before closing.')
  })

  it('starts the description with the copy rule when there is no explanation', () => {
    expect(templateDraft({ ...f, explanation: '' }, null).description).toBe('Visual check, not a survey.')
  })

  it('trims every text field it saves', () => {
    const body = issueBody('site', f, null, { title: '  T  ', description: '\n D \n', suggested_action: '  A ' })
    expect([body.title, body.description, body.suggested_action]).toEqual(['T', 'D', 'A'])
    expect(body.finding_ref).toBeNull()
  })
})
