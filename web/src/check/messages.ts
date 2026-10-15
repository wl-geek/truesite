import { ApiError } from '../api/client'

type ErrorInfo = Pick<ApiError, 'status' | 'code' | 'retryAfterS'>

/** Any thrown value as an ApiError: API errors as they are, anything else (canvas, WebGL, camera) as code "local". */
export function toCheckError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError(e instanceof Error ? e.message : String(e), 0, 'local')
}

function retryIn(err: ErrorInfo): string {
  const min = err.retryAfterS ? Math.max(1, Math.ceil(err.retryAfterS / 60)) : null
  return min ? ` in about ${min} min` : ' later'
}

/** What the user sees when a check cannot run or fails (spec section 8). */
export function checkErrorMessage(err: ErrorInfo): string {
  switch (err.code) {
    case 'nothing_visible':
      return 'None of the model is in view from here. Point the camera at the area you want to check.'
    case 'no_pose':
      return 'Keep the code in view when you take the photo.'
    case 'rate_limited':
      return `Too many checks from this network. Try again${retryIn(err)}.`
    case 'daily_cap':
      return "Today's check limit has been reached. Try the sample photos, or come back tomorrow."
    case 'model_blocked':
      return "This photo couldn't be checked. Try a different view."
    case 'network':
      return 'No connection. Check your network and try again.'
    case 'timeout':
      return 'The check took too long. Try again.'
    default:
      return 'Check failed — try again.'
  }
}

/** Sample photos: why the live check didn't run, shown above the saved result it falls back to (spec section 8). */
export function savedFallbackMessage(err: ErrorInfo): string {
  const showing = 'Showing the last real result for this photo.'
  switch (err.code) {
    case 'rate_limited':
      return `Too many checks from this network, so Gemini didn't run. ${showing} Try again${retryIn(err)}.`
    case 'daily_cap':
      return `Today's check limit has been reached, so Gemini didn't run. ${showing}`
    case 'network':
      return `No connection, so Gemini didn't run. ${showing}`
    case 'timeout':
      return `The check took too long. ${showing}`
    default:
      return err.status >= 500 ? `Gemini couldn't run the check right now. ${showing}` : `The live check didn't run. ${showing}`
  }
}
