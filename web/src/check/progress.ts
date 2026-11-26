/** The steps of a check as the progress view (ui/CheckProgress.tsx) lists them. */
import type { CheckStep } from './runCheck'

/** The page marks the photo itself; runCheck reports the rest (CheckInput.onStep). */
export type ProgressStep = { step: 'photo' } | CheckStep
export type StepState = 'done' | 'now' | 'next'
export type ProgressRow = { key: ProgressStep['step']; label: string; state: StepState }

const ORDER: readonly ProgressStep['step'][] = ['photo', 'design', 'gemini', 'second_look']

export function progressRows(p: ProgressStep): ProgressRow[] {
  const at = ORDER.indexOf(p.step)
  const state = (i: number): StepState => (i < at ? 'done' : i === at ? 'now' : 'next')
  const marks = 'marks' in p ? p.marks : null
  const pending = p.step === 'second_look' ? p.pending : null
  return [
    { key: 'photo', label: at > 0 ? 'Photo taken' : 'Taking the photo', state: state(0) },
    { key: 'design', label: marks === null ? 'Drawing the design from the same spot' : `Design drawn from the same spot, ${marks} elements marked`,
      state: state(1) },
    { key: 'gemini', label: at > 2 ? "Gemini's first look is back" : 'Gemini compares each element with its outline', state: state(2) },
    { key: 'second_look', state: state(3),
      label: pending === null ? 'Second look: close-ups of the doubtful marks'
        : pending === 1 ? 'Second look: a close-up of 1 mark' : `Second look: close-ups of ${pending} marks` },
  ]
}
