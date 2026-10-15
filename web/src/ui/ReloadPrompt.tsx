import { CONTEXT_LOST_MESSAGE } from '../scene/glContext'

/** The WebGL context is gone for good (audit A-64): its canvas can't be reused, so offer a page reload. */
export function ReloadPrompt() {
  return (
    <div className="status status-error" role="alert">
      <p>{CONTEXT_LOST_MESSAGE}</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
