import { ApiError } from '../api/client'

/** Shown when the QR's project exists but has no anchor with the QR's id. */
export const UNKNOWN_ANCHOR_MESSAGE = "This QR code isn't set up for this project."

/** The server doesn't know the QR's project (404 unknown_project), e.g. a mistyped or outdated sheet. */
export function isUnknownProject(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'unknown_project'
}

/** What the live page says when the project or its anchor can't be loaded. */
export function liveLoadErrorMessage(err: unknown): string {
  if (isUnknownProject(err)) return "This QR code points to a project TrueSite doesn't have. The sheet may be out of date."
  if (err instanceof Error && err.message === UNKNOWN_ANCHOR_MESSAGE) return UNKNOWN_ANCHOR_MESSAGE
  return "Couldn't load the project. Check your connection and try again."
}
