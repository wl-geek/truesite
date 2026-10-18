import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping, HemisphereLight, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer, type Group,
} from 'three'
import { ApiError, getProject } from '../api/client'
import type { Anchor, CheckResult, Element, Finding } from '../api/types'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage, toCheckError } from '../check/messages'
import { loadReportRuns, rememberReportRun, reportScope, type ReportRun } from '../check/reportRuns'
import { runCheck, storedRunId } from '../check/runCheck'
import { releaseRenderer, watchContextLoss } from '../scene/glContext'
import { disposeModel, parseModel, type LoadedModel } from '../scene/loadModel'
import { deviceRotation, requestMotionPermission } from '../scene/motion'
import { paintOf } from '../scene/palette'
import { disposePins, makePins } from '../scene/pins'
import { applyTypeColours, type Inset, insetView, NO_INSET } from '../scene/viewer'
import { describeDeviation, plantedNote, SITE_AS_BUILT } from '../sim/asBuilt'
import { deviceLook, dragLook, forwardOf, type LookAngles, lookToward, turnBetween, yawOf } from '../sim/lookAngles'
import { overlayHighlighter } from '../sim/overlayPick'
import { pickElement } from '../scene/pick'
import { samplePose } from '../sim/samplePose'
import { markFindings } from '../sim/findings3d'
import { notCheckedText, scoreCheck, scoreLine, type Score } from '../sim/score'
import { buildWorld, makeAsBuilt, photoFinish, rng } from '../sim/world'
import { typeLabel } from './elementFacts'
import { ElementPanel } from './ElementPanel'
import { EvidenceView } from './EvidenceView'
import { imageQualityMessage } from './findingFormat'
import { useSavedIssues } from './issueList'
import { SavedIssues } from './SavedIssues'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { ReportDialog } from './ReportDialog'
import { Link } from './Link'
import { ReloadPrompt } from './ReloadPrompt'
import { SITE_VIEWPOINTS } from './siteViewpoints'
import { useMedia, WIDE } from './useMedia'
import './virtualSite.css'

const PROJECT_ID = 'site'
const EYE_HEIGHT_M = 1.5 // the iPad's camera, held upright at chest height
const HALF_FOV_SHORT_DEG = 25 // half the field of view across the screen's short side
const SNAPSHOT_LONG_PX = 1280
const TURN_MS = 550 // turning to face an element
const OVERLAY_OPACITY = 0.45 // the design over the site: there, but the site reads through it

type World = {
  renderer: WebGLRenderer; camera: PerspectiveCamera; world: Scene; overlay: Scene; pinScene: Scene
  asBuilt: LoadedModel; design: LoadedModel; check: { model: LoadedModel; scene: Scene; renderer: WebGLRenderer }
  anchor: Anchor; eye: [number, number, number]; elements: Map<string, Element>; multiStorey: boolean; restoreColours: () => void
  highlight: ReturnType<typeof overlayHighlighter>
}
type Outcome = { result: CheckResult; photoUrl: string; renderUrl: string | null; runId: string | null; latencyMs: number; score: Score }

/**
 * Free one visit's models, GPU memory and both WebGL contexts now, not at garbage collection (audit A-56, B-06):
 * iPad Safari caps live contexts, and each visit holds a 4096² shadow map and a 2048² ground texture.
 */
export function releaseWorld(w: Pick<World, 'renderer' | 'asBuilt' | 'design' | 'check' | 'restoreColours'> & { highlight?: World['highlight'] }): void {
  w.highlight?.dispose() // before the colours: it gives back the type-coloured overlay materials
  w.restoreColours()
  ;[w.asBuilt, w.design, w.check.model].forEach(disposeModel)
  releaseRenderer(w.renderer)
  releaseRenderer(w.check.renderer)
}

/**
 * The virtual site: stand on a viewpoint's X inside the simulated as-built building and turn on the spot. The BIM
 * design is overlaid on it, like live AR: tap an element for its details (and, after a check, its result).
 * Check as-built takes what you see as the site photo and runs the real check against the BIM design.
 */
export function VirtualSite({ viewpointId, onExit }: { viewpointId: string; onExit: () => void }) {
  const vp = SITE_VIEWPOINTS.find((v) => v.id === viewpointId) ?? SITE_VIEWPOINTS[0]
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const anglesRef = useRef<LookAngles>({ yaw: yawOf(vp.look), pitch: (vp.startPitchDeg * Math.PI) / 180 })
  const dirty = useRef(true)
  const showDesignRef = useRef(true)
  const insetRef = useRef<Inset>(NO_INSET)
  const turnRef = useRef(0)
  const pinsRef = useRef<Group | null>(null)
  const unmarkRef = useRef<(() => void) | null>(null)
  const motionRef = useRef<{ offset: number; last: LookAngles | null } | null>(null)
  const wide = useMedia(WIDE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [showDesign, setShowDesign] = useState(true)
  const [motionOn, setMotionOn] = useState(false)
  const [coach, setCoach] = useState(true)
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [hover, setHover] = useState<{ name: string; type: string; x: number; y: number } | null>(null)
  const [docks, setDocks] = useState({ left: 0, right: 0 })
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  // This browser session's stored checks at every spot, for the day's site report (audit C-03).
  const [reportRuns, setReportRuns] = useState<ReportRun[]>(() => loadReportRuns(PROJECT_ID))
  const runIds = useMemo(() => reportRuns.map((r) => r.runId), [reportRuns])
  const [reportOpen, setReportOpen] = useState(false)
  const [glDead, setGlDead] = useState(false)
  const outcomeRef = useRef<Outcome | null>(null)
  const offline = outcome?.result.model_version === 'fake' // the server runs the offline stand-in, not Gemini
  const touch = useMemo(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && navigator.maxTouchPoints > 0, [])

  // Build the world once: the as-built model in the simulated site, the design for the overlay, and a third copy
  // off screen for the check's design render (each three.js object can only sit in one scene).
  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stopWatch: (() => void) | null = null
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
        Object.assign(mat, { transparent: true, opacity: Math.min(mat.opacity, OVERLAY_OPACITY), depthWrite: false })
      })

      const renderer = new WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFShadowMap
      renderer.autoClear = false
      stopWatch = watchContextLoss(canvas, () => setGlDead(true))
      const camera = new PerspectiveCamera(50, 1, 0.1, 600)
      camera.up.set(0, 0, 1)
      const eye: [number, number, number] = [vp.stand[0], vp.stand[1], EYE_HEIGHT_M]
      camera.position.set(...eye)
      const checkScene = new Scene()
      checkScene.add(checkModel.ifcRoot)
      const checkRenderer = new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false })
      worldRef.current = {
        renderer, camera, world, overlay, pinScene: new Scene(), asBuilt, design,
        check: { model: checkModel, scene: checkScene, renderer: checkRenderer },
        anchor, eye, elements, multiStorey: new Set(project.elements.map((e) => e.storey)).size > 1, restoreColours,
        highlight: overlayHighlighter(design),
      }
      setStatus('ready')
      canvas.focus({ preventScroll: true, focusVisible: false }) // arrow keys work at once; the ring is for keyboard users
      const loop = () => {
        raf = requestAnimationFrame(loop)
        if (dirty.current) {
          dirty.current = false
          draw()
        }
      }
      loop()
    }
    setup().catch(() => {
      if (cancelled) return
      setError("Couldn't load the virtual site. Exit and try again.") // no raw technical text (audit B-15)
      setStatus('error')
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(turnRef.current)
      stopWatch?.() // before the release: forceContextLoss fires webglcontextlost
      const w = worldRef.current
      worldRef.current = null
      if (!w) return
      if (pinsRef.current) disposePins(pinsRef.current)
      unmarkRef.current?.()
      releaseWorld(w)
    }
  }, [vp.id])

  // A check's image URLs are revoked when the next check replaces them, and the last ones on exit (audit B-06).
  useEffect(() => { outcomeRef.current = outcome }, [outcome])
  useEffect(() => () => {
    const o = outcomeRef.current
    if (!o) return
    URL.revokeObjectURL(o.photoUrl)
    if (o.renderUrl) URL.revokeObjectURL(o.renderUrl)
  }, [])

  /**
   * Size the camera to the canvas: a fixed field of view across the short side, so phones and iPads see alike. Panels
   * over the view shift it (the camera doesn't move) so what you look at stays in the middle of the uncovered part.
   */
  const fit = useCallback((w: World, cssW: number, cssH: number, inset: Inset) => {
    const f = Math.min(cssW, cssH) / 2 / Math.tan((HALF_FOV_SHORT_DEG * Math.PI) / 180)
    const v = insetView(cssW, cssH, inset)
    w.camera.fov = (2 * Math.atan(v.fullH / 2 / f) * 180) / Math.PI
    w.camera.aspect = v.fullW / v.fullH
    if (v.fullW !== cssW || v.fullH !== cssH) w.camera.setViewOffset(v.fullW, v.fullH, v.offsetX, v.offsetY, cssW, cssH)
    else w.camera.clearViewOffset()
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
    fit(w, cssW, cssH, insetRef.current)
    aim(w)
    w.renderer.clear()
    w.renderer.render(w.world, w.camera)
    if (showDesignRef.current) {
      w.renderer.clearDepth() // like AR: the design is drawn over the "camera image"
      w.renderer.render(w.overlay, w.camera)
    }
    w.renderer.clearDepth() // the findings' pins on top of everything
    w.renderer.render(w.pinScene, w.camera)
  }

  // Redraw on resize.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => (dirty.current = true))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  /** Turn on the spot to face an element (eased; at once for reduced motion). Turning with the device keeps up. */
  const turnTo = useCallback((guid: string) => {
    const w = worldRef.current
    const e = w?.elements.get(guid)
    if (!w || !e) return
    const [lo, hi] = e.bbox_m
    const to = lookToward(w.eye, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2])
    const from = anglesRef.current
    const ms = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : TURN_MS
    const start = performance.now()
    cancelAnimationFrame(turnRef.current)
    const step = (now: number) => {
      const t = ms ? Math.min(1, (now - start) / ms) : 1
      const before = anglesRef.current
      anglesRef.current = turnBetween(from, to, t)
      if (motionRef.current) motionRef.current.offset += anglesRef.current.yaw - before.yaw
      dirty.current = true
      if (t < 1) turnRef.current = requestAnimationFrame(step)
    }
    turnRef.current = requestAnimationFrame(step)
  }, [])

  /** The finding's element: its details (and result) open, the view turns to it unless it was tapped in the view. */
  const selectFinding = useCallback((f: Finding, turn: boolean) => {
    setSelectedMark(f.mark)
    setSelected(f.guid)
    if (turn) turnTo(f.guid)
  }, [turnTo])
  const findingFor = useCallback((guid: string | null) => outcome?.result.findings.find((f) => f.guid === guid) ?? null, [outcome])
  // Saved issues are shared with the 3D model: the same browser session reads the same list.
  const { issues, add: addIssue } = useSavedIssues(PROJECT_ID)
  const savedGuids = useMemo(() => new Set(issues.map((i) => i.guid)), [issues])
  const selectIssue = (i: { guid: string }) => {
    setSelected(i.guid)
    setSelectedMark(findingFor(i.guid)?.mark ?? null)
    turnTo(i.guid)
  }

  // Drag to look around (the world follows the finger), arrow keys too. A tap picks a finding's pin, else (with the
  // overlay on) a design element; a mouse shows the element's name on hover.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let last: { x: number; y: number } | null = null
    let pressed: { x: number; y: number } | null = null
    let hoverRaf = 0
    const ndc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
    }
    /** The design element drawn under the pointer, with the same touch tolerance as live AR (scene/pick.ts). */
    const pickAt = (w: World, e: PointerEvent, tolerancePx?: number) =>
      pickElement(w.design, w.camera, ndc(e), { viewW: canvas.clientWidth, viewH: canvas.clientHeight, tolerancePx })
    const down = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY }
      pressed = { x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
      cancelAnimationFrame(turnRef.current)
      setCoach(false)
      setHover(null)
    }
    const move = (e: PointerEvent) => {
      if (!last) {
        if (e.pointerType !== 'mouse') return
        cancelAnimationFrame(hoverRaf)
        hoverRaf = requestAnimationFrame(() => {
          const w = worldRef.current
          const guid = w && showDesignRef.current ? pickAt(w, e, 0) : null // hover: exactly under the mouse
          const el = guid ? w!.elements.get(guid) : undefined
          setHover(el ? { name: el.name || 'Unnamed element', type: typeLabel(el), x: e.clientX, y: e.clientY } : null)
        })
        return
      }
      if (!worldRef.current) return
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
      if (!pressed || !w || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) return
      pressed = null
      const at = ndc(e)
      const pins = pinsRef.current
      if (pins) {
        const ray = new Raycaster()
        ray.setFromCamera(new Vector2(at.x, at.y), w.camera)
        const mark = ray.intersectObjects(pins.children, false)[0]?.object.userData.mark as number | undefined
        const f = mark === undefined ? undefined : outcomeRef.current?.result.findings.find((x) => x.mark === mark)
        if (f) return selectFinding(f, false)
      }
      if (!showDesignRef.current) return
      const guid = pickAt(w, e)
      setSelected(guid)
      setSelectedMark(outcomeRef.current?.result.findings.find((x) => x.guid === guid)?.mark ?? null)
    }
    const leave = () => { cancelAnimationFrame(hoverRaf); setHover(null) }
    const key = (e: KeyboardEvent) => {
      const step = (5 * Math.PI) / 180
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
      if (!d) return
      e.preventDefault()
      cancelAnimationFrame(turnRef.current)
      anglesRef.current = dragLook(anglesRef.current, d[0], d[1], 1)
      dirty.current = true
      setCoach(false)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(hoverRaf)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('keydown', key)
    }
  }, [selectFinding])

  // The selected element is painted orange in the overlay; Escape closes its details.
  useEffect(() => {
    worldRef.current?.highlight.set(selected)
    dirty.current = true
  }, [selected, status])
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // Wide screens: the results dock on the left, the element details on the right; phones: one bottom sheet at a time.
  // The view is centred in what's left, and the controls stay in that free middle.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const panel = root.querySelector<HTMLElement>(':scope > .element-panel')
      const results = root.querySelector<HTMLElement>(':scope > .vs-results')
      const sheet = panel ?? results
      const left = wide && results ? results.offsetWidth + 24 : 0
      const right = wide && panel ? panel.offsetWidth + 24 : 0
      insetRef.current = { left, right, bottom: !wide && sheet ? sheet.offsetHeight : 0 }
      dirty.current = true
      setDocks((d) => (d.left === left && d.right === right ? d : { left, right }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    for (const el of root.querySelectorAll<HTMLElement>(':scope > .element-panel, :scope > .vs-results')) ro.observe(el)
    return () => ro.disconnect()
  }, [selected, resultsOpen, outcome, wide, status])

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
    setHover(null)
    dirty.current = true
  }

  /** The view as a site photo (no overlay, no pins, no panels), at about 1280 px, with the matching camera and pose. */
  async function snapshot(w: World) {
    const canvas = canvasRef.current!
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    const sw = cssW >= cssH ? SNAPSHOT_LONG_PX : Math.round((SNAPSHOT_LONG_PX * cssW) / cssH)
    const sh = cssW >= cssH ? Math.round((SNAPSHOT_LONG_PX * cssH) / cssW) : SNAPSHOT_LONG_PX
    const dpr = w.renderer.getPixelRatio()
    w.renderer.setPixelRatio(1)
    w.renderer.setSize(sw, sh, false)
    fit(w, sw, sh, NO_INSET)
    aim(w)
    w.renderer.clear()
    w.renderer.render(w.world, w.camera)
    const photo = photoFinish(w.renderer.domElement, sw, sh, rng(`${vp.id}-${Date.now()}`)) // reads the frame right away
    const f = sh / 2 / Math.tan((w.camera.fov * Math.PI) / 360)
    const { yaw, pitch } = anglesRef.current
    const pose = samplePose(w.anchor, w.eye, [Math.cos(yaw), Math.sin(yaw)], (pitch * 180) / Math.PI)
    w.renderer.setPixelRatio(dpr)
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
      if (runId) setReportRuns(rememberReportRun(PROJECT_ID, reportRuns, { runId, spot: vp.id }))
      setOutcome({
        result, photoUrl: URL.createObjectURL(shot.photo), renderUrl: res.render ? URL.createObjectURL(res.render) : null, runId,
        latencyMs: performance.now() - started, score: scoreCheck(result.findings, SITE_AS_BUILT),
      })
      setSelectedMark(null)
      setSelected(null)
      setResultsOpen(true)
      saveLastCheck(PROJECT_ID, { result, runId, at: new Date().toISOString() })
      if (pinsRef.current) disposePins(pinsRef.current)
      pinsRef.current = makePins(result.findings, w.elements, { radiusM: 0.18, dim: result.image_quality !== 'good' })
      w.pinScene.add(pinsRef.current)
      unmarkRef.current?.()
      unmarkRef.current = markFindings(w.world, w.design, w.asBuilt, result.findings)
      dirty.current = true
    } catch (e) {
      setNotice(checkErrorMessage(toCheckError(e)))
      setCheckFailed(true)
    } finally {
      setChecking(false)
    }
  }

  const w = worldRef.current
  const element = selected && w ? w.elements.get(selected) : undefined
  const canDraft = outcome !== null && imageQualityMessage(outcome.result.image_quality) === null
  const rootStyle = { '--dock-l': `${docks.left}px`, '--dock-r': `${docks.right}px` } as CSSProperties
  const classes = ['vs', element ? 'vs-has-element' : '', outcome && resultsOpen ? 'vs-has-results' : ''].filter(Boolean).join(' ')

  return (
    <div ref={rootRef} className={classes} style={rootStyle} role="application" aria-label={`Virtual demo at ${vp.id}, ${vp.name}`}>
      <canvas ref={canvasRef} className="vs-canvas" tabIndex={0} aria-label="Drag or use the arrow keys to look around; tap an element for its details" />

      <div className="vs-top">
        <span className="vs-chip"><span className="vs-chip-tag">Virtual demo</span>{vp.id} · {vp.name}</span>
        <button type="button" className="vs-btn" onClick={onExit}>Exit</button>
      </div>

      {status === 'loading' && <p className="vs-status" role="status">Loading the virtual demo…</p>}
      {status === 'error' && <p className="vs-status vs-status-error" role="alert">{error}</p>}
      {glDead && <ReloadPrompt />}

      {status === 'ready' && coach && (
        <div className="vs-coach" role="note">
          <p><strong>You're on the X at {vp.id}.</strong> The BIM design is laid over the simulated site, like live AR, and a
            few defects are planted in this view.</p>
          <ul>
            <li>Turn on the spot: {touch ? 'drag, or tap Turn with device and turn your phone' : 'drag, or use the arrow keys'}.</li>
            <li>Tap an element for its details; switch the BIM overlay off to see the bare site.</li>
            <li>Aim at the work and tap <strong>Check as-built</strong>.</li>
          </ul>
          <button type="button" className="vs-btn" onClick={() => { setCoach(false); canvasRef.current?.focus({ preventScroll: true, focusVisible: false }) }}>Got it</button>
        </div>
      )}

      {hover && !element && (
        <p className="vs-hover" style={{ left: hover.x + 14, top: hover.y + 14 }} aria-hidden="true">
          <strong>{hover.name}</strong>{hover.type}
        </p>
      )}

      <div className="vs-bottom">
        {notice && <p className="vs-notice" role="status">{notice}</p>}
        {checkFailed && (
          <Link to="/samples?photos" className="vs-btn vs-btn-light">Use a ready-made view instead</Link>
        )}
        <div className="vs-controls">
          <div className="vs-tools" role="toolbar" aria-label="View">
            <label className={`vs-switch${status !== 'ready' ? ' vs-switch-off' : ''}`}>
              <input type="checkbox" role="switch" checked={showDesign} onChange={toggleDesign} disabled={status !== 'ready'} />
              <span className="vs-switch-track" aria-hidden="true"><span className="vs-switch-knob" /></span>
              BIM overlay
            </label>
            {touch && (
              <button type="button" className="vs-tool" aria-pressed={motionOn} onClick={() => void toggleMotion()} disabled={status !== 'ready'}>
                Turn with device
              </button>
            )}
            {outcome && !resultsOpen && (
              <button type="button" className="vs-tool" onClick={() => setResultsOpen(true)}>Show results</button>
            )}
          </div>
          <button type="button" className="vs-check" onClick={() => void check()} disabled={status !== 'ready' || checking}>
            {checking ? 'Gemini is checking…' : 'Check as-built'}
          </button>
        </div>
      </div>

      {outcome && resultsOpen && (
        <aside className="vs-results" aria-label="Check results">
          <div className="vs-results-head">
            <h2>As-built check · {vp.id}</h2>
            <button type="button" className="vs-btn vs-btn-light" onClick={() => setResultsOpen(false)}>Hide results</button>
          </div>
          <ScoreCard score={outcome.score} offline={offline} />
          <p className="vs-tip">Pick a finding to turn to it and see its details.</p>
          <FindingsPanel result={outcome.result} selectedMark={selectedMark} onSelect={(f) => selectFinding(f, true)} onDraftIssue={setDraftFor}
            savedGuids={savedGuids} footer={w && <SavedIssues issues={issues} elements={w.elements} onSelect={selectIssue} />} />
          <div className="vs-compare">
            <figure>
              <figcaption>Your view: the site photo</figcaption>
              <EvidenceView imageUrl={outcome.photoUrl} result={outcome.result} selectedMark={selectedMark}
                onSelect={(mark) => { const f = outcome.result.findings.find((x) => x.mark === mark); if (f) selectFinding(f, true) }} />
            </figure>
            {outcome.renderUrl && (
              <figure>
                <figcaption>The BIM design from the same spot, as Gemini saw it</figcaption>
                <img className="vs-render" src={outcome.renderUrl} alt="The BIM design render with numbered marks, from the same camera pose" />
              </figure>
            )}
          </div>
          {outcome.score.notChecked.length > 0 && (
            <details className="vs-truth">
              <summary>{notCheckedText(outcome.score).heading}</summary>
              <p className="note">{notCheckedText(outcome.score).note}</p>
              <ul>{outcome.score.notChecked.map((d) => <li key={d.element}>{describeDeviation(d)}</li>)}</ul>
            </details>
          )}
          {reportRuns.length > 0 && (
            <div className="vs-report">
              <p><strong>Done for today?</strong> {offline ? 'The offline stand-in' : 'Gemini'} writes the site report
                from {reportScope(reportRuns, vp.id)}: safety first, then structure, then progress.</p>
              <button type="button" className="btn btn-accent" onClick={() => setReportOpen(true)}>Write today's site report</button>
            </div>
          )}
          <p className="vs-model-link">The 3D model shows this check and your saved issues too.{' '}
            <Link to="/model" className="btn btn-small">Open the 3D model</Link></p>
          <p className="vs-judged">{judgedLine(outcome)}</p>
          {notice && <p className="note" role="status">{notice}</p>}
        </aside>
      )}

      {element && w && (
        <ElementPanel projectId={PROJECT_ID} element={element} multiStorey={w.multiStorey} onClose={() => setSelected(null)}
          onZoom={() => turnTo(element.guid)} zoomLabel="Turn to element" zoomIcon="aim" finding={findingFor(element.guid)}
          onDraftIssue={canDraft ? setDraftFor : undefined} planted={outcome ? plantedNote(element.name) : null}
          savedIssues={issues.filter((i) => i.guid === element.guid)} />
      )}

      {reportOpen && <ReportDialog runIds={runIds} offline={offline} onClose={() => setReportOpen(false)} />}

      {draftFor && w && (
        <IssueDialog open projectId={PROJECT_ID} runId={outcome?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={w.elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={(issue) => { setDraftFor(null); addIssue(issue); setNotice('Issue saved.') }} />
      )}
    </div>
  )
}

/** The planted truth for this view, after the check: what Gemini caught and what it missed. */
function ScoreCard({ score, offline }: { score: Score; offline: boolean }) {
  if (offline) {
    return (
      <section className="vs-score" aria-label="Against the planted defects">
        <p className="vs-score-line">Offline test mode: Gemini isn't connected on this server</p>
        <p className="note">The stand-in reads every element as matching, so it flags none of the planted defects. The
          deployed app runs the real check with Gemini.</p>
      </section>
    )
  }
  return (
    <section className="vs-score" aria-label="Against the planted defects">
      <p className="vs-score-line">{scoreLine(score)}</p>
      {score.inView.length > 0 && (
        <ul className="vs-score-list">
          {score.inView.map(({ planted, found }) => (
            <li key={planted.element} className={found ? 'hit' : 'miss'}>
              <span aria-hidden="true">{found ? '✓' : '✗'}</span>{' '}
              <span>{describeDeviation(planted)}</span>{' '}
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
  const by = o.result.model_version === 'fake' ? 'the offline stand-in (not Gemini)' : o.result.model_version ?? 'Gemini'
  const parts = [`Checked by ${by} in ${(o.latencyMs / 1000).toFixed(1)} s`,
    `${o.result.findings.length} elements compared`]
  if (o.result.usage) parts.push(`about US$${o.result.usage.cost_usd_est.toFixed(3)}`)
  return parts.join(' · ')
}
