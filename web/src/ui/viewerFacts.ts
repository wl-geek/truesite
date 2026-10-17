import type { ProjectManifest } from '../api/types'
import { metres } from './elementFacts'

/** The models the viewer shows: one, the building under construction. */
export const VIEWER_PROJECTS: readonly { id: string; name: string }[] = [
  { id: 'site', name: 'Building under construction' },
]

/** The model card's title: our name for a known model, else the project's own name without its "(1:1)" scale. */
export function viewerTitle(project: Pick<ProjectManifest, 'project_id' | 'name'>): string {
  return VIEWER_PROJECTS.find((p) => p.id === project.project_id)?.name ?? project.name.replace(/\s*\(1:1\)$/, '')
}

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
