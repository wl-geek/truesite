import type { Element } from '../api/types'

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

export function loadBearingText(v: boolean | null): string {
  return v === null ? 'Not stated' : v ? 'Yes' : 'No'
}

/** [name, display value] rows: Material first, then the rest alphabetically by property name. */
export function propertyRows(element: Element): [string, string][] {
  return Object.entries(element.props)
    .sort(([a], [b]) => (a === 'Material' ? -1 : b === 'Material' ? 1 : a.localeCompare(b)))
    .map(([k, v]) => [k, formatValue(v)])
}
