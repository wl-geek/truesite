import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getProject } from '../api/client'
import type { Finding, ProjectManifest } from '../api/types'
import { loadLastCheck, type LastCheck } from '../check/lastCheck'
import { freshCanvas, watchContextLoss } from '../scene/glContext'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { disposePins, makePins } from '../scene/pins'
import { KIND_COLOURS, paintOf, type Kind } from '../scene/palette'
import { createViewer, NO_INSET, type Viewer, type ViewPreset } from '../scene/viewer'
import { navigate, viewerPathFor } from '../router'
import { typeLabel } from './elementFacts'
import { modelFacts, VIEWER_PROJECTS } from './viewerFacts'
import { ElementPanel } from './ElementPanel'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { Link } from './Link'
import { isUnknownProject } from './liveFormat'
import { goToSection } from './TopBar'
import { ReloadPrompt } from './ReloadPrompt'
import './viewerChrome.css'

export const DEFAULT_PROJECT_ID = 'site'
const NOTICE_MS = 8000
/** From this width the check results dock on the left of the model and the element details on the right. */
const WIDE = '(min-width: 900px)'
/** The free middle is narrower than this: the view tools show icons only. */
const TIGHT_PX = 560

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const change = () => setOn(m.matches)
    change()
    m.addEventListener('change', change)
    return () => m.removeEventListener('change', change)
  }, [query])
  return on
}

type Loaded = { project: ProjectManifest; model: LoadedModel }
type LoadError = { message: string; unknownProject: boolean }

/** Why the model didn't load: a project that doesn't exist is a bad link, not a bad connection (audit C-34). */
export function viewerLoadError(err: unknown): LoadError {
  return isUnknownProject(err)
    ? { message: "This link points to a project TrueSite doesn't have.", unknownProject: true }
    : { message: "Couldn't load the model. Check your connection and try again.", unknownProject: false }
}

/** Model viewer (works everywhere): orbit the model, tap an element to see its properties. */
export function ViewerPage({ projectId = DEFAULT_PROJECT_ID }: { projectId?: string }) {
  // The viewer's canvas is made per viewer (freshCanvas): a released WebGL context can't be used again.
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const wide = useMedia(WIDE)
  const viewerRef = useRef<Viewer | null>(null)
  const [glDead, setGlDead] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState<LastCheck | null>(null)
  const [showCheck, setShowCheck] = useState(false)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<Kind>>(new Set())
  const [view, setView] = useState<ViewPreset>('iso')
  const [xray, setXray] = useState(false)
  const [hover, setHover] = useState<{ name: string; type: string; x: number; y: number } | null>(null)
  /** Pixels the docked panels cover on the left (check results) and right (element details) of the stage. */
  const [docks, setDocks] = useState({ left: 0, right: 0, tight: false })

  useEffect(() => {
    let cancelled = false
    let model: LoadedModel | null = null
    setError(null)
    ;(async () => {
      const project = await getProject(projectId)
      model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
      if (cancelled) disposeModel(model)
      else setLoaded({ project, model })
    })().catch((e: unknown) => {
      if (!cancelled) setError(viewerLoadError(e))
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
    const offHover = viewer.onHover((guid, x, y) => {
      const e = guid ? rows.get(guid) : undefined
      setHover(e ? { name: e.name || 'Unnamed element', type: typeLabel(e), x, y } : null)
    })
    // Pins from this session's last as-built check (spec 4.1: findings pinned on the 3D model).
    const last = loadLastCheck(loaded.project.project_id)
    setLastCheck(last)
    const pins = last ? makePins(last.result.findings, rows, { dim: last.result.image_quality !== 'good' }) : null
    if (pins) loaded.model.ifcRoot.add(pins)
    return () => {
      if (pins) disposePins(pins)
      off()
      offHover()
      stopWatch()
      viewer.dispose()
      canvas.remove()
      viewerRef.current = null
    }
  }, [loaded])

  useEffect(() => {
    viewerRef.current?.highlight(selected)
  }, [selected, loaded])
  useEffect(() => { viewerRef.current?.setHiddenKinds(hiddenKinds) }, [hiddenKinds, loaded])
  useEffect(() => { viewerRef.current?.setXray(xray) }, [xray, loaded, selected])
  // Escape closes the element details.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])
  // Wide screens: the check results dock on the left, the element details on the right; phones: the element details are
  // a bottom sheet. Centre the view in what's left, and keep the tools and buttons in that free middle.
  const docked = wide && showCheck && lastCheck !== null
  useEffect(() => {
    const viewer = viewerRef.current
    const stage = stageRef.current
    if (!viewer || !stage) return
    const measure = () => {
      const panel = stage.querySelector<HTMLElement>(':scope > .element-panel')
      const results = stage.querySelector<HTMLElement>(':scope > .findings-panel')
      const edge = (el: HTMLElement | null) => (el ? el.offsetWidth + 24 : 0)
      const left = wide ? edge(results) : 0
      const right = wide ? edge(panel) : 0
      viewer.setInset({ left, right, bottom: !wide && panel ? panel.offsetHeight : 0 })
      const tight = stage.clientWidth - left - right < TIGHT_PX
      setDocks((d) => (d.left === left && d.right === right && d.tight === tight ? d : { left, right, tight }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    for (const el of stage.querySelectorAll<HTMLElement>(':scope > .element-panel, :scope > .findings-panel')) ro.observe(el)
    return () => { ro.disconnect(); viewer.setInset(NO_INSET) }
  }, [selected, loaded, wide, docked])
  const toggleKind = (k: Kind) => setHiddenKinds((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const changeView = (v: ViewPreset) => { setView(v); viewerRef.current?.setView(v) }

  // "Issue saved." floats over the screen (it would sit under the findings list), so it goes after a few seconds.
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  const elements = useMemo(() => new Map((loaded?.project.elements ?? []).map((e) => [e.guid, e])), [loaded])
  const element = selected ? elements.get(selected) : undefined
  const selectFinding = (f: Finding) => {
    setSelectedMark(f.mark)
    setSelected(f.guid)
    // Phones and narrow tablets: the results are under the model, so bring the model (and the element) into view.
    if (!wide) stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const openResults = () => {
    setShowCheck(true)
    if (!wide) requestAnimationFrame(() => document.querySelector('.viewer-page > .findings-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const findings = lastCheck && showCheck && (
    <FindingsPanel result={lastCheck.result} selectedMark={selectedMark} onSelect={selectFinding} onDraftIssue={setDraftFor} onClose={() => setShowCheck(false)} />
  )
  const stageStyle = { '--dock-l': `${docks.left}px`, '--dock-r': `${docks.right}px` } as CSSProperties

  return (
    <main className="viewer-page">
      <div ref={stageRef} className={`viewer-stage${docks.tight ? ' viewer-tight' : ''}`} style={stageStyle}>
        <div ref={canvasHostRef} />
        {!loaded && !error && <p className="status">Loading the model…</p>}
        {glDead && <ReloadPrompt />}
        {error && (
          <div className="status status-error" role="alert">
            <p>{error.message}</p>
            {error.unknownProject ? (
              <Link to="/model" className="btn">Open the site model</Link>
            ) : (
              <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            )}
          </div>
        )}
        {/* Wide screens with the results open: the results take the card's place (closing them brings it back). */}
        {loaded && !docked && <ModelCard project={loaded.project} hidden={hiddenKinds} onToggle={toggleKind} />}
        {loaded && (
          <div className="viewer-tools" role="toolbar" aria-label="View">
            <button type="button" className="vt-btn" onClick={() => changeView(view)} title="Show the whole model">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>Reset view
            </button>
            <button type="button" className="vt-btn" aria-pressed={view === 'top'} onClick={() => changeView(view === 'top' ? 'iso' : 'top')}
              title={view === 'top' ? 'Back to the 3D view' : 'Look straight down on the plan'}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 12h16M12 4v16" /></svg>{view === 'top' ? 'Show 3D' : 'Show plan'}
            </button>
            <button type="button" className="vt-btn" aria-pressed={xray} onClick={() => setXray((x) => !x)} title="See through the model">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5" /></svg>X-ray
            </button>
          </div>
        )}
        {hover && !element && (
          <p className="viewer-hover" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden="true">
            <strong>{hover.name}</strong>{hover.type}
          </p>
        )}
        {loaded && !element && <p className="hint">Drag to orbit · scroll or pinch to zoom · tap an element for its details</p>}
        {loaded && !lastCheck && loaded.project.project_id === 'site' && (
          <a href="/#live" className="btn btn-accent viewer-check-btn" onClick={(e) => { e.preventDefault(); goToSection('live') }}>See it live in AR</a>
        )}
        {lastCheck && !showCheck && (
          <button type="button" className="btn btn-accent viewer-check-btn" onClick={openResults}>
            Last check results
          </button>
        )}
        {/* In the stage, not over the page: the findings list (docked left, or under the stage on narrow screens)
            and its Draft issue buttons stay free (audit C-06). */}
        {docked && findings}
        {loaded && element && (
          <ElementPanel projectId={loaded.project.project_id} element={element} multiStorey={modelFacts(loaded.project).storeys > 1}
            onClose={() => setSelected(null)} onZoom={() => viewerRef.current?.focus(element.guid)} />
        )}
        {notice && <p className="viewer-notice" role="status">{notice}</p>}
      </div>
      {!docked && findings}
      {draftFor && (
        <IssueDialog open projectId={loaded?.project.project_id ?? projectId} runId={lastCheck?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved.') }} />
      )}
    </main>
  )
}

const KIND_LABELS: Record<Kind, string> = {
  column: 'Column', beam: 'Beam', truss: 'Truss', purlin: 'Purlin', brace: 'Brace', concrete: 'Concrete', rebar: 'Rebar',
  opening: 'Opening', other: 'Other',
}

/**
 * Which model, its size and materials at a glance, and the colour key: tap a type to hide or show it. On phones the
 * card folds to its title, so the model has the screen.
 */
function ModelCard({ project, hidden, onToggle }: { project: ProjectManifest; hidden: ReadonlySet<Kind>; onToggle: (k: Kind) => void }) {
  const counts = useMemo(() => {
    const n = new Map<Kind, number>()
    for (const e of project.elements) n.set(paintOf(e).kind, (n.get(paintOf(e).kind) ?? 0) + 1)
    return n
  }, [project])
  const kinds = (Object.keys(KIND_LABELS) as Kind[]).filter((k) => counts.has(k))
  const facts = useMemo(() => modelFacts(project), [project])
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 720px)').matches)
  return (
    <div className={`model-card${open ? '' : ' model-card-folded'}`}>
      <div className="model-card-top">
        <label className="model-switch">
          <span className="sr-only">Model</span>
          <select value={project.project_id} onChange={(e) => navigate(viewerPathFor(e.target.value))}>
            {VIEWER_PROJECTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="button" className="model-card-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Fold the model card' : 'Show the model card'}>{open ? '–' : '+'}</button>
      </div>
      {open && (
        <>
          <p className="model-card-meta">{facts.size} · {project.elements.length} elements</p>
          {facts.materials.length > 0 && <p className="model-card-meta">{facts.materials.join(' · ')}</p>}
          <p className="model-legend-title">Colour key · tap to hide or show</p>
          <ul className="model-legend" aria-label="Colour key">
            {kinds.map((k) => (
              <li key={k}>
                <button type="button" className="legend-btn" aria-pressed={!hidden.has(k)} onClick={() => onToggle(k)}
                  title={`${hidden.has(k) ? 'Show' : 'Hide'} ${KIND_LABELS[k].toLowerCase()} (${counts.get(k)})`}>
                  <span className="swatch" style={{ background: `#${KIND_COLOURS[k].toString(16).padStart(6, '0')}` }} />
                  {KIND_LABELS[k]} <span className="legend-n">{counts.get(k)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
