/**
 * Look-around on the virtual site: you stand still and only turn. The view is a yaw (compass angle in the IFC
 * plan, radians, 0 = +X east, counter-clockwise) and a pitch (radians, up positive), with no roll.
 */
import type { Mat3, Vec3 } from '../pose'

export type LookAngles = { yaw: number; pitch: number }

export const PITCH_MIN = (-55 * Math.PI) / 180
export const PITCH_MAX = (80 * Math.PI) / 180

export function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, p))
}

/** Yaw of a horizontal plan direction. */
export function yawOf([x, y]: readonly [number, number]): number {
  return Math.atan2(y, x)
}

/** Unit view direction in IFC coordinates. */
export function forwardOf({ yaw, pitch }: LookAngles): Vec3 {
  return [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
}

/**
 * Dragging grabs the world: dragging right turns the view left, dragging down tilts it up, like a phone panorama.
 * `radPerPx` scales with the view so a drag across the screen turns about one field of view.
 */
export function dragLook(a: LookAngles, dxPx: number, dyPx: number, radPerPx: number): LookAngles {
  return { yaw: a.yaw + dxPx * radPerPx, pitch: clampPitch(a.pitch + dyPx * radPerPx) }
}

/**
 * Where the back camera points, from the device -> world rotation (scene/motion.ts deviceRotation, already corrected
 * for the screen angle): the device's -z axis. Returns the yaw in the sensors' own frame and the pitch.
 */
export function deviceLook(D: Mat3): LookAngles {
  const f: Vec3 = [-D[2], -D[5], -D[8]]
  return { yaw: Math.atan2(f[1], f[0]), pitch: clampPitch(Math.asin(Math.max(-1, Math.min(1, f[2])))) }
}

/** Wrap an angle to (-pi, pi]. */
export function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}
