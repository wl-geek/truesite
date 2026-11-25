import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfidenceBadge } from './ConfidenceBadge'

const text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('ConfidenceBadge', () => {
  it('shows the band and the number, with the hint on a low band only', () => {
    expect(text(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.92 })))).toBe('Confidence High · 0.92')
    expect(text(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.71 })))).toBe('Confidence Medium · 0.71')
    expect(text(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.55 })))).toBe('Confidence Low · 0.55— take a closer look')
    expect(text(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.55, label: false, hint: false })))).toBe('Low · 0.55')
  })

  it('carries the band as a class for its bars and colour', () => {
    expect(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.86 }))).toContain('class="conf conf-high"')
    expect(renderToStaticMarkup(createElement(ConfidenceBadge, { value: 0.6 }))).toContain('class="conf conf-medium"')
  })
})
