import { codeAt, SITE_VIEWPOINTS, type Viewpoint } from './siteViewpoints'
import './viewpointPlan.css'

/** Plan of the building with one viewpoint highlighted: the X where you stand and the arrow to the code. */
export function ViewpointPlan({ active }: { active: Viewpoint }) {
  const [cx, cy] = codeAt(active)
  const [sx, sy] = active.stand
  const cols = [0, 6, 12, 18].flatMap((x) => [0, 6, 12].map((y) => [x, y] as const))
  // Plan metres, y up: x -1.5..23.5, y -6.5..14 (flipped by the group transform).
  return (
    <svg className="vp-plan" viewBox="-1.5 -14 25 20.5" aria-hidden="true" focusable="false">
      <g transform="scale(1,-1)">
        <rect x="0" y="0" width="12" height="12" className="plan-cast" />
        <rect x="12" y="0" width="6" height="12" className="plan-open" />
        {cols.map(([x, y]) => <rect key={`${x}-${y}`} x={x - 0.35} y={y - 0.35} width="0.7" height="0.7" className="plan-col" />)}
        {SITE_VIEWPOINTS.filter((v) => v.id !== active.id).map((v) => (
          <circle key={v.id} cx={v.stand[0]} cy={v.stand[1]} r="0.45" className="plan-other" />
        ))}
        <path d={cone(active)} className="plan-cone" />
        <line x1={sx} y1={sy} x2={cx} y2={cy} className="plan-ray" />
        <line x1={cx - 0.8 * active.look[1]} y1={cy - 0.8 * active.look[0]} x2={cx + 0.8 * active.look[1]} y2={cy + 0.8 * active.look[0]}
          className="plan-code" />
        <path d={`M${sx - 1},${sy - 1}L${sx + 1},${sy + 1}M${sx - 1},${sy + 1}L${sx + 1},${sy - 1}`} className="plan-x" />
      </g>
    </svg>
  )
}

/** A 60° wedge, 9 m long, from the standing spot in the looking direction: roughly what the iPad sees. */
function cone(v: Viewpoint): string {
  const [sx, sy] = v.stand
  const [lx, ly] = v.look
  const len = 9
  const half = Math.PI / 6
  const ray = (a: number) => [sx + len * (lx * Math.cos(a) - ly * Math.sin(a)), sy + len * (lx * Math.sin(a) + ly * Math.cos(a))]
  const [ax, ay] = ray(half)
  const [bx, by] = ray(-half)
  return `M${sx},${sy}L${ax.toFixed(2)},${ay.toFixed(2)}L${bx.toFixed(2)},${by.toFixed(2)}Z`
}
