import { describe, expect, it } from 'vitest'
import { sheetInfo } from './sheet'

const base = { project_id: 'site', anchor_id: 'P1', position_m: [9, -1.5, 1.4] as [number, number, number], scale: 1 }

describe('sheetInfo', () => {
  it('names the PDF of this exact sheet and its paper size', () => {
    const s = sheetInfo({ ...base, label: 'P1 South approach: upright A3, code at 1.4 m', normal: [0, -1, 0] })
    expect(s.href).toBe('/sheets/site-P1.pdf')
    expect(s.paper).toBe('A3')
    expect(s.print).toBe('Print it on A3 at 100%, not "Fit to page". Its check bar must measure 10.0 cm.')
  })

  it('says to stand an upright sheet at its code height, and to lay desk and floor sheets flat', () => {
    expect(sheetInfo({ ...base, label: 'upright A3', normal: [0, -1, 0] }).place).toBe('Fix it upright, with the centre of the code 1.4 m above the ground.')
    const desk = sheetInfo({ ...base, anchor_id: 'D1', label: 'Building desk sheet A4 (1:100)', normal: [0, 0, 1], scale: 0.01 })
    expect(desk.flat && desk.place === 'Lay it flat on a table.' && desk.href === '/sheets/site-D1.pdf').toBe(true)
    expect(sheetInfo({ ...base, label: 'Rooftop floor sheet A2 (1:1)', normal: [0, 0, 1] }).place).toBe('Lay it flat on the floor, with room to walk around it.')
  })

  it('leaves the paper size out when the label has none', () => {
    const s = sheetInfo({ ...base, label: 'Wall sheet', normal: [1, 0, 0] })
    expect(s.paper).toBeNull()
    expect(s.print).toBe('Print it at 100%, not "Fit to page". Its check bar must measure 10.0 cm.')
  })
})
