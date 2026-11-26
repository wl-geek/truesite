import { describe, expect, it } from 'vitest'
import { progressRows } from './progress'

const states = (rows: ReturnType<typeof progressRows>) => rows.map((r) => r.state)

describe('check progress', () => {
  it('marks the steps before the current one done and the rest to come', () => {
    expect(states(progressRows({ step: 'photo' }))).toEqual(['now', 'next', 'next', 'next'])
    expect(states(progressRows({ step: 'gemini', marks: 25 }))).toEqual(['done', 'done', 'now', 'next'])
    expect(states(progressRows({ step: 'second_look', marks: 25, pending: 8 }))).toEqual(['done', 'done', 'done', 'now'])
  })

  it('names the counts once they are known', () => {
    const early = progressRows({ step: 'design' }).map((r) => r.label)
    expect(early).toEqual(['Photo taken', 'Drawing the design from the same spot', 'Gemini compares each element with its outline',
      'Second look: close-ups of the doubtful marks'])
    const late = progressRows({ step: 'second_look', marks: 25, pending: 1 }).map((r) => r.label)
    expect(late).toEqual(['Photo taken', 'Design drawn from the same spot, 25 elements marked', "Gemini's first look is back",
      'Second look: a close-up of 1 mark'])
    expect(progressRows({ step: 'second_look', marks: 25, pending: 8 })[3].label).toBe('Second look: close-ups of 8 marks')
  })
})
