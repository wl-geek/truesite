import { useEffect, useState } from 'react'
import { progressRows, type ProgressStep } from '../check/progress'
import './checkProgress.css'

/**
 * What a running check is doing, with a timer: a check takes 20 to 30 seconds, which looks frozen without it.
 * `startedAt` is the performance.now() of the tap. Screen readers hear each new step, not the timer.
 */
export function CheckProgress({ progress, startedAt }: { progress: ProgressStep; startedAt: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const rows = progressRows(progress)
  const current = rows.find((r) => r.state === 'now')
  return (
    <section className="check-progress" aria-label="Check progress">
      <p className="check-progress-head">
        <span>Checking as-built</span>
        <span className="check-progress-time" aria-hidden="true">{Math.max(0, Math.floor((now - startedAt) / 1000))} s</span>
      </p>
      <ol className="check-progress-steps">
        {rows.map((r) => (
          <li key={r.key} className={`check-progress-step is-${r.state}`}>
            <span className="check-progress-icon" aria-hidden="true" />
            <span>{r.label}{r.state !== 'next' && <span className="check-progress-sr">{r.state === 'done' ? ' (done)' : ' (in progress)'}</span>}</span>
          </li>
        ))}
      </ol>
      <p className="check-progress-hint">A check usually takes 20 to 30 seconds.</p>
      <p className="check-progress-sr" role="status">{current?.label}</p>
    </section>
  )
}
