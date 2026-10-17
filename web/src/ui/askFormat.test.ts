import { describe, expect, it } from 'vitest'
import type { Element } from '../api/types'
import { askErrorMessage, citedRows, confidenceNote } from './askFormat'

const el: Element = { guid: 'g', ifc_class: 'IfcWall', name: 'Wall W-01', storey: 'Level 1', bbox_m: [[0, 0, 0], [3, 0.1, 2.7]],
  load_bearing: true, props: { 'Pset_WallCommon.FireRating': '60 min', 'TrueSite_Notes.Install': 'Board after sleeves' } }

describe('askFormat', () => {
  it('shows cited fields with the element’s own values', () => {
    expect(citedRows(el, ['Pset_WallCommon.FireRating', 'load_bearing', 'storey'])).toEqual([
      ['Pset_WallCommon.FireRating', '60 min'], ['load_bearing', 'Yes'], ['storey', 'Level 1']])
  })
  it('flags low confidence', () => {
    expect(confidenceNote(0.4)).toMatch(/Low confidence/)
    expect(confidenceNote(0.8)).toBeNull()
  })
  it('explains errors', () => {
    expect(askErrorMessage({ status: 429, code: 'rate_limited' })).toMatch(/Too many questions/)
    expect(askErrorMessage({ status: 503, code: 'model_unavailable' })).toBe("Couldn't answer — try again.")
    expect(askErrorMessage({ status: 0, code: 'network' })).toMatch(/No connection/)
    expect(askErrorMessage({ status: 0, code: 'timeout' })).toMatch(/too long/)
    expect(askErrorMessage({ status: 0, code: 'timeout' })).not.toMatch(/connection|network/i)
    expect(askErrorMessage({ status: 0 })).toBe("Couldn't answer — try again.") // not an HTTP failure: don't blame the network
  })
})

describe('askFormat (mutation-tested)', () => {
  it('shows the bounding box as two corner points', () => {
    expect(citedRows(el, ['bbox_m'])).toEqual([['bbox_m', '(0, 0, 0) – (3, 0.1, 2.7)']])
    expect(citedRows(el, ['ifc_class', 'name'])).toEqual([['ifc_class', 'IfcWall'], ['name', 'Wall W-01']])
  })

  it('flags confidence below one half only', () => {
    expect(confidenceNote(0.5)).toBeNull()
    expect(confidenceNote(0.49)).toMatch(/Low confidence/)
  })

  it('explains the daily cap and a removed element', () => {
    expect(askErrorMessage({ status: 429, code: 'daily_cap' })).toBe("Today's free Gemini use is used up. Try again tomorrow.")
    expect(askErrorMessage({ status: 429, code: 'model_quota' })).toBe("Gemini's usage limit is reached. Try again in a minute.")
    expect(askErrorMessage({ status: 404, code: 'unknown_element' })).toBe('This element is no longer in the model.')
  })
})
