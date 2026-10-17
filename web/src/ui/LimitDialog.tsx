import { useEffect, useRef, useState } from 'react'
import { formatWait, onUsageLimit, type LimitCode, type UsageLimit } from '../api/limits'
import { navigate } from '../router'
import './limitDialog.css'

const COPY: Record<LimitCode, { title: string; body: string; wait: string }> = {
  daily_cap: {
    title: "Today's free Gemini use is used up",
    body: 'This demo runs on Google Cloud free-trial credits, so it caps its Gemini checks each day. This is that limit, not an error in TrueSite.',
    wait: 'Gemini is back in',
  },
  rate_limited: {
    title: 'This network has used its Gemini checks for now',
    body: "Each network can run a limited number of Gemini checks an hour, so one visitor can't use up the demo's free credits. This is that limit, not an error in TrueSite.",
    wait: 'Gemini is back for this network in',
  },
  model_quota: {
    title: "Gemini's usage limit is reached",
    body: "Google limits how many Gemini requests this project can make in a short time. This is Google's limit, not an error in TrueSite.",
    wait: 'Try again in',
  },
}

/**
 * Shown over any page when a Gemini call is refused for a usage limit (api/limits.ts), with a countdown to when Gemini
 * works again. Everything without Gemini keeps working, and the ready-made views keep their saved results.
 */
export function LimitDialog() {
  const [limit, setLimit] = useState<UsageLimit | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => onUsageLimit((next) => {
    setNow(Date.now())
    setLimit((cur) => (cur && cur.code === next.code ? { ...next, untilMs: Math.max(cur.untilMs, next.untilMs) } : next))
  }), [])
  const open = limit !== null
  useEffect(() => {
    if (!open) return
    primary.current?.focus()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLimit(null)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(tick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!limit) return null
  const copy = COPY[limit.code]
  const left = limit.untilMs - now
  const done = left <= 0
  const close = () => setLimit(null)
  const at = new Date(limit.untilMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const onReadyMade = window.location.pathname === '/samples' && new URLSearchParams(window.location.search).has('photos')
  return (
    <div className="ld-backdrop" onClick={close}>
      <div className="ld" role="dialog" aria-modal="true" aria-labelledby="ld-title" onClick={(e) => e.stopPropagation()}>
        <p className="ld-kicker">Usage limit · not an error</p>
        <h2 id="ld-title">{done ? 'Gemini is available again' : copy.title}</h2>
        <p>{copy.body}</p>
        {done ? (
          <p className="ld-ready">Close this and try again.</p>
        ) : (
          <div className="ld-timer" role="timer" aria-live="off">
            <span>{copy.wait}</span>
            <strong>{formatWait(left)}</strong>
            {limit.code !== 'model_quota' && <span className="ld-at">at {at} your time</span>}
          </div>
        )}
        <p className="ld-note">
          Meanwhile, everything without Gemini still works: the live AR view, the 3D model, and the saved results in the
          ready-made views.
        </p>
        <div className="ld-actions">
          {!onReadyMade && (
            <button type="button" className="btn" onClick={() => { close(); navigate('/samples?photos') }}>Open the ready-made views</button>
          )}
          <button type="button" className="btn btn-accent" onClick={close} ref={primary}>Close</button>
        </div>
      </div>
    </div>
  )
}
