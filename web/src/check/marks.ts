// Choose which visible elements get numbered marks for Gemini, and draw the marks (spec 7.3).
import type { Element, MarkedElement } from '../api/types'
import type { VisibleElement } from '../scene/elements'

export const MAX_MARKS = 25

// Guardrails sit with structure: a missing one is a fall hazard.
const STRUCTURE = new Set(['IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPile', 'IfcPlate', 'IfcWall', 'IfcWallStandardCase', 'IfcRailing'])
// Slabs and footings are big flat surfaces (a flush pad, a soffit) that rarely show a deviation in a photo: after structure.
const OPENINGS_SERVICES = new Set(['IfcDoor', 'IfcWindow', 'IfcPipeSegment', 'IfcPipeFitting', 'IfcDuctSegment', 'IfcDuctFitting',
  'IfcFlowSegment', 'IfcFlowFitting', 'IfcCableCarrierSegment', 'IfcOpeningElement', 'IfcSlab', 'IfcFooting'])

/** 0 structure and guardrails, 1 openings, services, slabs and footings, 2 everything else. */
export function classPriority(ifcClass: string): number {
  if (STRUCTURE.has(ifcClass)) return 0
  if (OPENINGS_SERVICES.has(ifcClass)) return 1
  return 2
}

/**
 * How much an element counts for a mark: its size on screen, weighted towards the middle of the frame, where the
 * person aimed. An element at the centre counts about 1.7 times its size, one in a corner about 0.1 times.
 */
export function markWeight(v: Pick<VisibleElement, 'pixels' | 'box'>): number {
  const [y0, x0, y1, x1] = v.box
  const off = Math.hypot((x0 + x1) / 2 - 500, (y0 + y1) / 2 - 500) / 707 // 0 at the centre, 1 in a corner
  return v.pixels * (0.3 + Math.max(0, 1 - off)) ** 2
}

/** Element type for taking turns: class plus predefined type, so truss members, purlins and braces are separate. */
function typeKey(el: Element): string {
  return `${el.ifc_class}|${String(el.props?.PredefinedType ?? '')}`
}

function mm(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

function prop(el: Element, suffix: string): number | null {
  for (const [k, v] of Object.entries(el.props)) if (k.endsWith(suffix)) return mm(v)
  return null
}

/**
 * Cross-section of a column (plan width x depth) or a beam (width x depth), in mm, from its bounding box.
 * Null for other classes or a degenerate box.
 */
function sectionFromBox(el: Element): [number, number] | null {
  const [[x0, y0, z0], [x1, y1, z1]] = el.bbox_m
  const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0].map((v) => Math.round(v * 1000))
  const s: [number, number] | null = el.ifc_class === 'IfcColumn' ? [dx, dy] : el.ifc_class === 'IfcBeam' ? [Math.min(dx, dy), dz] : null
  return s && s[0] > 0 && s[1] > 0 ? s : null
}

/** Short human dimensions for the prompt, e.g. "100 mm thick, 2700 mm high" (<= 80 chars). */
export function keyDims(el: Element): string {
  const parts: string[] = []
  const dia = prop(el, '.OuterDiameter_mm')
  const width = prop(el, '.Width_mm')
  const depth = prop(el, '.Depth_mm')
  const height = prop(el, '.Height_mm')
  const length = prop(el, '.Length_mm')
  const section = !dia && !width && !depth ? sectionFromBox(el) : null
  if (dia) parts.push(`Ø${dia} mm`)
  if (section) parts.push(`${section[0]} × ${section[1]} mm section`)
  if (width) parts.push(`${width} mm ${el.ifc_class.startsWith('IfcWall') ? 'thick' : 'wide'}`)
  if (depth) parts.push(`${depth} mm deep`)
  if (height) parts.push(`${height} mm high`)
  if (length) parts.push(`${length} mm ${el.ifc_class === 'IfcColumn' ? 'high' : 'long'}`)
  if (!parts.length) {
    const [[x0, y0, z0], [x1, y1, z1]] = el.bbox_m
    const d = [x1 - x0, y1 - y0, z1 - z0].map((v) => Math.round(v * 1000))
    if (d.some((v) => v > 0)) parts.push(`${d[0]} × ${d[1]} × ${d[2]} mm`)
  }
  return parts.join(', ').slice(0, 80)
}

/**
 * Visible elements -> numbered marks: known elements only, one per GUID. By class priority, and within a priority
 * the element types take turns, each type's elements in order of markWeight (size, towards the centre of the frame),
 * so thin members and guardrails where the person aimed get checked in a view full of big beams.
 */
export function selectMarks(visible: readonly VisibleElement[], indexToGuid: readonly string[], elements: ReadonlyMap<string, Element>,
  max = MAX_MARKS): MarkedElement[] {
  const best = new Map<string, VisibleElement>()
  for (const v of visible) {
    const guid = indexToGuid[v.index]
    if (!guid || !elements.has(guid)) continue
    const prev = best.get(guid)
    if (!prev || v.pixels > prev.pixels) best.set(guid, v)
  }
  const tiers = new Map<number, Map<string, { guid: string; v: VisibleElement; el: Element }[]>>()
  for (const [guid, v] of best) {
    const el = elements.get(guid)!
    const tier = tiers.get(classPriority(el.ifc_class)) ?? new Map()
    tiers.set(classPriority(el.ifc_class), tier)
    const group = tier.get(typeKey(el)) ?? []
    tier.set(typeKey(el), group)
    group.push({ guid, v, el })
  }
  const picked: { guid: string; v: VisibleElement; el: Element }[] = []
  for (const p of [...tiers.keys()].sort((a, b) => a - b)) {
    const groups = [...tiers.get(p)!.values()].map((g) => g.sort((a, b) => markWeight(b.v) - markWeight(a.v)))
    groups.sort((a, b) => markWeight(b[0].v) - markWeight(a[0].v)) // the type with the weightiest element starts each round
    for (let round = 0; picked.length < max && groups.some((g) => g.length > round); round++) {
      for (const g of groups) if (round < g.length && picked.length < max) picked.push(g[round])
    }
  }
  return picked.map(({ guid, v, el }, i) => ({ mark: i + 1, guid, ifc_class: el.ifc_class, name: el.name, box: v.box, key_dims: keyDims(el) }))
}

/** Each mark's centre as a fraction of the frame (0..1), from the ID-buffer anchors (a pixel of the element itself). */
export function markCentres(marks: readonly MarkedElement[], visible: readonly VisibleElement[], indexToGuid: readonly string[],
  width: number, height: number): Map<number, [number, number]> {
  const byGuid = new Map<string, VisibleElement>()
  for (const v of visible) {
    const guid = indexToGuid[v.index]
    const prev = guid ? byGuid.get(guid) : undefined
    if (guid && (!prev || v.pixels > prev.pixels)) byGuid.set(guid, v)
  }
  const out = new Map<number, [number, number]>()
  for (const m of marks) {
    const v = byGuid.get(m.guid)
    if (v) out.set(m.mark, [v.anchor.x / width, v.anchor.y / height])
  }
  return out
}

/** Numbered circles at the mark centres (orange on white ring, readable on any render); `scale` < 1 for smaller ones. */
export function drawMarks(ctx: CanvasRenderingContext2D, centres: ReadonlyMap<number, [number, number]>, width: number, height: number,
  scale = 1): void {
  const r = Math.max(Math.round(12 * scale), Math.round(Math.min(width, height) * 0.022 * scale))
  ctx.save()
  ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [mark, [fx, fy]] of centres) {
    const x = fx * width
    const y = fy * height
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = '#FF6A13'
    ctx.fill()
    ctx.lineWidth = Math.max(2, r * 0.18)
    ctx.strokeStyle = '#FFFFFF'
    ctx.stroke()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(String(mark), x, y + 1)
  }
  ctx.restore()
}
