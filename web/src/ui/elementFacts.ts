/**
 * An element's model data in plain words for the element panel: what it is, where it is, its size, material and
 * role, and the design notes, instead of IFC codes and property-set keys. Only what the model holds: sizes come from
 * its quantities or its bounding box, never guessed. The raw IFC data stays available as technical rows.
 */
import type { Element } from '../api/types'
import { paintOf, type Kind } from '../scene/palette'
import { formatValue } from './format'

export type Fact = { label: string; value: string }
export type ElementSummary = {
  /** "Reinforced concrete column" */
  typeLabel: string
  /** The colour-key kind (palette.js), for the swatch. */
  kind: Kind
  /** "Grid A1 · 0 to 4.5 m" */
  location: string | null
  facts: Fact[]
  /** Design notes from the model (install, spec). */
  notes: string[]
  /** Other properties, in plain words. */
  more: Fact[]
  /** IFC class, IFC type, storey and GUID: for people who work in BIM. */
  technical: Fact[]
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** Metres for people: "4.5 m", "5.55 m", "12 m". */
export function metres(m: number): string {
  const r = Math.round(m * 100) / 100
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')} m`
}

const millimetres = (m: number): number => Math.round(m * 1000)

/** The element's type in plain words, from its IFC class, predefined type, material and name. */
export function typeLabel(el: Element): string {
  const t = str(el.props.PredefinedType).toUpperCase()
  const material = str(el.props.Material).toLowerCase()
  const concrete = material.includes('concrete')
  const steel = material.includes('steel')
  const name = el.name.toLowerCase()
  switch (el.ifc_class) {
    case 'IfcColumn': return concrete ? 'Reinforced concrete column' : steel ? 'Steel column' : 'Column'
    case 'IfcBeam': return concrete ? 'Reinforced concrete beam' : steel ? 'Steel beam' : 'Beam'
    case 'IfcSlab': return t === 'ROOF' ? 'Roof slab' : concrete ? 'Concrete floor slab' : 'Floor slab'
    case 'IfcFooting': return t === 'PAD_FOOTING' ? 'Pad footing' : t === 'STRIP_FOOTING' ? 'Strip footing' : 'Footing'
    case 'IfcMember':
      if (t === 'PURLIN') return 'Roof purlin'
      if (t === 'BRACE') return 'Bracing member'
      if (t === 'CHORD') return 'Truss chord'
      if (name.includes('truss')) return name.includes('vertical') ? 'Truss vertical' : name.includes('diagonal') ? 'Truss diagonal' : 'Truss member'
      return steel ? 'Steel member' : 'Member'
    case 'IfcRailing': return t === 'GUARDRAIL' ? 'Edge protection guardrail' : 'Railing'
    case 'IfcReinforcingBar': return name.includes('mat') ? 'Rebar mat' : 'Rebar cage'
    case 'IfcWall':
    case 'IfcWallStandardCase': return t === 'PARTITIONING' ? 'Partition wall' : el.load_bearing ? 'Load-bearing wall' : 'Wall'
    case 'IfcDoor': return 'Door'
    case 'IfcWindow': return 'Window'
    case 'IfcPipeSegment': return t === 'SLEEVE' ? 'Pipe sleeve' : 'Pipe'
    case 'IfcDuctSegment': return 'Duct'
    default: return el.ifc_class.replace(/^Ifc/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) || 'Element'
  }
}

/** A property value by the end of its key ("Length_mm" finds "Qto_BeamBaseQuantities.Length_mm"). */
function prop(el: Element, suffix: string): unknown {
  for (const [k, v] of Object.entries(el.props)) if (k === suffix || k.endsWith(`.${suffix}`)) return v
  return undefined
}

/** Size in plain words, from the quantities where the model has them, else from the bounding box. */
export function sizeText(el: Element): string | null {
  const [[x0, y0, z0], [x1, y1, z1]] = el.bbox_m
  const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0]
  const length = num(prop(el, 'Length_mm'))
  const plan = `${metres(Math.max(dx, dy)).replace(' m', '')} × ${metres(Math.min(dx, dy))}`
  switch (el.ifc_class) {
    case 'IfcColumn':
      return `${millimetres(dx)} × ${millimetres(dy)} mm section, ${metres(length ? length / 1000 : dz)} high`
    case 'IfcBeam': {
      const span = length ? length / 1000 : Math.max(dx, dy)
      return `${millimetres(Math.min(dx, dy))} wide × ${millimetres(dz)} deep, ${metres(span)} long`
    }
    case 'IfcSlab': {
      const depth = num(prop(el, 'Depth_mm')) ?? millimetres(dz)
      return `${plan}, ${depth} mm thick`
    }
    case 'IfcWall':
    case 'IfcWallStandardCase': {
      const w = num(prop(el, 'Width_mm')) ?? millimetres(Math.min(dx, dy))
      const h = num(prop(el, 'Height_mm'))
      return `${metres(length ? length / 1000 : Math.max(dx, dy))} long, ${w} mm thick, ${metres(h ? h / 1000 : dz)} high`
    }
    case 'IfcFooting': return `${plan} in plan`
    case 'IfcMember': return length ? `${metres(length / 1000)} long` : null
    case 'IfcRailing': return `${metres(Math.max(dx, dy))} long, ${metres(dz)} high`
    case 'IfcReinforcingBar':
      return dz > Math.max(dx, dy) ? `${millimetres(dx)} × ${millimetres(dy)} mm, ${metres(dz)} tall` : `${plan} in plan`
    case 'IfcDoor':
    case 'IfcWindow': return `${millimetres(Math.max(dx, dy))} wide × ${millimetres(dz)} high (mm)`
    case 'IfcPipeSegment': {
      const d = num(prop(el, 'OuterDiameter_mm'))
      return [d ? `Ø${d} mm` : null, length ? `${length} mm long` : null].filter(Boolean).join(', ') || null
    }
    default:
      return dx > 0 || dy > 0 || dz > 0 ? `${metres(dx)} × ${metres(dy)} × ${metres(dz)}` : null
  }
}

/** Concrete volume of a solid concrete column, beam, slab or wall, from its box (footings are modelled as a top only). */
function concreteVolume(el: Element): string | null {
  if (!/concrete/i.test(str(el.props.Material)) || !/^Ifc(Column|Beam|Slab|Wall|WallStandardCase)$/.test(el.ifc_class)) return null
  const [[x0, y0, z0], [x1, y1, z1]] = el.bbox_m
  const v = (x1 - x0) * (y1 - y0) * (z1 - z0)
  return v > 0 ? `about ${v < 10 ? v.toFixed(2) : v.toFixed(1)} m³` : null
}

/** Plain-language label for a property key: "Pset_WallCommon.FireRating" -> "Fire rating", "GrossArea_m2" -> "Gross area". */
export function propLabel(key: string): string {
  const CORE: Record<string, string> = {
    ifc_class: 'IFC class', name: 'Name', storey: 'Storey', load_bearing: 'Load-bearing', bbox_m: 'Extent (model coordinates)',
    PredefinedType: 'IFC type', ObjectType: 'Object type', Material: 'Material',
  }
  if (CORE[key]) return CORE[key]
  const last = key.split('.').pop() ?? key
  const words = last.replace(/_(mm|m2|m3|m)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
  const KNOWN: Record<string, string> = { 'is external': 'External', 'load bearing': 'Load-bearing', install: 'Install notes', grid: 'Grid' }
  const label = KNOWN[words] ?? words
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** A property value with the unit its key carries ("Width_mm": 100 -> "100 mm"). */
function valueWithUnit(key: string, v: unknown): string {
  const unit = /_mm$/i.test(key) ? ' mm' : /_m2$/i.test(key) ? ' m²' : /_m3$/i.test(key) ? ' m³' : /_m$/i.test(key) ? ' m' : ''
  return typeof v === 'number' && unit ? `${v}${unit}` : formatValue(v)
}

const LOCATION_KEYS = ['Grid', 'Bay', 'Truss', 'Level']
const SIZE_KEYS = ['Length_mm', 'Width_mm', 'Height_mm', 'Depth_mm', 'OuterDiameter_mm']

export function summarise(el: Element, opts: { multiStorey?: boolean } = {}): ElementSummary {
  const used = new Set<string>()
  const take = (suffix: string): unknown => {
    for (const [k, v] of Object.entries(el.props)) {
      if (k === suffix || k.endsWith(`.${suffix}`)) {
        used.add(k)
        return v
      }
    }
    return undefined
  }
  const place: string[] = []
  const grid = str(take('Grid'))
  if (grid) place.push(`Grid ${grid.replace('-', '–')}`)
  const bay = str(take('Bay'))
  if (bay) place.push(`Bay ${bay.replace('-', '–')}`)
  const truss = str(take('Truss'))
  if (truss) place.push(`Truss ${truss}`)
  const level = str(take('Level'))
  if (level) place.push(/^\d+$/.test(level) ? `Level ${level}` : level)
  else if (opts.multiStorey && el.storey) place.push(el.storey)
  const [[, , z0], [, , z1]] = el.bbox_m
  place.push(`height ${metres(z0).replace(' m', '')} to ${metres(z1)}`)

  const facts: Fact[] = []
  const size = sizeText(el)
  if (size) facts.push({ label: 'Size', value: size })
  for (const k of SIZE_KEYS) take(k)
  const material = str(take('Material'))
  if (material) facts.push({ label: 'Material', value: material })
  for (const k of Object.keys(el.props)) if (/LoadBearing$/.test(k)) used.add(k)
  if (el.load_bearing !== null) facts.push({ label: 'Structural role', value: el.load_bearing ? 'Load-bearing' : 'Not load-bearing' })
  const volume = concreteVolume(el)
  if (volume) facts.push({ label: 'Concrete volume', value: volume })
  const fire = str(take('FireRating'))
  if (fire) facts.push({ label: 'Fire rating', value: fire })
  const service = str(take('Service'))
  if (service) facts.push({ label: 'Service', value: service })
  const external = take('IsExternal')
  if (typeof external === 'boolean') facts.push({ label: 'Exposure', value: external ? 'External' : 'Internal' })

  const notes: string[] = []
  const install = str(take('Install'))
  if (install) notes.push(install)
  used.add('PredefinedType')
  for (const k of LOCATION_KEYS) take(k)

  const more = Object.entries(el.props)
    .filter(([k]) => !used.has(k))
    .map(([k, v]) => ({ label: propLabel(k), value: valueWithUnit(k, v) }))
  const technical: Fact[] = [
    { label: 'IFC class', value: el.ifc_class },
    ...(el.props.PredefinedType ? [{ label: 'IFC type', value: str(el.props.PredefinedType) }] : []),
    ...(el.storey ? [{ label: 'IFC storey', value: el.storey }] : []),
    { label: 'GUID', value: el.guid },
  ]
  return { typeLabel: typeLabel(el), kind: paintOf(el).kind, location: place.join(' · ') || null, facts, notes, more, technical }
}

/** Questions worth asking about this element, from the data it actually has (Gemini answers only from that). */
export function askSuggestions(el: Element): string[] {
  const out: string[] = []
  const material = str(el.props.Material).toLowerCase()
  const notes = str(prop(el, 'Install'))
  if (/concrete/.test(material) && /T\d|link|rebar|bar/i.test(notes)) out.push('How is it reinforced?')
  if (/concrete/.test(material) && /cover/i.test(notes)) out.push('What concrete cover is needed?')
  if (prop(el, 'FireRating') !== undefined) out.push("What's the fire rating?")
  if (notes && out.length < 2) out.push('What do the install notes say?')
  if (material) out.push('What is it made of?')
  out.push('How big is it?')
  if (el.load_bearing !== null) out.push('Is it load-bearing?')
  return [...new Set(out)].slice(0, 4)
}
