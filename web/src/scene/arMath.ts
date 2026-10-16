// Pure helpers for the live overlay (no DOM, no three.js), unit-tested.
import type { Anchor as ApiAnchor, ProjectManifest } from '../api/types'
import type { Anchor as PoseAnchor, Point2 } from '../pose'
import type { Point } from '../qr/protocol'

/** Beyond this distance the overlay is still drawn but flagged as less accurate (spec 4.2 step 3). */
export const FAR_WARNING_M = 3

/** Detector corners are in the pixels of the downscaled frame; the pose needs video pixels. */
export function toVideoPixels(corners: readonly Point[], frameW: number, frameH: number, videoW: number, videoH: number): Point2[] {
  const sx = videoW / frameW
  const sy = videoH / frameH
  return corners.map((p) => [p.x * sx, p.y * sy] as Point2)
}

/** Printed size of the code, corrected by the check-bar step (multiplier, 1 when unknown). */
export function effectiveQrSize(anchor: ApiAnchor, correction: number): number {
  return anchor.qr_size_m * correction
}

export function poseAnchor(anchor: ApiAnchor): PoseAnchor {
  return { position_m: anchor.position_m, normal: anchor.normal, up: anchor.up, scale: anchor.scale }
}

export function findAnchor(project: ProjectManifest, anchorId: string): ApiAnchor | null {
  return project.anchors.find((a) => a.anchor_id === anchorId) ?? null
}

export function isFar(distanceM: number | null): boolean {
  return distanceM !== null && distanceM > FAR_WARNING_M
}

export function isDeskAnchor(anchor: ApiAnchor): boolean {
  return anchor.scale < 1
}

/** A code lying flat on the floor with the model at 1:1 around it (L1, R1, S1, ...). */
export function isLifeSizeFloor(anchor: ApiAnchor): boolean {
  return anchor.normal[2] > 0.9 && anchor.scale >= 0.999
}

/**
 * iPhone/iPad (AR Quick Look, no WebXR) on a 1:1 floor code: Walk inside is the main action, because Quick Look
 * tracks the world while you walk. The camera overlay stays as the second button; Android keeps Start AR first.
 */
export function walkInsideFirst(anchor: ApiAnchor, device: { quickLook: boolean; xrOk: boolean }): boolean {
  return device.quickLook && !device.xrOk && isLifeSizeFloor(anchor)
}

/** "Life size · 1:1" for scale 1, else "Scale model · 1:20" (scale 0.05). */
export function scaleLabel(anchor: ApiAnchor): string {
  return anchor.scale >= 0.999 ? 'Life size · 1:1' : `Scale model · 1:${Math.round(1 / anchor.scale)}`
}

/** No code for this long: the coach switches to tips (spec section 8). */
export const SEARCH_TIPS_AFTER_S = 5

/** Seconds spent looking for the code: since it was last seen, or since tracking (re)started, whichever is later. */
export function searchingSeconds(tSec: number, lastSeenSec: number, startedSec: number): number {
  return tSec - Math.max(lastSeenSec, startedSec)
}

export type CoachState = { tracking: boolean; provisional: boolean; distanceM: number | null; mode?: 'code' | 'motion' | 'lost'; searchingS?: number }

/** One short instruction for what to do next in the live view. `checkEnabled` false: this sheet can't be checked. */
export function coachHint(s: CoachState | null, desk: boolean, checkEnabled = true): string {
  if (s?.mode === 'motion') return 'Look around and up. Turn on the spot; point back at the code to re-align.'
  if (!s?.tracking) {
    if ((s?.searchingS ?? 0) >= SEARCH_TIPS_AFTER_S) return "Can't find the code. Add more light, move within about 1 m and hold the phone steady."
    return desk ? 'Point the camera at the QR code on the sheet.' : 'Point the camera at the QR code.'
  }
  if (s.provisional) return 'Move within about 1 m of the code, then step back slowly.'
  if (isFar(s.distanceM)) return 'Move closer to the code for a more accurate overlay.'
  if (desk) return 'Walk around the sheet to look at the model. Keep the code in view.'
  return checkEnabled ? 'Aim at the area to check, then tap Check as-built.'
    : 'Turn slowly on the spot and look up; point back at the code to re-align.'
}

export type CheckAvailability = { enabled: boolean; note: string | null }

/**
 * Demo sheets that put the model where nothing is built. D1 (desk sheet) shows the room beside a sheet of
 * paper, so a check would report every element missing; D2 is for our physical 1:20 model and stays checkable.
 * L1 (floor sheet) is life size: only the part of the demo room that stands around it can be checked.
 */
const DEMO_SHEETS: Record<string, CheckAvailability> = {
  'room1/D1': { enabled: false, note: 'Checks need the real site or our 1:20 model. Try the sample photos.' },
  'room1/L1': { enabled: true, note: 'Away from the demo room, elements will read as missing.' },
}
// The building site sheets show the design in an empty car park: nothing is built there to check.
for (const id of ['P1', 'P2', 'P3', 'P4', 'D1']) {
  DEMO_SHEETS[`site/${id}`] = { enabled: false, note: 'This sheet shows the design where nothing is built yet, so there is nothing to check. Try the sample photos.' }
}

export function checkAvailability(anchor: ApiAnchor): CheckAvailability {
  return DEMO_SHEETS[`${anchor.project_id}/${anchor.anchor_id}`] ?? { enabled: true, note: null }
}
