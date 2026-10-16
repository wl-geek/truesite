/**
 * Look-around mode: when the QR code leaves the view, hold the model in place with the phone's
 * motion sensors (rotation only). The camera position is frozen where the code was last seen,
 * so this is for turning on the spot and looking up, not for walking away.
 *
 * Frames: D = device -> world rotation from DeviceOrientationEvent (W3C: Rz(alpha) Rx(beta) Ry(gamma)),
 * corrected for screen orientation. C = CV camera <- device for the rear camera in portrait:
 * x right, y down (= -device y), z forward out of the back (= -device z). Pose (R, t) maps marker -> camera.
 *   At lock time:  R0, t0, D0.   marker -> world  R_wm = D0 C^T R0   (C is its own inverse)
 *   Now:           R  = C D^T D0 C R0,   t = -R c_m   with the frozen camera centre c_m = -R0^T t0.
 */
import { mat3Mul, mat3MulVec, transpose3, type Mat3, type Pose, type Vec3 } from '../pose'

export const C_FROM_DEVICE: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1]
/** After this long without the code, look-around stops (gyro drift) and the model hides. */
export const LOOK_AROUND_MAX_S = 90

const rad = Math.PI / 180

/** Device -> world rotation (row-major) from DeviceOrientationEvent angles and the screen angle (degrees). */
export function deviceRotation(alpha: number, beta: number, gamma: number, screenAngle = 0): Mat3 {
  const [a, b, g, s] = [alpha * rad, beta * rad, gamma * rad, -screenAngle * rad]
  const Rz: Mat3 = [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]
  const Rx: Mat3 = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)]
  const Ry: Mat3 = [Math.cos(g), 0, Math.sin(g), 0, 1, 0, -Math.sin(g), 0, Math.cos(g)]
  const Rs: Mat3 = [Math.cos(s), -Math.sin(s), 0, Math.sin(s), Math.cos(s), 0, 0, 0, 1]
  return mat3Mul(mat3Mul(mat3Mul(Rz, Rx), Ry), Rs)
}

export type MotionLock = { R0: Mat3; t0: Vec3; D0: Mat3; tSec: number }

/** Marker -> camera pose now, from the pose and device rotation at lock time and the device rotation now. */
export function lookAroundPose(lock: MotionLock, D: Mat3): Pose {
  const C = C_FROM_DEVICE
  const R = mat3Mul(mat3Mul(mat3Mul(mat3Mul(C, transpose3(D)), lock.D0), C), lock.R0)
  const cm = mat3MulVec(transpose3(lock.R0), lock.t0).map((v) => -v) as Vec3
  const t = mat3MulVec(R, cm).map((v) => -v) as Vec3
  return { R, t }
}

/** Motion sensors for look-around. iOS needs an explicit permission from a tap; others just work. */
export async function requestMotionPermission(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
  if (!DOE) return false
  if (typeof DOE.requestPermission !== 'function') return true
  try {
    return (await DOE.requestPermission()) === 'granted'
  } catch {
    return false
  }
}
