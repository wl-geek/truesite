import type { ApiError } from '../api/client'
import type { Element } from '../api/types'
import { propLabel } from './elementFacts'
import { formatValue, loadBearingText } from './format'

export const MAX_QUESTION = 300
export const SUGGESTIONS = ["What's the fire rating?", 'Any install notes?', 'What material is it?', 'How thick is it?']

/** The cited fields with their values from the element itself, so the user can see the grounding. */
export function citedRows(element: Element, cited: readonly string[]): [string, string][] {
  const core: Record<string, string> = {
    ifc_class: element.ifc_class, name: element.name, storey: element.storey, load_bearing: loadBearingText(element.load_bearing),
    bbox_m: element.bbox_m.map((p) => `(${p.join(', ')})`).join(' – '),
  }
  return cited.map((k) => [propLabel(k), k in core ? core[k] : formatValue(element.props[k])]) // plain labels, not IFC keys
}

export function confidenceNote(confidence: number): string | null {
  return confidence < 0.5 ? 'Low confidence — check the drawings or ask the designer.' : null
}

export function askErrorMessage(err: Pick<ApiError, 'status' | 'code' | 'retryAfterS'>): string {
  switch (err.code) {
    case 'rate_limited':
      return 'Too many questions from this network. Try again in a few minutes.'
    case 'daily_cap':
      return "Today's free Gemini use is used up. Try again tomorrow."
    case 'model_quota':
      return "Gemini's usage limit is reached. Try again in a minute."
    case 'unknown_element':
      return 'This element is no longer in the model.'
    case 'network':
      return 'No connection. Check your network and try again.'
    case 'timeout':
      return 'That took too long. Try again.'
    default:
      return "Couldn't answer — try again."
  }
}
