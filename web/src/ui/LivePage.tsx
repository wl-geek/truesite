import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, getProject } from '../api/client'
import type { Anchor, CheckResult, Finding, ProjectManifest } from '../api/types'
import { CameraError, startRearCamera, stopCamera, watchCamera, type CameraStart } from '../camera/camera'
import { isCalibrated, loadQrSizeCorrection } from '../camera/intrinsics'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage, toCheckError } from '../check/messages'
import { runCheck, storedRunId } from '../check/runCheck'
import { buildSampleMeta } from '../check/sampleMeta'
import { anchorCorners, captureSnapshot, fallbackPose, snapshotQuality, type Snapshot } from '../check/snapshot'
import { estimatePose, type Intrinsics, type Pose, type Point2, type Quality } from '../pose'
import { QrWorkerClient } from '../qr/qrClient'
import { viewerPathFor } from '../router'
import {
  aboutDistance, checkAvailability, coachHint, effectiveQrSize, findAnchor, isDeskAnchor, isFar, isLifeSizeFloor, scaleLabel, startDistanceM, virtualDemoHref,
  walkInsideFirst,
} from '../scene/arMath'
import { makeEvalMarkers, parseEvalPoints } from '../scene/evalMarkers'
import { paintOf } from '../scene/palette'
import { disposePins, makePins } from '../scene/pins'
import { pickUsdzRadius, usdzPlan } from '../scene/usdzVariants'
import {
  appleDeviceName, buildWalkScene, canQuickLook, exportUsdz, isAndroid, isAppleMobile, openQuickLook, sceneViewerUrl, usdzUrl,
} from '../scene/walkthrough'
import { startXrWalk, xrArSupported } from '../scene/xrWalk'
import { NEEDED_VIEWS, startXrPlace, type XrPlaceSession, type XrPlaceState } from '../scene/xrPlace'
import { xrFallback } from '../scene/xrStart'
import { ModelControls } from './ModelControls'
import { freshCanvas } from '../scene/glContext'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { createOverlay, type Overlay, type OverlayState } from '../scene/overlay'
import { CalibrationPanel } from './CalibrationPanel'
import { EvidenceView } from './EvidenceView'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { Link } from './Link'
import { UNKNOWN_ANCHOR_MESSAGE, isUnknownProject, liveLoadErrorMessage } from './liveFormat'
import { requestMotionPermission } from '../scene/motion'
import { QualityBadge } from './QualityBadge'
import { SITE_VIEWPOINTS } from './siteViewpoints'
import { DeviceTip } from './DeviceTip'
import { goToSection } from './TopBar'
import { sheetInfo } from './sheet'
import { isHandheld } from './device'
import { ReloadPrompt } from './ReloadPrompt'

export type LivePageProps = { projectId: string; anchorId: string }

type Loaded = { project: ProjectManifest; anchor: Anchor; model: LoadedModel }
type Outcome = { result: CheckResult; runId: string | null; photoUrl: string; viewNote: string | null }

/** The place-by-code overlay before the session reports its first state. */
// The demo uses the camera overlay only. Walk inside (Quick Look / WebXR hit-test) and Android Start AR stay in the
// code for later and come back with ?xr=1 on the page URL.
const XR_EXTRAS = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('xr')
const XR_PLACE_STARTING: XrPlaceState = { phase: 'scanning', views: 0, spreadDeg: 0, progress: 0, codeSeen: false }

type StartError = CameraError['kind'] | 'webgl'

const CAMERA_ERRORS: Record<StartError, string> = {
  insecure: 'The camera only works over a secure (https) connection. Open the https link instead.',
  denied: 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
  notfound: 'No camera was found on this device.',
  overconstrained: "The camera couldn't start with the settings we need. Try another browser.",
  other: "The camera couldn't start. Close other apps that use it and try again.",
  webgl: "The camera works, but the 3D overlay couldn't start in this browser. Try another browser, or try the sample photos.",
}

/** Live AR: the model over the camera view, anchored by the QR code (spec 4.1, 4.2). */
export function LivePage({ projectId, anchorId }: LivePageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Each overlay gets a new canvas (freshCanvas): a released WebGL context can't be used again.
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [glDead, setGlDead] = useState(false)
  const overlayRef = useRef<Overlay | null>(null)
  const camRef = useRef<CameraStart | null>(null)
  const qrRef = useRef<QrWorkerClient | null>(null)
  const unwatchCamRef = useRef<(() => void) | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [projectMissing, setProjectMissing] = useState(false)
  const [camError, setCamError] = useState<StartError | null>(null)
  const [camStopped, setCamStopped] = useState(false)
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)
  // Motion & Orientation refused (iOS asks on Start camera): no levelling and no look-around, so say so (audit C-15).
  const [motionOff, setMotionOff] = useState(false)
  // Live AR needs a tablet or phone: on a laptop or PC the popup opens every time and stays; its way out is the start
  // page's Live AR section, where the sheets are.
  const handheld = useMemo(() => isHandheld(), [])
  const leaveLive = useCallback(() => goToSection('live'), [])
  const [state, setState] = useState<OverlayState | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const [draftFor, setDraftFor] = useState<Finding | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [usdz, setUsdz] = useState<Blob | string | null>(null)
  // Quick Look has no View distance slider: this picks the build-time distance variant instead (null = all).
  const [walkRadius, setWalkRadius] = useState<number | null>(null)
  const quickLook = useMemo(() => XR_EXTRAS && isAppleMobile() && canQuickLook(), [])
  const device = useMemo(() => appleDeviceName(), [])
  const android = useMemo(() => XR_EXTRAS && isAndroid(), [])
  const [xrOk, setXrOk] = useState(false)
  const [xrPlaced, setXrPlaced] = useState(false)
  const xrOverlayRef = useRef<HTMLDivElement>(null)
  const xrStopRef = useRef<(() => void) | null>(null)
  const xrPlaceRef = useRef<XrPlaceSession | null>(null)
  const [xrPlace, setXrPlace] = useState<XrPlaceState | null>(null)
  // One AR start at a time (the ref blocks a double tap before React re-renders), and which overlay copy to show.
  const xrBusyRef = useRef(false)
  const xrCancelRef = useRef(false)
  const [xrStarting, setXrStarting] = useState(false)
  const [xrMode, setXrMode] = useState<'place' | 'walk' | null>(null)
  const [xrNotice, setXrNotice] = useState<string | null>(null)
  useEffect(() => {
    if (XR_EXTRAS) void xrArSupported().then(setXrOk)
  }, [])
  const pinsRef = useRef<ReturnType<typeof makePins> | null>(null)
  const elements = useMemo(() => new Map((loaded?.project.elements ?? []).map((e) => [e.guid, e])), [loaded])
  // Colour by element type (palette.js) in every AR mode and the browser-made Quick Look file.
  const paint = useMemo(() => (guid: string) => { const e = elements.get(guid); return e ? paintOf(e) : undefined }, [elements])
  // The build-time Quick Look files for this project (scripts/make-usdz.mjs works this out the same way).
  const plan = useMemo(() => (loaded ? usdzPlan(loaded.project.anchors, loaded.project.elements) : null), [loaded])

  useEffect(() => {
    let cancelled = false
    let model: LoadedModel | null = null
    ;(async () => {
      const project = await getProject(projectId)
      const anchor = findAnchor(project, anchorId)
      if (!anchor) throw new Error(UNKNOWN_ANCHOR_MESSAGE)
      model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
      if (new URLSearchParams(window.location.search).has('eval')) {
        // ?eval=1: green crosses at the surveyed points in web/public/eval/points.json (spec 10)
        const points = parseEvalPoints(await fetch('/eval/points.json').then((r) => (r.ok ? r.json() : [])).catch(() => []))
        model.ifcRoot.add(makeEvalMarkers(points))
      }
      if (cancelled) disposeModel(model)
      else setLoaded({ project, anchor, model })
    })().catch((e: unknown) => {
      if (cancelled) return
      setError(liveLoadErrorMessage(e))
      setProjectMissing(isUnknownProject(e))
    })
    return () => {
      cancelled = true
      unwatchCamRef.current?.()
      unwatchCamRef.current = null
      overlayRef.current?.dispose()
      overlayRef.current = null
      qrRef.current?.terminate()
      qrRef.current = null
      stopCamera(camRef.current, videoRef.current ?? undefined)
      camRef.current = null
      if (model) disposeModel(model)
    }
  }, [projectId, anchorId])

  // Must run straight from the tap: iOS only grants the camera inside a user gesture.
  async function start() {
    const video = videoRef.current
    const host = canvasHostRef.current
    if (!loaded || !video || !host || starting) return
    setStarting(true)
    setCamError(null)
    setCamStopped(false)
    let camOk = false
    try {
      const motion = await requestMotionPermission() // iOS asks inside this tap; must come before the camera prompt
      setMotionOff(!motion)
      camRef.current = await startRearCamera(video)
      camOk = true
      qrRef.current ??= new QrWorkerClient() // reuse the worker that Start AR may have made
      const overlay = createOverlay({
        video, canvas: freshCanvas(host, 'live-canvas', 'Model overlay'), model: loaded.model, anchor: loaded.anchor, qr: qrRef.current,
        qrSizeCorrection: loadQrSizeCorrection(loaded.anchor.anchor_id), origin: window.location.origin,
        classOf: (guid) => elements.get(guid)?.ifc_class ?? '', paintOf: paint, motion, onContextDead: () => setGlDead(true),
      })
      overlay.onState(setState)
      overlay.start()
      overlayRef.current = overlay
      unwatchCamRef.current = watchCamera(camRef.current.track, document, video, cameraEnded)
      setRunning(true)
      if (!isCalibrated(camRef.current.width, camRef.current.height)) setCalibrating(true) // first use on this camera
    } catch (e) {
      setCamError(e instanceof CameraError ? e.kind : camOk ? 'webgl' : 'other')
      stopCamera(camRef.current, video)
      camRef.current = null
    } finally {
      setStarting(false)
    }
  }

  /** The camera track ended (another app took it, the OS revoked it): back to the start panel. */
  function cameraEnded() {
    unwatchCamRef.current?.()
    unwatchCamRef.current = null
    overlayRef.current?.dispose()
    overlayRef.current = null
    canvasHostRef.current?.replaceChildren()
    stopCamera(camRef.current, videoRef.current ?? undefined)
    camRef.current = null
    setState(null)
    setCalibrating(false)
    setRunning(false)
    setCamStopped(true)
  }

  /** Snapshot + pose on the full frame (the last raw pose is the flip prior). Throws no_pose if the code is not in view. */
  async function snapshotWithPose(overlay: Overlay, video: HTMLVideoElement, anchor: Anchor): Promise<{ snap: Snapshot; K: Intrinsics; pose: Pose; quality: Quality }> {
    const last = overlay.lastRaw()
    const tCapture = performance.now() / 1000 // the tap, before the snapshot's async work
    const priorTrusted = last !== null && state?.provisional === false
    const snap = await captureSnapshot(video, qrRef.current ?? undefined)
    const K = overlay.intrinsics()
    const s = effectiveQrSize(anchor, loadQrSizeCorrection(anchor.anchor_id))
    let pose: Pose | null = null
    let quality: Quality = last?.quality ?? 'poor'
    const corners = anchorCorners(snap, anchor, window.location.origin)
    if (corners) {
      const est = estimatePose(corners.map((p) => [p.x, p.y] as Point2), s, K, last?.pose ?? null)
      if (est) {
        pose = { R: est.R, t: est.t }
        quality = snapshotQuality(est, priorTrusted)
      }
    }
    pose ??= fallbackPose(last, tCapture)
    if (!pose) throw new ApiError('no_pose', 0, 'no_pose')
    return { snap, K, pose, quality }
  }

  // Freeze tracking, take the snapshot, run the check, then resume tracking.
  async function check() {
    const overlay = overlayRef.current
    const video = videoRef.current
    if (!overlay || !video || !loaded || checking) return
    setChecking(true)
    setCheckError(null)
    overlay.stop()
    try {
      const { snap, K, pose, quality } = await snapshotWithPose(overlay, video, loaded.anchor)
      const res = await runCheck({
        photo: snap.photo, photoW: snap.photoW, photoH: snap.photoH, videoW: snap.videoW, videoH: snap.videoH, K, pose,
        anchor: loaded.anchor, poseQuality: quality, model: loaded.model, scene: overlay.scene, renderer: overlay.renderer, elements,
        look: overlay.look,
      })
      if (!res.response) throw res.error ?? new ApiError('check failed', 0)
      const result = res.response.result
      if (outcome) URL.revokeObjectURL(outcome.photoUrl)
      const runId = storedRunId(res.response) // an unsaved run can't take issues (POST /api/issues would 404)
      setOutcome({ result, runId, photoUrl: URL.createObjectURL(snap.photo), viewNote: res.viewNote })
      setShowResults(true)
      setSelectedMark(null)
      if (pinsRef.current) disposePins(pinsRef.current)
      pinsRef.current = makePins(result.findings, elements, { dim: result.image_quality !== 'good' })
      loaded.model.ifcRoot.add(pinsRef.current)
      saveLastCheck(loaded.project.project_id, { result, runId, at: new Date().toISOString() })
    } catch (e) {
      setCheckError(checkErrorMessage(toCheckError(e)))
    } finally {
      overlay.start()
      setChecking(false)
    }
  }

  // Dev only (?dev=1): downloads <sample_id>-photo.jpg and <sample_id>-meta.json. Packaging (eval/README.md):
  // move them to public/samples/<sample_id>/photo.jpg and meta.json, and add a row to index.json (contract section 8).
  const dev = new URLSearchParams(window.location.search).has('dev')
  async function saveSample() {
    const overlay = overlayRef.current
    const video = videoRef.current
    if (!overlay || !video || !loaded) return
    const id = window.prompt('Sample id (lowercase letters, digits, -)', `${loaded.project.project_id}-${loaded.anchor.anchor_id.toLowerCase()}-1`)
    if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return
    overlay.stop()
    try {
      const { snap, K, pose } = await snapshotWithPose(overlay, video, loaded.anchor)
      const meta = buildSampleMeta({ sample_id: id, label: id, project_id: loaded.project.project_id, anchor_id: loaded.anchor.anchor_id },
        snap.videoW, snap.videoH, K, pose, new Date())
      download(`${id}-photo.jpg`, snap.photo)
      download(`${id}-meta.json`, new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }))
    } catch (e) {
      setCheckError(checkErrorMessage(toCheckError(e)))
    } finally {
      overlay.start()
    }
  }

  // Walk inside: prepare the USDZ for iPhone's AR viewer in the background so the tap opens it at once.
  useEffect(() => {
    if (!loaded || !quickLook) return
    let cancelled = false
    // Prefer the build-time file (a plain URL is Apple's well-trodden route); export in the browser only if it's missing.
    const url = usdzUrl(loaded.project.project_id)
    const id = setTimeout(() => {
      fetch(url, { method: 'HEAD' }).then((r) => {
        if (cancelled) return
        // A missing file comes back as the app's index.html (SPA fallback), so check the type too.
        if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return setUsdz(url)
        const scene = buildWalkScene(loaded.model, (g) => elements.get(g)?.ifc_class ?? '', walkCentre(loaded.anchor, loaded.project), paint)
        return exportUsdz(scene).then((b) => !cancelled && setUsdz(b))
      }).catch(() => undefined)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [loaded, quickLook, elements, paint])

  /** Runs one AR start at a time; the AR buttons are disabled meanwhile (audit A-09). */
  async function xrGuard(run: () => Promise<void>) {
    if (xrBusyRef.current) return
    xrBusyRef.current = true
    xrCancelRef.current = false
    setXrStarting(true)
    try {
      await run()
    } finally {
      xrBusyRef.current = false
      setXrStarting(false)
    }
  }

  function hideXrOverlay() {
    if (xrOverlayRef.current) xrOverlayRef.current.style.display = 'none'
    setXrMode(null)
  }

  /** Exit: end whichever AR session is live; while one is still starting, end it as soon as it starts. */
  function exitXr() {
    if (xrPlaceRef.current) xrPlaceRef.current.end()
    else if (xrStopRef.current) xrStopRef.current()
    else {
      xrCancelRef.current = true
      hideXrOverlay()
    }
  }

  // Android: place by the QR code inside AR (camera-access), then ARCore world-tracking holds it.
  async function startArPlace() {
    if (!loaded || !xrOverlayRef.current) return
    setXrMode('place') // place copy from the first frame, before the session reports its state
    setXrNotice(null)
    xrOverlayRef.current.style.display = 'flex'
    try {
      qrRef.current ??= new QrWorkerClient()
      xrPlaceRef.current = await startXrPlace({
        model: loaded.model, anchor: loaded.anchor, classOf: (g) => elements.get(g)?.ifc_class ?? '', paintOf: paint, qr: qrRef.current,
        qrSizeCorrection: loadQrSizeCorrection(loaded.anchor.anchor_id), overlay: xrOverlayRef.current, onState: setXrPlace,
        onEnd: () => {
          hideXrOverlay()
          xrPlaceRef.current = null
          setXrPlace(null)
        },
      })
      if (xrCancelRef.current) xrPlaceRef.current.end()
    } catch (e) {
      // InvalidStateError: a session is already running; no camera access: life-size models are placed on the
      // floor by tap, with a notice; desk models and anything else: a message, never a silent switch.
      const f = xrFallback(e, isDeskAnchor(loaded.anchor))
      if (!xrPlaceRef.current && !xrStopRef.current) hideXrOverlay()
      if (f.kind === 'walk' && !xrCancelRef.current) await walkInside(f.notice)
      else if (f.kind === 'message') setError(f.message)
    }
  }

  async function walkInside(notice: string | null = null) {
    if (!loaded) return
    if (xrOk && xrOverlayRef.current) {
      // Android Chrome + ARCore: world-tracked walk-through inside TrueSite.
      setXrMode('walk')
      setXrNotice(notice)
      xrOverlayRef.current.style.display = 'flex' // dom-overlay root must be visible when the session starts
      setXrPlaced(false)
      try {
        xrStopRef.current = await startXrWalk({
          model: loaded.model, classOf: (g) => elements.get(g)?.ifc_class ?? '', paintOf: paint, centreIfc: walkCentre(loaded.anchor, loaded.project),
          overlay: xrOverlayRef.current, onPlaced: () => setXrPlaced(true),
          onEnd: () => {
            hideXrOverlay()
            xrStopRef.current = null
          },
        })
        if (xrCancelRef.current) xrStopRef.current()
      } catch {
        hideXrOverlay()
        setError("This phone couldn't start AR. Update Google Play Services for AR (ARCore) and Chrome, then try again.")
      }
      return
    }
    if (quickLook && usdz) {
      // The build-time file, or its distance variant nearest the View distance setting (written by the same build).
      // A file made in the browser is always the full model.
      const setting = walkInsideFirst(loaded.anchor, { quickLook, xrOk }) ? walkRadius : overlayRef.current?.look.state().radiusM ?? null
      const radius = typeof usdz === 'string' && plan ? pickUsdzRadius(setting, plan) : null
      openQuickLook(radius === null ? usdz : usdzUrl(loaded.project.project_id, radius))
    } else if (android) {
      window.location.href = sceneViewerUrl(new URL(loaded.project.model_url, window.location.origin).href, loaded.project.name, window.location.href)
    }
  }
  const canWalk = xrOk || quickLook || android

  const desk = loaded ? isDeskAnchor(loaded.anchor) : false
  // iPhone/iPad on a 1:1 floor code: Walk inside (Quick Look) first, the camera overlay second.
  const walkFirst = loaded ? walkInsideFirst(loaded.anchor, { quickLook, xrOk }) : false
  const cameraLabel = xrOk || walkFirst ? 'Camera overlay' : 'Start camera'
  const walkButton = (className: string) => (
    <button type="button" className={className} onClick={() => void xrGuard(() => walkInside())} disabled={xrStarting || (quickLook && !usdz)}>
      {quickLook && !usdz ? 'Preparing walk-through…' : 'Walk inside (AR)'}
    </button>
  )
  const placeView = xrPlace ?? XR_PLACE_STARTING
  const checkable = loaded ? checkAvailability(loaded.anchor) : { enabled: true, note: null }
  // How far from the code to start: a small desk code must be held closer (audit C-01).
  const startM = loaded ? startDistanceM(loaded.anchor) : 1
  const virtualHref = virtualDemoHref(projectId, anchorId, SITE_VIEWPOINTS.map((v) => v.id))
  const selectFinding = (f: Finding) => setSelectedMark(f.mark)

  // The camera view is full screen: the site's top bar goes while the camera runs (Exit brings it back).
  useEffect(() => {
    document.documentElement.classList.toggle('ar-running', running)
    return () => document.documentElement.classList.remove('ar-running')
  }, [running])

  // Why this sheet can't be checked: shown when the camera starts, and again on a tap of Check as-built.
  const [noteOpen, setNoteOpen] = useState(false)
  const noteTimer = useRef(0)
  const showNote = useCallback(() => {
    setNoteOpen(true)
    clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNoteOpen(false), NOTE_MS)
  }, [])
  useEffect(() => {
    if (running && checkable.note) showNote()
    return () => clearTimeout(noteTimer.current)
  }, [running, checkable.note, showNote])
  // One instruction at a time over the camera. Guidance (once aligned, or while held by the sensors) fades after a few
  // seconds so the model is in full view; a hint that asks for something stays until it's done. Any can be closed.
  const hint = coachHint(state, desk, checkable.enabled, startM)
  const settled = (!!state?.tracking && !state.provisional && !isFar(state.distanceM)) || state?.mode === 'motion'
  const [hiddenHint, setHiddenHint] = useState<string | null>(null)
  // Messages give way to the panels: View, Setup and the results.
  const panelOpen = showControls || calibrating || showResults
  const hintVisible = !checking && !panelOpen && !noteOpen && hint !== hiddenHint
  useEffect(() => { // the fade counts only while the hint is on screen
    if (!settled || !hintVisible) return
    const id = setTimeout(() => setHiddenHint(hint), HINT_FADE_MS)
    return () => clearTimeout(id)
  }, [hint, settled, hintVisible])
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const dismiss = (key: string) => setDismissed((d) => new Set(d).add(key))
  const warning = checkError ? { key: 'check', text: checkError, close: () => setCheckError(null) }
    : state?.qrFailed ? { key: 'qr', text: "The QR reader didn't load. Check your connection and reload.", close: () => dismiss('qr') }
      : state?.otherAnchor && !dismissed.has(`other:${state.otherAnchor.anchorId}`) ? { key: `other:${state.otherAnchor.anchorId}`, text: null, close: () => dismiss(`other:${state.otherAnchor!.anchorId}`) }
        : motionOff && !dismissed.has('motion') ? { key: 'motion', text: MOTION_OFF, close: () => dismiss('motion') }
          : isFar(state?.distanceM ?? null) && !dismissed.has('far') ? { key: 'far', text: 'More than 3 m from the code: the overlay is less accurate.', close: () => dismiss('far') }
            : null

  return (
    <main className={`live-page${running ? '' : ' live-idle'}`}>
      <div ref={xrOverlayRef} className="xr-overlay" style={{ display: 'none' }}>
        {xrMode === 'place' ? (
          <>
            {placeView.phase === 'scanning' ? (
              <div className="xr-scan">
                <svg viewBox="0 0 44 44" className="xr-ring" aria-hidden="true">
                  <circle cx="22" cy="22" r="18" className="xr-ring-bg" />
                  <circle cx="22" cy="22" r="18" className="xr-ring-fg" style={{ strokeDasharray: `${113 * placeView.progress} 113` }} />
                </svg>
                <p className="coach">
                  {placeView.codeSeen ? 'Good. Move slowly left and right, keeping the code in view, until the circle is full.'
                    : 'Point at the QR code from about 1 m away.'}
                </p>
                <p className="note">{placeView.views}/{NEEDED_VIEWS} views · {Math.round(placeView.spreadDeg)}° of angle</p>
              </div>
            ) : (
              <div className="xr-scan">
                <p className="coach">Placed by the code. Walk around and look up: the model stays where it belongs.</p>
                {xrPlaceRef.current && loaded && (
                  <ModelControls look={xrPlaceRef.current.look} maxHeightM={modelSize(loaded.project).height} maxRadiusM={modelSize(loaded.project).span} />
                )}
              </div>
            )}
            <div className="live-start-actions">
              {placeView.phase === 'locked' && <button type="button" className="btn" onClick={() => xrPlaceRef.current?.rescan()}>Re-scan</button>}
              <button type="button" className="btn" onClick={exitXr}>Exit</button>
            </div>
          </>
        ) : (
          <>
            {xrNotice && <p className="live-warning" role="status">{xrNotice}</p>}
            <p className="coach">{xrPlaced ? 'Walk through the model. It stays where you placed it.' : 'Point at the floor until the orange ring appears, then tap to place the model.'}</p>
            <button type="button" className="btn" onClick={exitXr}>Exit</button>
          </>
        )}
      </div>
      <div className="live-stage">
        <video ref={videoRef} className="live-video" playsInline muted autoPlay />
        <div ref={canvasHostRef} />

        {running && (
          <div className="live-top">
            {glDead && <ReloadPrompt />}
            <div className="hud-row">
              <Link to="/#live" className="hud-exit" aria-label="Exit live AR">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              </Link>
              <div className="hud-status">
                {loaded && <ScaleLabel text={scaleLabel(loaded.anchor)} />}
                <QualityBadge state={state} />
              </div>
            </div>
            {warning && !panelOpen && (
              <HudMessage tone="warn" onClose={warning.close} alert={warning.key === 'check' || warning.key === 'qr'}>
                {warning.text ?? (
                  <>This is a different code ({state!.otherAnchor!.anchorId}).{' '}
                    <Link to={`/a/${state!.otherAnchor!.projectId}/${state!.otherAnchor!.anchorId}`}>Switch to it</Link></>
                )}
              </HudMessage>
            )}
            {!checking && !panelOpen && noteOpen && checkable.note && (
              <HudMessage onClose={() => setNoteOpen(false)}>
                {checkable.note}{!checkable.enabled && <> <Link to={virtualHref}>Try the check in the virtual demo</Link></>}
              </HudMessage>
            )}
            {hintVisible && (
              <HudMessage onClose={() => setHiddenHint(hint)}>{hint}</HudMessage>
            )}
          </div>
        )}

        {running && calibrating && overlayRef.current && loaded && (
          <div className="live-calib">
            <CalibrationPanel overlay={overlayRef.current} anchorId={loaded.anchor.anchor_id} qrSizeM={loaded.anchor.qr_size_m}
              onClose={() => setCalibrating(false)} />
          </div>
        )}

        {running && showControls && overlayRef.current && loaded && !showResults && !calibrating && (
          <div className="live-controls">
            <ModelControls look={overlayRef.current.look} maxHeightM={modelSize(loaded.project).height} maxRadiusM={modelSize(loaded.project).span} />
          </div>
        )}

        {running && !showResults && !calibrating && (
          <div className="live-actions">
            <button type="button" className="btn" onClick={() => setCalibrating(true)} aria-label="Camera setup">Setup</button>
            <button type="button" className="btn" onClick={() => setShowControls((v) => !v)} aria-pressed={showControls}>View</button>
            {outcome && <button type="button" className="btn" onClick={() => setShowResults(true)}>Results</button>}
            {dev && <button type="button" className="btn" onClick={saveSample} disabled={!state?.tracking}>Save as sample</button>}
            {/* On a sheet that can't be checked, the button stays tappable and says why. */}
            <button type="button" className={`btn btn-accent${checkable.enabled ? '' : ' btn-unavailable'}`} aria-disabled={!checkable.enabled || undefined}
              onClick={checkable.enabled ? check : showNote} disabled={checking || !state?.tracking}>
              {checking ? 'Checking…' : 'Check as-built'}
            </button>
          </div>
        )}

        {draftFor && (
        <IssueDialog open projectId={loaded?.project.project_id ?? projectId} runId={outcome?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved.') }} />
      )}

        {showResults && outcome && (
          <div className="results-sheet">
            <EvidenceView imageUrl={outcome.photoUrl} result={outcome.result} selectedMark={selectedMark} onSelect={setSelectedMark} />
            <FindingsPanel result={outcome.result} selectedMark={selectedMark} onSelect={selectFinding} onDraftIssue={setDraftFor} onClose={() => setShowResults(false)}
              viewNote={outcome.viewNote} />
            {notice && <p className="note" role="status">{notice}</p>}
          </div>
        )}

        {!running && (
          <div className="live-start panel">
            {!loaded && !error && <p className="status">Loading the project…</p>}
            {error && <p className="status status-error" role="alert">{error}</p>}
            {camStopped && <p className="status" role="status">The camera stopped. Tap {cameraLabel} to continue.</p>}
            {loaded && (
              <>
                <p className="eyebrow">{startLabel(loaded.project.name, loaded.anchor)}</p>
                <h1>Live view · {scaleLabel(loaded.anchor)}</h1>
                <p>
                  {desk
                    ? `The model appears as a 1:${Math.round(1 / loaded.anchor.scale)} scale model beside the code, like an architect's model on the table.`
                    : 'The model appears at real size, lined up with the place where the code is fixed.'}
                </p>
                {walkFirst ? (
                  <ol className="steps">
                    <li>Stand on the code, point the {device} at the ground a step ahead, then tap <strong>Walk inside (AR)</strong>.</li>
                    <li>Walk around freely: the model stays where it was placed.</li>
                    {checkable.enabled && <li>To check the build, use <strong>Camera overlay</strong> and keep the code in view.</li>}
                  </ol>
                ) : xrOk ? (
                  <ol className="steps">
                    <li>Tap <strong>Start AR (place by code)</strong> and allow the camera.</li>
                    <li>Point at the code from about 1 m away, then move slowly left and right until the circle is full.</li>
                    <li>
                      {desk ? 'Walk around the sheet to look at the model.' : 'Walk around and look up: the model stays in place.'}{' '}
                      {checkable.enabled && <>To check the build, use <strong>Camera overlay</strong> instead.</>}
                    </li>
                  </ol>
                ) : desk ? (
                  <ol className="steps">
                    <li>Tap <strong>Start camera</strong> and allow the camera and motion access.</li>
                    <li>Hold the {isAppleMobile() ? device : 'phone'} {aboutDistance(startM)} from the code until it says <strong>Alignment: Good</strong>.</li>
                    <li>Walk around the sheet to look at the model.</li>
                  </ol>
                ) : isLifeSizeFloor(loaded.anchor) ? (
                  <ol className="steps">
                    <li>Tap <strong>Start camera</strong> and allow the camera and motion access.</li>
                    <li>Point at the code from {aboutDistance(startM)} away, then step back slowly, keeping the code in view.</li>
                    <li>Turn slowly on the spot and look up; point back at the code to re-align.{checkable.enabled && ' To check the build, aim at the work and tap Check as-built.'}</li>
                  </ol>
                ) : (
                  <ol className="steps">
                    <li>Tap <strong>Start camera</strong> and allow the camera and motion access.</li>
                    <li>Hold the {isAppleMobile() ? device : 'phone'} upright at chest height, about 0.7 m from the code and a little to one side, until it says <strong>Alignment: Good</strong>.</li>
                    <li>Step back slowly to the marked spot (about 1.5 m), keeping the code in view.</li>
                    <li>
                      Turn slowly on the spot and look up: the model stays level on the ground. Don't walk; come back to the code to re-align.
                      {checkable.enabled && ' To check the build, aim at the work and tap Check as-built.'}
                    </li>
                  </ol>
                )}
                {walkFirst && plan && plan.radii.length > 0 && (
                  <label className="walk-distance">
                    View distance
                    <select value={walkRadius ?? ''} onChange={(e) => setWalkRadius(e.target.value === '' ? null : Number(e.target.value))}>
                      <option value="">All</option>
                      {[...plan.radii].sort((a, b) => b - a).map((r) => <option key={r} value={r}>{r} m around the code</option>)}
                    </select>
                  </label>
                )}
                <div className="live-start-actions">
                  {walkFirst && walkButton('btn btn-primary')}
                  {xrOk && (
                    <button type="button" className="btn btn-primary" onClick={() => void xrGuard(startArPlace)} disabled={xrStarting}>
                      {xrStarting ? 'Starting AR…' : 'Start AR (place by code)'}
                    </button>
                  )}
                  <button type="button" className={xrOk || walkFirst ? 'btn' : 'btn btn-primary'} onClick={start} disabled={starting}>
                    {starting ? 'Starting…' : cameraLabel}
                  </button>
                  {canWalk && !desk && !walkFirst && walkButton('btn btn-accent')}
                </div>
                {walkFirst ? (
                  <p className="note">
                    <strong>Walk inside</strong> opens the model in the {device}'s own AR viewer at 1:1. It places the model on the
                    ground where you point, not on the code itself, so it can sit a little off the sheet.
                  </p>
                ) : canWalk && !desk && (
                  <p className="note">
                    <strong>Walk inside</strong> opens the model in your phone's own AR viewer at 1:1. It stays put while you
                    walk through it. Point at the floor, let it place, then walk in.
                  </p>
                )}
              </>
            )}
            {loaded && (
              <p className="live-virtual">
                <a href={sheetInfo(loaded.anchor).href} download>Download sheet {loaded.anchor.anchor_id}</a>
                {sheetInfo(loaded.anchor).paper && ` (${sheetInfo(loaded.anchor).paper}, PDF)`}
                {SITE_VIEWPOINTS.some((v) => loaded.anchor.project_id === 'site' && v.id === loaded.anchor.anchor_id) && (
                  <> · <Link to={`/samples?at=${loaded.anchor.anchor_id}`}>Try {loaded.anchor.anchor_id} in the virtual demo</Link></>
                )}
              </p>
            )}
            {!handheld && loaded && (
              <p className="live-device-note">Made for tablets and smartphones: open this page on one for the best experience.</p>
            )}
            {camError && <p className="status status-error" role="alert">{CAMERA_ERRORS[camError]}</p>}
            {(camError || error) && (
              <p className="live-links">
                <Link to={projectMissing ? '/model' : viewerPathFor(projectId)} className="btn">Open the model viewer</Link> <Link to={virtualHref} className="btn">Try the virtual demo</Link>
              </p>
            )}
          </div>
        )}
      </div>
      {!handheld && (
        <DeviceTip url={window.location.href} anchor={loaded?.anchor ?? null} onLeave={leaveLive}
          virtualHref={projectId === 'site' && SITE_VIEWPOINTS.some((v) => v.id === anchorId) ? `/samples?at=${anchorId}` : '/#virtual'} />
      )}
    </main>
  )
}

/** Guidance fades this long after it appears once the overlay is aligned. */
const HINT_FADE_MS = 6000
/** The "nothing to check on this sheet" note shows this long. */
const NOTE_MS = 6000
/** Motion & Orientation refused (audit C-15). iOS keeps the answer until the browser is closed. */
const MOTION_OFF = "Motion & Orientation is off, so the model won't stay level or stay in place when you turn. "
  + 'To allow it, close the browser, open this page again and tap Allow.'

/** "Life size · 1:1" in the status pill; narrow phones show just "1:1". */
function ScaleLabel({ text }: { text: string }) {
  const [word, ratio] = text.split(' · ')
  return <span className="hud-scale">{ratio ? <><span className="hud-wide">{word} · </span>{ratio}</> : text}</span>
}

/** One closable message over the camera view (dark, so the model stays visible around it). */
function HudMessage({ children, onClose, tone, alert }: { children: ReactNode; onClose: () => void; tone?: 'warn'; alert?: boolean }) {
  return (
    <div className={`hud-msg${tone ? ` hud-msg-${tone}` : ''}`} role={alert ? 'alert' : 'status'}>
      <p>{children}</p>
      <button type="button" className="hud-msg-close" onClick={onClose} aria-label="Close this message">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Where the walk-through model is placed: a floor code's spot, else the middle of the model's footprint. */
function walkCentre(anchor: Anchor, project: ProjectManifest): [number, number] {
  if (anchor.normal[2] > 0.9) return [anchor.position_m[0], anchor.position_m[1]]
  const xs = project.elements.flatMap((e) => [e.bbox_m[0][0], e.bbox_m[1][0]])
  const ys = project.elements.flatMap((e) => [e.bbox_m[0][1], e.bbox_m[1][1]])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Model height (IFC Z, m) and horizontal span (footprint diagonal, m) for the view controls. */
function modelSize(project: ProjectManifest): { height: number; span: number } {
  const b = project.elements.map((e) => e.bbox_m)
  const min = (i: number) => Math.min(...b.map((x) => x[0][i]))
  const max = (i: number) => Math.max(...b.map((x) => x[1][i]))
  return { height: max(2), span: Math.hypot(max(0) - min(0), max(1) - min(1)) }
}

/** "Building under construction · P2 Under the slab": the project and the sheet, short enough for one line. */
function startLabel(projectName: string, anchor: Anchor): string {
  const name = projectName.replace(/\s*\(1:1\)$/, '')
  const vp = anchor.project_id === 'site' ? SITE_VIEWPOINTS.find((v) => v.id === anchor.anchor_id) : undefined
  return `${name} · ${vp ? `${vp.id} ${vp.name}` : anchor.anchor_id}`
}
