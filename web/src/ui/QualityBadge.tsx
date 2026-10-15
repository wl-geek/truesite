import type { OverlayState } from '../scene/overlay'

const LABEL = { good: 'Good', fair: 'Fair', poor: 'Poor' } as const

/** Alignment quality and distance to the code (spec 4.1). Never "good" while the pose is provisional. */
export function QualityBadge({ state }: { state: OverlayState | null }) {
  if (state?.mode === 'motion') {
    return <p className="q-badge q-fair" role="status">Look-around · held by motion sensors</p>
  }
  if (!state?.tracking || !state.quality) {
    return <p className="q-badge q-none" role="status">No code in view</p>
  }
  return (
    <div className={`q-badge q-${state.quality}`} role="status">
      <span>Alignment: {LABEL[state.quality]}</span>
      {state.distanceM !== null && <span> · {state.distanceM.toFixed(1)} m</span>}
      {state.provisional && <span className="q-hint">Start within about 1 m of the code, then step back</span>}
    </div>
  )
}
