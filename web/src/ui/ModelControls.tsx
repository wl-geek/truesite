import { useState } from 'react'
import { LAYERS, type ConstructionLook, type Layer } from '../scene/look'

export type ModelControlsProps = { look: ConstructionLook; maxHeightM: number; maxRadiusM?: number }

/**
 * Transparency, section height and layers: the controls field AR users expect.
 * They start from look.state(), so the panel shows the real view each time it mounts again.
 */
export function ModelControls({ look, maxHeightM, maxRadiusM = 30 }: ModelControlsProps) {
  const top = Math.ceil(maxHeightM * 10) / 10
  const far = Math.ceil(maxRadiusM)
  const [transparency, setTransparency] = useState(() => Math.round(look.state().transparency * 100))
  const [cut, setCut] = useState(() => look.state().sectionM ?? top)
  const [layers, setLayers] = useState<Record<Layer, boolean>>(() => look.state().layers)
  const [radius, setRadius] = useState(() => look.state().radiusM ?? far)

  return (
    <div className="model-controls">
      <label>
        <span>Transparency</span>
        <input type="range" min={0} max={100} value={transparency}
          onChange={(e) => { const v = Number(e.target.value); setTransparency(v); look.setTransparency(v / 100) }} />
      </label>
      <label>
        <span>Cut above {cut >= top ? 'off' : `${cut.toFixed(1)} m`}</span>
        <input type="range" min={0} max={top} step={0.1} value={cut}
          onChange={(e) => { const v = Number(e.target.value); setCut(v); look.setSection(v >= top ? null : v) }} />
      </label>
      <label>
        <span>View distance {radius >= far ? 'all' : `${radius} m`}</span>
        <input type="range" min={2} max={far} step={1} value={radius}
          onChange={(e) => { const v = Number(e.target.value); setRadius(v); look.setRadius(v >= far ? null : v) }} />
      </label>
      <div className="layer-chips" role="group" aria-label="Layers">
        {LAYERS.map((l) => (
          <button key={l.id} type="button" className={`chip${layers[l.id] ? ' chip-on' : ''}`} aria-pressed={layers[l.id]}
            onClick={() => { const on = !layers[l.id]; setLayers({ ...layers, [l.id]: on }); look.setLayerVisible(l.id, on) }}>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}
