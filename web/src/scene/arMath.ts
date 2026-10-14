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

/** "Life size · 1:1" for scale 1, else "Scale model · 1:20" (scale 0.05). */
export function scaleLabel(anchor: ApiAnchor): string {
  return anchor.scale >= 0.999 ? 'Life size · 1:1' : `Scale model · 1:${Math.round(1 / anchor.scale)}`
}

export type CoachState = { tracking: boolean; provisional: boolean; distanceM: number | null }

/** One short instruction for what to do next in the live view. */
export function coachHint(s: CoachState | null, desk: boolean): string {
  if (!s?.tracking) return desk ? 'Point the camera at the QR code on the sheet.' : 'Point the camera at the QR code.'
  if (s.provisional) return 'Move within 1 m of the code, then step back slowly.'
  if (isFar(s.distanceM)) return 'Move closer to the code for a more accurate overlay.'
  return desk ? 'Walk around the sheet to look at the model. Keep the code in view.' : 'Aim at the area to check, then tap Check as-built.'
}
