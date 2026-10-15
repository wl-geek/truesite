/** Types for palette.js (plain JS so scripts/make-usdz.mjs can share it). */
export type Kind = 'column' | 'beam' | 'truss' | 'purlin' | 'brace' | 'concrete' | 'rebar' | 'opening' | 'other'
export type Paint = { kind: Kind; solid: boolean }
export declare const KIND_COLOURS: Readonly<Record<Kind, number>>
export declare function kindOf(ifcClass: string, predefinedType?: string): Kind
export declare function isSolid(kind: Kind, material?: string): boolean
export type MaterialParams = { color: number; roughness: number; metalness: number; transparent: boolean; opacity: number; depthWrite: boolean }
export declare function materialParams(paint: Paint): MaterialParams
export declare function smoothShaded(kind: Kind): boolean
export declare function paintOf(element: { ifc_class: string; props?: Record<string, unknown> }): Paint
