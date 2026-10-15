/**
 * Starting AR on Android (audit A-09): what Start AR (place by code) does when its session can't
 * start, and ending a session whose setup failed after it started, so the phone isn't left in AR.
 */

export type XrFallback = { kind: 'ignore' } | { kind: 'walk'; notice: string } | { kind: 'message'; message: string }

export const XR_WALK_NOTICE = "This phone can't read the code inside AR, so this model isn't lined up with the code."
export const XR_DESK_MESSAGE = "This phone can't read the code inside AR. Use Camera overlay for the desk model."
export const XR_FAILED_MESSAGE = "AR couldn't start on this phone. Use Camera overlay instead."

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string' ? err.name : ''
}

/** Classify a Start AR failure by its DOMException name. */
export function xrFallback(err: unknown, desk: boolean): XrFallback {
  const name = errorName(err)
  if (name === 'InvalidStateError') return { kind: 'ignore' } // a session is already starting or running (second tap)
  if (name === 'NotSupportedError' || name === 'NotAllowedError') {
    // No camera access inside AR. A life-size model can still be placed on the floor by tap, but not by the code;
    // a 1:20 desk model makes no sense at 1:1 on the floor.
    return desk ? { kind: 'message', message: XR_DESK_MESSAGE } : { kind: 'walk', notice: XR_WALK_NOTICE }
  }
  return { kind: 'message', message: XR_FAILED_MESSAGE }
}

/** Run the setup that follows requestSession; if it throws, end the session once and rethrow. */
export async function endOnFailure<T>(session: { end(): Promise<void> }, setup: () => Promise<T>): Promise<T> {
  try {
    return await setup()
  } catch (e) {
    await session.end().catch(() => undefined)
    throw e
  }
}
