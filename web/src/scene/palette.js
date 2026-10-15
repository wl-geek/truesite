// Colour by element type (issue #36), like the reference video: columns blue, beams cyan, truss members green,
// purlins yellow, bracing purple, footings and other concrete see-through grey, rebar orange-red.
// One palette for the 3D viewer (viewer.ts), every AR mode (look.ts) and both Quick Look paths (walkthrough.ts in
// the browser, scripts/make-usdz.mjs at build time). Plain JS with palette.d.ts beside it, because the Node build
// script can't import TypeScript. Display only: the check's ID buffer keeps its own idColor materials.

/** Display colour per kind (sRGB hex). */
export const KIND_COLOURS = Object.freeze({
  column: 0x2f6fde, // blue
  beam: 0x16b9d4, // cyan
  truss: 0x2fae4e, // green
  purlin: 0xf2c414, // yellow
  brace: 0x9b5bd6, // purple
  concrete: 0xb9bec4, // grey
  rebar: 0xe0441b, // orange-red
  opening: 0x4e7fb3, // sky blue (doors, windows, services)
  other: 0x4e7fb3,
})

const CONCRETE_CLASS = /^Ifc(Slab|Footing|Pile|Plate|Wall|WallStandardCase|Roof|Stair|Ramp)$/
const OPENING_CLASS = /^Ifc(Door|Window|Opening|Pipe|Duct|Flow|CableCarrier)/
const STEEL_KINDS = new Set(['column', 'beam', 'truss', 'purlin', 'brace'])

/** The display kind of an element from its IFC class and PredefinedType. */
export function kindOf(ifcClass, predefinedType = '') {
  if (/^Ifc(ReinforcingBar|ReinforcingMesh|Tendon)$/.test(ifcClass)) return 'rebar'
  if (ifcClass === 'IfcColumn') return 'column'
  if (ifcClass === 'IfcBeam') return 'beam'
  if (ifcClass === 'IfcMember') return predefinedType === 'PURLIN' ? 'purlin' : predefinedType === 'BRACE' ? 'brace' : 'truss'
  if (CONCRETE_CLASS.test(ifcClass)) return 'concrete'
  if (OPENING_CLASS.test(ifcClass)) return 'opening'
  return 'other'
}

/** Steel and rebar are drawn solid; concrete (a concrete column too, so its cage shows) and the rest see-through. */
export function isSolid(kind, material = '') {
  if (kind === 'rebar') return true
  return STEEL_KINDS.has(kind) && !/concrete/i.test(material)
}

/** MeshStandardMaterial parameters for the 3D viewer and Quick Look: solid steel and rebar, see-through concrete. */
export function materialParams({ kind, solid }) {
  return solid
    ? { color: KIND_COLOURS[kind], roughness: 0.7, metalness: 0, transparent: false, opacity: 1, depthWrite: true }
    : { color: KIND_COLOURS[kind], roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false }
}

/** Round sections (bars, bracing rods) get smooth normals; boxy sections keep crisp flat faces. */
export function smoothShaded(kind) {
  return kind === 'rebar' || kind === 'brace'
}

/** Kind and solidity of an elements.json row. */
export function paintOf(element) {
  const props = element.props ?? {}
  const kind = kindOf(element.ifc_class, String(props.PredefinedType ?? ''))
  return { kind, solid: isSolid(kind, String(props.Material ?? '')) }
}
