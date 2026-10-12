import { useEffect, useMemo, useRef, useState } from 'react'
import { getProject } from '../api/client'
import type { ProjectManifest } from '../api/types'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { createViewer, type Viewer } from '../scene/viewer'
import { ElementPanel } from './ElementPanel'

export const DEFAULT_PROJECT_ID = 'room1'

type Loaded = { project: ProjectManifest; model: LoadedModel }

/** Model viewer (works everywhere): orbit the model, tap an element to see its properties. */
export function ViewerPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let model: LoadedModel | null = null
    setError(null)
    ;(async () => {
      const project = await getProject(DEFAULT_PROJECT_ID)
      model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
      if (cancelled) disposeModel(model)
      else setLoaded({ project, model })
    })().catch(() => {
      if (!cancelled) setError("Couldn't load the model. Check your connection and try again.")
    })
    return () => {
      cancelled = true
      if (model) disposeModel(model)
    }
  }, [attempt])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!loaded || !canvas) return
    const viewer = createViewer(canvas, loaded.model)
    viewerRef.current = viewer
    const off = viewer.onPick(setSelected)
    return () => {
      off()
      viewer.dispose()
      viewerRef.current = null
    }
  }, [loaded])

  useEffect(() => {
    viewerRef.current?.highlight(selected)
  }, [selected, loaded])

  const elements = useMemo(() => new Map((loaded?.project.elements ?? []).map((e) => [e.guid, e])), [loaded])
  const element = selected ? elements.get(selected) : undefined

  return (
    <main className="viewer-page">
      <div className="viewer-stage">
        <canvas ref={canvasRef} className="viewer-canvas" aria-label={loaded ? `3D model: ${loaded.project.name}` : '3D model'} />
        {!loaded && !error && <p className="status">Loading the model…</p>}
        {error && (
          <div className="status status-error" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
        {loaded && !element && <p className="hint">Tap an element to see its properties.</p>}
      </div>
      {loaded && element && (
        <ElementPanel projectId={loaded.project.project_id} element={element} onClose={() => setSelected(null)} />
      )}
    </main>
  )
}
