import { useEffect, useMemo, useRef, useState } from 'react'
import { getProject } from '../api/client'
import type { Finding, ProjectManifest } from '../api/types'
import { loadLastCheck, type LastCheck } from '../check/lastCheck'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { disposePins, makePins } from '../scene/pins'
import { createViewer, type Viewer } from '../scene/viewer'
import { ElementPanel } from './ElementPanel'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'

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
  const [lastCheck, setLastCheck] = useState<LastCheck | null>(null)
  const [showCheck, setShowCheck] = useState(false)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let model: LoadedModel | null = null
    setError(null)
    ;(async () => {
      const project = await getProject(new URLSearchParams(window.location.search).get('project') || DEFAULT_PROJECT_ID)
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
    // Pins from this session's last as-built check (spec 4.1: findings pinned on the 3D model).
    const last = loadLastCheck(loaded.project.project_id)
    setLastCheck(last)
    const pins = last ? makePins(last.result.findings, new Map(loaded.project.elements.map((e) => [e.guid, e]))) : null
    if (pins) loaded.model.ifcRoot.add(pins)
    return () => {
      if (pins) disposePins(pins)
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
  const selectFinding = (f: Finding) => {
    setSelectedMark(f.mark)
    setSelected(f.guid)
  }

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
        {lastCheck && !showCheck && (
          <button type="button" className="btn btn-accent viewer-check-btn" onClick={() => setShowCheck(true)}>
            Last check results
          </button>
        )}
      </div>
      {lastCheck && showCheck && (
        <FindingsPanel result={lastCheck.result} selectedMark={selectedMark} onSelect={selectFinding} onDraftIssue={setDraftFor} onClose={() => setShowCheck(false)} />
      )}
      {notice && <p className="note viewer-notice" role="status">{notice}</p>}
      {draftFor && (
        <IssueDialog open projectId={loaded?.project.project_id ?? DEFAULT_PROJECT_ID} runId={lastCheck?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved. See it under Issues.') }} />
      )}
      {loaded && element && (
        <ElementPanel projectId={loaded.project.project_id} element={element} onClose={() => setSelected(null)} />
      )}
    </main>
  )
}
