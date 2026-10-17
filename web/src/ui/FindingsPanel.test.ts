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

  it('offers Draft issue on deviations only when the photo was good enough (audit A-52)', () => {
    const finding = { mark: 1, guid: 'g'.repeat(22), name: 'Column', ifc_class: 'IfcColumn', status: 'missing', confidence: 0.9,
      evidence_box: null, offset: null, explanation: '', severity: 'high' } as const
    const html = (image_quality: CheckResult['image_quality']) => renderToStaticMarkup(createElement(FindingsPanel, {
      result: { ...result, image_quality, findings: [finding] }, selectedMark: null, onSelect: () => undefined, onDraftIssue: () => undefined,
    }))
    expect(html('good')).toContain('Draft issue')
    for (const q of ['too_dark', 'blurred', 'marker_far', 'occluded'] as const) expect(html(q)).not.toContain('Draft issue')
  })

  it('adds no note when the whole model was checked', () => {
    expect(render(null)).not.toContain('Checked as shown')
    expect(render()).not.toContain('Checked as shown')
  })

  it('tags findings with a saved issue and ends with the footer it is given', () => {
    const finding = { mark: 1, guid: 'g'.repeat(22), name: 'Column', ifc_class: 'IfcColumn', status: 'missing', confidence: 0.9,
      evidence_box: null, offset: null, explanation: '', severity: 'high' } as const
    const html = renderToStaticMarkup(createElement(FindingsPanel, {
      result: { ...result, findings: [finding] }, selectedMark: null, onSelect: () => undefined,
      savedGuids: new Set([finding.guid]), footer: createElement('p', { id: 'foot' }, 'Saved issues'),
    }))
    expect(html).toContain('<span class="finding-saved">✓ Issue saved</span>')
    expect(html.endsWith('<p id="foot">Saved issues</p></section>')).toBe(true)
    expect(renderToStaticMarkup(createElement(FindingsPanel, { result: { ...result, findings: [finding] }, selectedMark: null, onSelect: () => undefined })))
      .not.toContain('Issue saved')
  })
})
