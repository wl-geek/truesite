import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CheckResult } from '../api/types'
import { FindingsPanel } from './FindingsPanel'

const result: CheckResult = {
  project_id: 'rooftop', anchor_id: 'R1', image_quality: 'good', pose_quality: 'good', findings: [], unexpected: [],
  summary: '', warnings: [], usage: null, model_version: null, saved_at: null,
}

const render = (viewNote?: string | null) =>
  renderToStaticMarkup(createElement(FindingsPanel, { result, selectedMark: null, onSelect: () => undefined, viewNote }))

describe('FindingsPanel', () => {
  it('says when part of the model was hidden or cut for the check', () => {
    expect(render('Checked as shown: Rebar hidden; cut above 3.3 m.')).toContain('<p class="note">Checked as shown: Rebar hidden; cut above 3.3 m.</p>')
  })

  it('adds no note when the whole model was checked', () => {
    expect(render(null)).not.toContain('Checked as shown')
    expect(render()).not.toContain('Checked as shown')
  })
})
