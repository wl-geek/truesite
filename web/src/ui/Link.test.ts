import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Link } from './Link'

describe('Link', () => {
  it('passes its aria-label to the <a>, so an icon-only link (the camera view Exit) has a name', () => {
    const html = renderToStaticMarkup(createElement(Link, { to: '/#live', className: 'hud-exit', 'aria-label': 'Exit live AR', children: '×' }))
    expect(html).toMatch(/^<a [^>]*aria-label="Exit live AR"[^>]*>×<\/a>$/)
    expect(html).toContain('href="/#live"')
  })

  it('leaves aria-label off when none is given', () => {
    expect(renderToStaticMarkup(createElement(Link, { to: '/model', children: 'Model' }))).not.toContain('aria-label')
  })
})
