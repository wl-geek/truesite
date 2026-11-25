import { describe, expect, it } from 'vitest'
import { CONFIDENCE_BANDS, confidenceBand, confidenceText, shownConfidence } from './confidence'

describe('confidence bands', () => {
  it('bands at High >= 0.85, Medium >= 0.6, Low below', () => {
    expect(CONFIDENCE_BANDS).toEqual({ high: 0.85, medium: 0.6 })
    expect([1, 0.92, 0.85].map(confidenceBand)).toEqual(['high', 'high', 'high'])
    expect([0.849, 0.71, 0.6].map(confidenceBand)).toEqual(['high', 'medium', 'medium']) // 0.849 shows as 0.85
    expect([0.844, 0.599, 0.55, 0.5, 0].map(confidenceBand)).toEqual(['medium', 'medium', 'low', 'low', 'low'])
  })

  it('bands the number as it is shown, so the band and the number always agree', () => {
    for (let i = 0; i <= 1000; i++) {
      const c = i / 1000
      const shown = shownConfidence(c)
      expect(confidenceBand(c)).toBe(shown >= 0.85 ? 'high' : shown >= 0.6 ? 'medium' : 'low')
    }
  })

  it('reads "High · 0.92", "Medium · 0.71", "Low · 0.55 — take a closer look"', () => {
    expect(confidenceText(0.92)).toBe('High · 0.92')
    expect(confidenceText(0.71)).toBe('Medium · 0.71')
    expect(confidenceText(0.55)).toBe('Low · 0.55 — take a closer look')
    expect(confidenceText(0.55, { hint: false })).toBe('Low · 0.55')
    expect(confidenceText(0.6)).toBe('Medium · 0.60')
    expect(confidenceText(1)).toBe('High · 1.00')
  })

  it('keeps odd numbers inside 0..1', () => {
    expect(shownConfidence(1.7)).toBe(1)
    expect(shownConfidence(-0.2)).toBe(0)
    expect(shownConfidence(Number.NaN)).toBe(0)
    expect(confidenceText(Number.NaN, { hint: false })).toBe('Low · 0.00')
  })
})
