import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getProject } from '../api/client'
import type { Finding, ProjectManifest } from '../api/types'
import { loadLastCheck, type LastCheck } from '../check/lastCheck'
import { freshCanvas, watchContextLoss } from '../scene/glContext'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { disposePins, makePins } from '../scene/pins'
import { paintOf } from '../scene/palette'
import { createViewer, type Viewer } from '../scene/viewer'
import { ElementPanel } from './ElementPanel'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { ReloadPrompt } from './ReloadPrompt'

export const DEFAULT_PROJECT_ID = 'room1'

type Loaded = { project: ProjectManifest; model: LoadedModel }

/** Model viewer (works everywhere): orbit the model, tap an element to see its properties. */
export function ViewerPage({ projectId = DEFAULT_PROJECT_ID }: { projectId?: string }) {
  // The viewer's canvas is made per viewer (freshCanvas): a released WebGL context can't be used again.
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const [glDead, setGlDead] = useState(false)
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
      const project = await getProject(projectId)
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
  }, [attempt, projectId])

  // A layout effect, so the viewer is disposed while its canvas is still in the document: OrbitControls removes
  // its keydown listener from the canvas's root node, and a detached canvas's root is itself (audit A-56).
  useLayoutEffect(() => {
    const host = canvasHostRef.current
    if (!loaded || !host) return
    const canvas = freshCanvas(host, 'viewer-canvas', `3D model: ${loaded.project.name}`)
    const rows = new Map(loaded.project.elements.map((e) => [e.guid, e]))
    const viewer = createViewer(canvas, loaded.model, (guid) => { const e = rows.get(guid); return e ? paintOf(e) : undefined })
    const stopWatch = watchContextLoss(canvas, () => setGlDead(true))
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
      stopWatch()
      viewer.dispose()
      canvas.remove()
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
        <div ref={canvasHostRef} />
        {!loaded && !error && <p className="status">Loading the model…</p>}
        {glDead && <ReloadPrompt />}
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
        <IssueDialog open projectId={loaded?.project.project_id ?? projectId} runId={lastCheck?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved. See it under Issues.') }} />
      )}
      {loaded && element && (
        <ElementPanel projectId={loaded.project.project_id} element={element} onClose={() => setSelected(null)} />
      )}
    </main>
  )
}
