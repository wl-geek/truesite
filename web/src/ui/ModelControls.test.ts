import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { buildLoadedModel } from '../scene/loadModel'
import { applyConstructionLook } from '../scene/look'
import { ModelControls } from './ModelControls'

function look() {
  const g = new Group()
  for (const name of ['C'.repeat(22), 'R'.repeat(22)]) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    m.name = name
    g.add(m)
  }
  const cls: Record<string, string> = { ['C'.repeat(22)]: 'IfcColumn', ['R'.repeat(22)]: 'IfcReinforcingBar' }
  return applyConstructionLook(buildLoadedModel(g, new Set(Object.keys(cls))), (guid) => cls[guid], 1)
}

const render = (l: ReturnType<typeof look>, maxHeightM: number) => renderToStaticMarkup(createElement(ModelControls, { look: l, maxHeightM, maxRadiusM: 12.7 }))
const chip = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*>${label}</button>`))?.[1]

describe('ModelControls', () => {
  it('reads "off" for a fresh look, even when the model top is not a whole tenth (rooftop 7.65 m)', () => {
    const html = render(look(), 7.65)
    expect(html).toContain('Cut above off')
    expect(html).toContain('View distance all')
    expect(chip(html, 'Rebar')).toBe('true')
  })

  it('shows the look as it is when it mounts again', () => {
    const l = look()
    l.setLayerVisible('rebar', false)
    l.setSection(3.3)
    l.setTransparency(0.4)
    l.setRadius(5)
    const html = render(l, 7.65)
    expect(chip(html, 'Rebar')).toBe('false')
    expect(chip(html, 'Structure')).toBe('true')
    expect(html).toContain('Cut above 3.3 m')
    expect(html).toMatch(/value="40"/)
    expect(html).toContain('View distance 5 m')
  })
})
