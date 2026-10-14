import type { ApiError } from '../api/client'

/** What the user sees when a check cannot run or fails (spec section 8). */
export function checkErrorMessage(err: Pick<ApiError, 'status' | 'code' | 'retryAfterS'>): string {
  switch (err.code) {
    case 'nothing_visible':
      return 'None of the model is in view from here. Point the camera at the area you want to check.'
    case 'no_pose':
      return 'Keep the code in view when you take the photo.'
    case 'rate_limited': {
      const min = err.retryAfterS ? Math.max(1, Math.ceil(err.retryAfterS / 60)) : null
      return `Too many checks from this network. Try again${min ? ` in about ${min} min` : ' later'}.`
    }
    case 'daily_cap':
      return "Today's check limit has been reached. Try the sample photos, or come back tomorrow."
    case 'model_blocked':
      return "This photo couldn't be checked. Try a different view."
    default:
      return err.status === 0 ? 'No connection. Check your network and try again.' : 'Check failed — try again.'
  }
}
