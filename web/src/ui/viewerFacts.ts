import type { ProjectManifest } from '../api/types'
import { metres } from './elementFacts'

/** The models the viewer offers, in the order judges meet them. */
export const VIEWER_PROJECTS: readonly { id: string; name: string }[] = [
  { id: 'site', name: 'Building under construction' },
  { id: 'rooftop', name: 'Rooftop concrete frame' },
  { id: 'room1', name: 'Demo room' },
]

/** A model at a glance, from its elements: plan size and height, the materials, and how many storeys it has. */
export function modelFacts(project: Pick<ProjectManifest, 'elements'>): { size: string; materials: string[]; storeys: number } {
  const els = project.elements
  if (!els.length) return { size: 'Empty model', materials: [], storeys: 0 }
  const min = (i: number) => Math.min(...els.map((e) => e.bbox_m[0][i]))
  const max = (i: number) => Math.max(...els.map((e) => e.bbox_m[1][i]))
  const [w, d] = [max(0) - min(0), max(1) - min(1)]
  const size = `${metres(Math.max(w, d)).replace(' m', '')} × ${metres(Math.min(w, d))} overall, ${metres(max(2) - Math.max(0, min(2)))} high`
  const materials = [...new Set(els.map((e) => e.props.Material).filter((m): m is string => typeof m === 'string' && m.length > 0))]
  return { size, materials: materials.slice(0, 4), storeys: new Set(els.map((e) => e.storey).filter(Boolean)).size }
}
