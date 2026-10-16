import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping, HemisphereLight, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer, type Group,
} from 'three'
import { ApiError, getProject } from '../api/client'
import type { Anchor, CheckResult, Element, Finding } from '../api/types'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage } from '../check/messages'
import { runCheck, storedRunId } from '../check/runCheck'
import { releaseRenderer } from '../scene/glContext'
import { disposeModel, parseModel, type LoadedModel } from '../scene/loadModel'
import { deviceRotation, requestMotionPermission } from '../scene/motion'
import { paintOf } from '../scene/palette'
import { disposePins, makePins } from '../scene/pins'
import { applyTypeColours } from '../scene/viewer'
import { describeDeviation, SITE_AS_BUILT } from '../sim/asBuilt'
import { deviceLook, dragLook, forwardOf, type LookAngles, yawOf } from '../sim/lookAngles'
import { samplePose } from '../sim/samplePose'
import { markFindings } from '../sim/findings3d'
import { scoreCheck, scoreLine, type Score } from '../sim/score'
import { buildWorld, makeAsBuilt, photoFinish, rng } from '../sim/world'
import { EvidenceView } from './EvidenceView'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { ReportDialog } from './ReportDialog'
import { Link } from './Link'
import { SITE_VIEWPOINTS } from './siteViewpoints'
import './virtualSite.css'

const PROJECT_ID = 'site'
const EYE_HEIGHT_M = 1.5 // the iPad's camera, held upright at chest height
const HALF_FOV_SHORT_DEG = 25 // half the field of view across the screen's short side
const SNAPSHOT_LONG_PX = 1280

type World = {
  renderer: WebGLRenderer; camera: PerspectiveCamera; world: Scene; overlay: Scene
  asBuilt: LoadedModel; design: LoadedModel; check: { model: LoadedModel; scene: Scene; renderer: WebGLRenderer }
  anchor: Anchor; eye: [number, number, number]; elements: Map<string, Element>; restoreColours: () => void
}
type Outcome = { result: CheckResult; photoUrl: string; renderUrl: string | null; runId: string | null; latencyMs: number; score: Score }

/**
 * The virtual site: stand on a viewpoint's X inside the simulated as-built building and turn on the spot.
 * Check as-built takes what you see as the site photo and runs the real check against the BIM design.
 */
export function VirtualSite({ viewpointId, onExit }: { viewpointId: string; onExit: () => void }) {
  const vp = SITE_VIEWPOINTS.find((v) => v.id === viewpointId) ?? SITE_VIEWPOINTS[0]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const anglesRef = useRef<LookAngles>({ yaw: yawOf(vp.look), pitch: (vp.startPitchDeg * Math.PI) / 180 })
  const dirty = useRef(true)
  const showDesignRef = useRef(false)
  const pinsRef = useRef<Group | null>(null)
  const unmarkRef = useRef<(() => void) | null>(null)
  const motionRef = useRef<{ offset: number; last: LookAngles | null } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [showDesign, setShowDesign] = useState(false)
  const [motionOn, setMotionOn] = useState(false)
  const [coach, setCoach] = useState(true)
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  const [runIds, setRunIds] = useState<string[]>([]) // this visit's stored checks, for the site report
  const [reportOpen, setReportOpen] = useState(false)
  const touch = useMemo(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && navigator.maxTouchPoints > 0, [])

  // Build the world once: the as-built model in the simulated site, the design for the overlay, and a third copy
  // off screen for the check's design render (each three.js object can only sit in one scene).
  useEffect(() => {
    let cancelled = false
    let raf = 0
    const canvas = canvasRef.current!
    const setup = async () => {
      const project = await getProject(PROJECT_ID)
      const anchor = project.anchors.find((a) => a.anchor_id === vp.id)
      if (!anchor) throw new Error(`This viewpoint (${vp.id}) is missing from the project.`)
      const res = await fetch(project.model_url)
      if (!res.ok) throw new Error(`Couldn't load the model (HTTP ${res.status})`)
      const data = await res.arrayBuffer()
      const guids = new Set(project.elements.map((e) => e.guid))
      const [asBuilt, design, checkModel] = await Promise.all([0, 1, 2].map(() => parseModel(data.slice(0), guids)))
      if (cancelled) return [asBuilt, design, checkModel].forEach(disposeModel)
      const elements = new Map(project.elements.map((e) => [e.guid, e]))

      makeAsBuilt(asBuilt, project.elements, SITE_AS_BUILT)
      const world = buildWorld(PROJECT_ID, project.anchors)
      world.add(asBuilt.ifcRoot)
      const overlay = new Scene()
      overlay.add(new HemisphereLight(0xffffff, 0x8899aa, 2.4))
      overlay.add(design.ifcRoot)
      const restoreColours = applyTypeColours(design, (g) => { const e = elements.get(g); return e ? paintOf(e) : undefined })
      design.meshes.forEach((m) => {
        const mat = m.material as MeshStandardMaterial
        Object.assign(mat, { transparent: true, opacity: Math.min(mat.opacity, 0.55), depthWrite: false })
      })

      const renderer = new WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFShadowMap
      renderer.autoClear = false
      const camera = new PerspectiveCamera(50, 1, 0.1, 600)
      camera.up.set(0, 0, 1)
      const eye: [number, number, number] = [vp.stand[0], vp.stand[1], EYE_HEIGHT_M]
      camera.position.set(...eye)
      const checkScene = new Scene()
      checkScene.add(checkModel.ifcRoot)
      const checkRenderer = new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false })
      worldRef.current = {
        renderer, camera, world, overlay, asBuilt, design, check: { model: checkModel, scene: checkScene, renderer: checkRenderer },
        anchor, eye, elements, restoreColours,
      }
      setStatus('ready')
      canvas.focus({ preventScroll: true }) // arrow keys work straight away on a laptop
      const loop = () => {
        raf = requestAnimationFrame(loop)
        if (dirty.current) {
          dirty.current = false
          draw()
        }
      }
      loop()
    }
    setup().catch((e: unknown) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      const w = worldRef.current
      worldRef.current = null
      if (!w) return
      if (pinsRef.current) disposePins(pinsRef.current)
      unmarkRef.current?.()
      w.restoreColours()
      ;[w.asBuilt, w.design, w.check.model].forEach(disposeModel)
      w.renderer.dispose()
      releaseRenderer(w.check.renderer)
    }
  }, [vp.id])

  /** Size the camera to the canvas: a fixed field of view across the short side, so phones and iPads see alike. */
  const fit = useCallback((w: World, cssW: number, cssH: number) => {
    const f = Math.min(cssW, cssH) / 2 / Math.tan((HALF_FOV_SHORT_DEG * Math.PI) / 180)
    w.camera.fov = (2 * Math.atan(cssH / 2 / f) * 180) / Math.PI
    w.camera.aspect = cssW / cssH
    w.camera.updateProjectionMatrix()
  }, [])

  function aim(w: World): void {
    const [fx, fy, fz] = forwardOf(anglesRef.current)
    w.camera.lookAt(w.eye[0] + fx, w.eye[1] + fy, w.eye[2] + fz)
  }

  function draw(): void {
    const w = worldRef.current
    const canvas = canvasRef.current
    if (!w || !canvas) return
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (!cssW || !cssH) return
    const size = w.renderer.getSize(new Vector2())
    if (size.x !== cssW || size.y !== cssH) w.renderer.setSize(cssW, cssH, false)
    fit(w, cssW, cssH)
    aim(w)
    w.renderer.clear()
    w.renderer.render(w.world, w.camera)
    if (showDesignRef.current) {
      w.renderer.clearDepth() // like AR: the design is drawn over the "camera image"
      w.renderer.render(w.overlay, w.camera)
    }
  }

  // Redraw on resize.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => (dirty.current = true))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Drag to look around (the world follows the finger), arrow keys too.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let last: { x: number; y: number } | null = null
    let pressed: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY }
      pressed = { x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
      setCoach(false)
    }
    const move = (e: PointerEvent) => {
      if (!last || !worldRef.current) return
      const radPerPx = (worldRef.current.camera.fov * Math.PI) / 180 / Math.max(1, canvas.clientHeight)
      const before = anglesRef.current
      anglesRef.current = dragLook(before, e.clientX - last.x, e.clientY - last.y, radPerPx)
      if (motionRef.current) motionRef.current.offset += anglesRef.current.yaw - before.yaw
      last = { x: e.clientX, y: e.clientY }
      dirty.current = true
    }
    const up = (e: PointerEvent) => {
      last = null
      const w = worldRef.current
      const pins = pinsRef.current
      if (!pressed || !w || !pins || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) return
      const r = canvas.getBoundingClientRect()
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), w.camera)
      const hit = ray.intersectObjects(pins.children, false)[0]
      const mark = hit?.object.userData.mark as number | undefined
      if (mark !== undefined) {
        setSelectedMark(mark)
        setResultsOpen(true)
      }
    }
    const key = (e: KeyboardEvent) => {
      const step = (5 * Math.PI) / 180
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
      if (!d) return
      e.preventDefault()
      anglesRef.current = dragLook(anglesRef.current, d[0], d[1], 1)
      dirty.current = true
      setCoach(false)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('keydown', key)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('keydown', key)
    }
  }, [])

  // Turn with the device: the back camera's direction drives the view, offset so the view doesn't jump.
  useEffect(() => {
    if (!motionOn) {
      motionRef.current = null
      return
    }
    motionRef.current = { offset: 0, last: null }
    const onOrientation = (e: DeviceOrientationEvent) => {
      const m = motionRef.current
      if (!m || e.alpha === null || e.beta === null || e.gamma === null) return
      const dev = deviceLook(deviceRotation(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? 0))
      if (!m.last) m.offset = anglesRef.current.yaw - dev.yaw
      m.last = dev
      anglesRef.current = { yaw: dev.yaw + m.offset, pitch: dev.pitch }
      dirty.current = true
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => window.removeEventListener('deviceorientation', onOrientation)
  }, [motionOn])

  async function toggleMotion(): Promise<void> {
    if (motionOn) return setMotionOn(false)
    if (await requestMotionPermission()) {
      setMotionOn(true)
      setCoach(false)
    } else setNotice('Motion access was not allowed: drag to look around instead.')
  }

  function toggleDesign(): void {
    showDesignRef.current = !showDesignRef.current
    setShowDesign(showDesignRef.current)
    dirty.current = true
  }

  /** The view as a site photo (no overlay, no pins), at about 1280 px, with the matching camera and pose. */
  async function snapshot(w: World) {
    const canvas = canvasRef.current!
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    const sw = cssW >= cssH ? SNAPSHOT_LONG_PX : Math.round((SNAPSHOT_LONG_PX * cssW) / cssH)
    const sh = cssW >= cssH ? Math.round((SNAPSHOT_LONG_PX * cssH) / cssW) : SNAPSHOT_LONG_PX
    const dpr = w.renderer.getPixelRatio()
    const pins = pinsRef.current
    if (pins) pins.visible = false
    w.renderer.setPixelRatio(1)
    w.renderer.setSize(sw, sh, false)
    fit(w, sw, sh)
    aim(w)
    w.renderer.clear()
    w.renderer.render(w.world, w.camera)
    const photo = photoFinish(w.renderer.domElement, sw, sh, rng(`${vp.id}-${Date.now()}`)) // reads the frame right away
    const f = sh / 2 / Math.tan((w.camera.fov * Math.PI) / 360)
    const { yaw, pitch } = anglesRef.current
    const pose = samplePose(w.anchor, w.eye, [Math.cos(yaw), Math.sin(yaw)], (pitch * 180) / Math.PI)
    w.renderer.setPixelRatio(dpr)
    if (pins) pins.visible = true
    dirty.current = true
    return { photo: await photo, sw, sh, K: { f, cx: sw / 2, cy: sh / 2 }, pose }
  }

  async function check(): Promise<void> {
    const w = worldRef.current
    if (!w || checking) return
    setChecking(true)
    setNotice(null)
    setCheckFailed(false)
    setCoach(false)
    try {
      const shot = await snapshot(w)
      const started = performance.now()
      const res = await runCheck({
        photo: shot.photo, photoW: shot.sw, photoH: shot.sh, videoW: shot.sw, videoH: shot.sh, K: shot.K, pose: shot.pose,
        anchor: w.anchor, poseQuality: 'good', model: w.check.model, scene: w.check.scene, renderer: w.check.renderer, elements: w.elements,
      })
      const result = res.response?.result
      if (!result) throw res.error ?? new ApiError('check failed', 0)
      if (outcome) {
        URL.revokeObjectURL(outcome.photoUrl)
        if (outcome.renderUrl) URL.revokeObjectURL(outcome.renderUrl)
      }
      const runId = storedRunId(res.response)
      if (runId) setRunIds((ids) => [...ids.filter((x) => x !== runId), runId].slice(-8))
      setOutcome({
        result, photoUrl: URL.createObjectURL(shot.photo), renderUrl: res.render ? URL.createObjectURL(res.render) : null, runId,
        latencyMs: performance.now() - started, score: scoreCheck(result.findings, SITE_AS_BUILT),
      })
      setSelectedMark(null)
      setResultsOpen(true)
      saveLastCheck(PROJECT_ID, { result, runId, at: new Date().toISOString() })
      if (pinsRef.current) disposePins(pinsRef.current)
      pinsRef.current = makePins(result.findings, w.elements, { radiusM: 0.18, dim: result.image_quality !== 'good' })
      w.world.add(pinsRef.current)
      unmarkRef.current?.()
      unmarkRef.current = markFindings(w.world, w.design, w.asBuilt, result.findings)
      dirty.current = true
    } catch (e) {
      setNotice(e instanceof ApiError ? checkErrorMessage(e) : e instanceof Error ? e.message : 'Check failed. Try again.')
      setCheckFailed(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className={`vs${outcome && resultsOpen ? ' vs-has-results' : ''}`} role="application" aria-label={`Virtual demo at ${vp.id}, ${vp.name}`}>
      <canvas ref={canvasRef} className="vs-canvas" tabIndex={0} aria-label="Drag or use the arrow keys to look around" />

      <div className="vs-top">
        <span className="vs-chip"><span className="vs-chip-tag">Virtual demo</span>{vp.id} · {vp.name}</span>
        <div className="vs-top-actions">
          <button type="button" className={`vs-btn${showDesign ? ' vs-btn-on' : ''}`} aria-pressed={showDesign} onClick={toggleDesign}
            disabled={status !== 'ready'}>Design overlay</button>
          {touch && (
            <button type="button" className={`vs-btn${motionOn ? ' vs-btn-on' : ''}`} aria-pressed={motionOn} onClick={() => void toggleMotion()}
              disabled={status !== 'ready'}>Turn with device</button>
          )}
          <button type="button" className="vs-btn" onClick={onExit}>Exit</button>
        </div>
      </div>

      {status === 'loading' && <p className="vs-status" role="status">Loading the virtual demo…</p>}
      {status === 'error' && <p className="vs-status vs-status-error" role="alert">{error}</p>}

      {status === 'ready' && coach && (
        <div className="vs-coach" role="note">
          <p>
            <strong>You're on the X at {vp.id}.</strong> A few defects are planted in this view. You stay on the spot and
            turn: {touch ? 'drag, or tap Turn with device and turn the iPad.' : 'drag, or use the arrow keys.'}
          </p>
          <p>Aim at the work and tap <strong>Check as-built</strong>.</p>
          <button type="button" className="vs-btn" onClick={() => { setCoach(false); canvasRef.current?.focus({ preventScroll: true }) }}>Got it</button>
        </div>
      )}

      <div className="vs-bottom">
        {notice && <p className="vs-notice" role="status">{notice}</p>}
        {checkFailed && (
          <Link to="/samples?photos" className="vs-btn vs-btn-light">Use a ready-made view instead</Link>
        )}
        {outcome && !resultsOpen && (
          <button type="button" className="vs-btn" onClick={() => setResultsOpen(true)}>Show results</button>
        )}
        <button type="button" className="vs-check" onClick={() => void check()} disabled={status !== 'ready' || checking}>
          {checking ? 'Gemini is checking…' : 'Check as-built'}
        </button>
      </div>

      {outcome && resultsOpen && (
        <aside className="vs-results" aria-label="Check results">
          <div className="vs-results-head">
            <h2>As-built check · {vp.id}</h2>
            <button type="button" className="vs-btn vs-btn-light" onClick={() => setResultsOpen(false)}>Back to the view</button>
          </div>
          <ScoreCard score={outcome.score} />
          <div className="vs-compare">
            <figure>
              <figcaption>Your view: the site photo</figcaption>
              <EvidenceView imageUrl={outcome.photoUrl} result={outcome.result} selectedMark={selectedMark} onSelect={setSelectedMark} />
            </figure>
            {outcome.renderUrl && (
              <figure>
                <figcaption>The BIM design from the same spot, as Gemini saw it</figcaption>
                <img className="vs-render" src={outcome.renderUrl} alt="The BIM design render with numbered marks, from the same camera pose" />
              </figure>
            )}
          </div>
          <p className="vs-judged">{judgedLine(outcome)}</p>
          {runIds.length > 0 && (
            <div className="vs-report">
              <p><strong>Done for today?</strong> Gemini writes the site report from {runIds.length === 1 ? 'this check' : `your ${runIds.length} checks`}: safety first, then structure, then progress.</p>
              <button type="button" className="btn btn-accent" onClick={() => setReportOpen(true)}>Write today's site report</button>
            </div>
          )}
          <FindingsPanel result={outcome.result} selectedMark={selectedMark} onSelect={(f) => setSelectedMark(f.mark)} onDraftIssue={setDraftFor} />
          {outcome.score.outOfView.length > 0 && (
            <details className="vs-truth">
              <summary>Planted elsewhere on this site ({outcome.score.outOfView.length})</summary>
              <p className="note">Out of this view, so not checked. Step in at another QR spot to find them.</p>
              <ul>{outcome.score.outOfView.map((d) => <li key={d.element}>{describeDeviation(d)}</li>)}</ul>
            </details>
          )}
          {notice && <p className="note" role="status">{notice}</p>}
        </aside>
      )}

      {reportOpen && <ReportDialog runIds={runIds} onClose={() => setReportOpen(false)} />}

      {draftFor && worldRef.current && (
        <IssueDialog open projectId={PROJECT_ID} runId={outcome?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={worldRef.current.elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved.') }} />
      )}
    </div>
  )
}

/** The planted truth for this view, after the check: what Gemini caught and what it missed. */
function ScoreCard({ score }: { score: Score }) {
  return (
    <section className="vs-score" aria-label="Against the planted defects">
      <p className="vs-score-line">{scoreLine(score)}</p>
      {score.inView.length > 0 && (
        <ul className="vs-score-list">
          {score.inView.map(({ planted, found }) => (
            <li key={planted.element} className={found ? 'hit' : 'miss'}>
              <span aria-hidden="true">{found ? '✓' : '✗'}</span>
              {describeDeviation(planted)}
              <span className="vs-score-tag">{found ? 'found' : 'missed'}</span>
            </li>
          ))}
        </ul>
      )}
      {score.falseAlarms.length > 0 && (
        <p className="note">Flagged but not planted: {score.falseAlarms.map((f) => f.name).join(', ')}.</p>
      )}
    </section>
  )
}

/** "Checked by gemini-3.8-flash in 6.2 s · 18 elements compared · about US$0.004". */
function judgedLine(o: Outcome): string {
  const parts = [`Checked by ${o.result.model_version ?? 'Gemini'} in ${(o.latencyMs / 1000).toFixed(1)} s`,
    `${o.result.findings.length} elements compared`]
  if (o.result.usage) parts.push(`about US$${o.result.usage.cost_usd_est.toFixed(3)}`)
  return parts.join(' · ')
}
