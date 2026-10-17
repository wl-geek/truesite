import { describe, expect, it } from 'vitest'
import type { Issue } from '../api/types'
import { issueText, savedWhen } from './issueList'

const issue: Issue = {
  id: 'i1', session_id: 's', project_id: 'site', guid: 'g', finding_ref: 'run1:8', run_id: 'run1',
  title: 'RC column B2 is about 60 cm off its grid line', description: 'Set out 60 cm west of grid B.',
  suggested_action: 'Stop work on B2 and get the engineer to check the setting-out.', severity: 'high', crop_box: null,
  photo_url: '/api/runs/run1/photo.jpg', created_at: '2026-10-17T07:05:00Z', status: 'open',
}

describe('issueText', () => {
  it('is the issue as plain text to paste into a message: title, severity and element, description, action, source', () => {
    expect(issueText(issue, 'RC column B2')).toBe([
      'RC column B2 is about 60 cm off its grid line',
      'High severity · RC column B2',
      '',
      'Set out 60 cm west of grid B.',
      '',
      'Suggested action: Stop work on B2 and get the engineer to check the setting-out.',
      '',
      'From a TrueSite as-built check. Visual check, not a survey.',
    ].join('\n'))
  })

  it('leaves out what it lacks', () => {
    const bare = { ...issue, severity: null, suggested_action: '', description: '' }
    expect(issueText(bare, null)).toBe('RC column B2 is about 60 cm off its grid line\n\nFrom a TrueSite as-built check. Visual check, not a survey.')
  })
})

describe('savedWhen', () => {
  const now = new Date('2026-10-17T07:30:00Z')
  it('says how long ago, then the day and time', () => {
    expect(savedWhen('2026-10-17T07:29:40Z', now)).toBe('just now')
    expect(savedWhen('2026-10-17T07:05:00Z', now)).toBe('25 min ago')
    expect(savedWhen('2026-10-17T04:30:00Z', now)).toBe('3 h ago')
    expect(savedWhen('2026-10-15T04:30:00Z', now)).toMatch(/^15 Oct, \d\d:\d\d$/) // in the viewer's own time zone
  })
})
