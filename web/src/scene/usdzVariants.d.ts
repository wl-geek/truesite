/** Types for usdzVariants.js (plain JS so scripts/make-usdz.mjs can share it). */
type Vec3 = readonly [number, number, number]
type Boxed = { bbox_m: readonly [Vec3, Vec3] }
type FloorLike = { position_m: Vec3; normal: Vec3; scale: number }
export type UsdzPlan = { centre: [number, number]; radii: number[]; reach: number }
export declare const USDZ_RADII: readonly number[]
export declare function footprintDistance(bbox: readonly [Vec3, Vec3], point: readonly [number, number]): number
export declare function withinRadius<T extends Boxed>(elements: readonly T[], centre: readonly [number, number], radius: number): T[]
export declare function usdzCentre(anchors: readonly FloorLike[], elements: readonly Boxed[]): [number, number]
export declare function usdzPlan(anchors: readonly FloorLike[], elements: readonly Boxed[]): UsdzPlan
export declare function usdzFile(projectId: string, radius: number | null): string
export declare function pickUsdzRadius(radiusM: number | null, plan: { radii: readonly number[]; reach: number }): number | null
