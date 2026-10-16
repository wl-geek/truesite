/**
 * "Why it matters": a fixed rule per kind of element and finding, shown under Gemini's explanation. It never comes
 * from the model (like severity, spec 4.4): Gemini says what it sees, these rules say what that means on site.
 */
import type { Finding } from '../api/types'

type Rule = { when: (f: Finding) => boolean; text: string }

const isConcreteColumn = (f: Finding) => f.ifc_class === 'IfcColumn' && /^RC\b/.test(f.name)

const RULES: Rule[] = [
  { when: (f) => f.ifc_class === 'IfcRailing' && f.status === 'missing',
    text: 'Fall hazard: keep people away from this edge until the guardrail is back.' },
  { when: (f) => isConcreteColumn(f) && f.status === 'missing',
    text: 'The floor above is not carried as designed: keep it propped and unloaded until the column is cast.' },
  { when: (f) => f.ifc_class === 'IfcColumn' && f.status === 'misplaced',
    text: 'Setting-out error: what sits on this column won\'t bear as designed. Get the engineer to confirm before the next pour or lift.' },
  { when: (f) => f.ifc_class === 'IfcMember' && /\bBrace\b/i.test(f.name) && f.status === 'missing',
    text: 'The frame relies on this brace for stability in wind: fit it before more steel goes up.' },
  { when: (f) => f.ifc_class === 'IfcMember' && /\bTruss\b/i.test(f.name) && f.status === 'missing',
    text: 'An incomplete truss can\'t carry its roof load: no sheeting or loads on this truss until it\'s fixed.' },
  { when: (f) => f.ifc_class === 'IfcMember' && /\bPurlin\b/i.test(f.name) && f.status === 'missing',
    text: 'The roof sheeting has nothing to fix to here: fit the purlin before sheeting this bay.' },
  { when: (f) => f.ifc_class === 'IfcBeam' && f.status === 'missing',
    text: 'The frame is not tied together here: brace it temporarily until the beam is in.' },
  { when: (f) => f.status === 'misplaced', text: 'Built away from the design: confirm with the engineer before work continues here.' },
  { when: (f) => f.status === 'missing', text: 'Missing from the design: check whether it is still to come or was left out.' },
  { when: (f) => f.status === 'different_from_design', text: 'Built differently from the design: check the drawing and the specification.' },
]

/** The site meaning of a deviation, or null for elements that match or can't be judged. */
export function whyItMatters(f: Finding): string | null {
  if (f.status === 'present_ok' || f.status === 'cannot_judge') return null
  return RULES.find((r) => r.when(f))?.text ?? null
}
