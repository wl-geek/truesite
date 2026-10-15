// Distance variants of the Quick Look file. The live View distance slider can't run inside AR Quick Look, so the
// build (scripts/make-usdz.mjs) also writes <project>-r<R>.usdz with only the elements whose plan footprint is within
// R metres of the spot the model is placed by, and Walk inside opens the file nearest the current setting.
// Plain JS with usdzVariants.d.ts beside it, shared by the build script and the app so both agree on the files.

/** Radii (m) to try; a variant is written only when it leaves something out. */
export const USDZ_RADII = Object.freeze([8, 15])

/** Horizontal distance (m) from a point to an element's plan footprint, 0 when the point is inside it. */
export function footprintDistance(bbox, [x, y]) {
  const [[x0, y0], [x1, y1]] = bbox
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1))
}

export function withinRadius(elements, centre, radius) {
  return elements.filter((e) => footprintDistance(e.bbox_m, centre) <= radius)
}

function isLifeSizeFloor(anchor) {
  return anchor.normal[2] > 0.9 && anchor.scale >= 0.999
}

/** Where Quick Look places the model: the first 1:1 floor anchor's spot, else the middle of the footprint. */
export function usdzCentre(anchors, elements) {
  const floor = anchors.find(isLifeSizeFloor)
  if (floor) return [floor.position_m[0], floor.position_m[1]]
  const xs = elements.flatMap((e) => [e.bbox_m[0][0], e.bbox_m[1][0]])
  const ys = elements.flatMap((e) => [e.bbox_m[0][1], e.bbox_m[1][1]])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** The files for a project: its centre, the variant radii written (1:1 floor projects only) and the full model's reach. */
export function usdzPlan(anchors, elements) {
  const centre = usdzCentre(anchors, elements)
  const reach = Math.max(0, ...elements.map((e) => footprintDistance(e.bbox_m, centre)))
  const radii = anchors.some(isLifeSizeFloor)
    ? USDZ_RADII.filter((r) => { const n = withinRadius(elements, centre, r).length; return n > 0 && n < elements.length })
    : []
  return { centre, radii, reach }
}

export function usdzFile(projectId, radius) {
  return radius === null ? `${projectId}.usdz` : `${projectId}-r${radius}.usdz`
}

/** The variant radius nearest the View distance setting (null = all), or null for the full model (counted at its reach). */
export function pickUsdzRadius(radiusM, plan) {
  if (radiusM === null) return null
  let best = null
  let bestGap = Math.abs(plan.reach - radiusM)
  for (const r of [...plan.radii].sort((a, b) => b - a)) { // larger first: a tie shows more, not less
    const gap = Math.abs(r - radiusM)
    if (gap < bestGap) [best, bestGap] = [r, gap]
  }
  return best
}
