import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getProject } from '../api/client'
import type { Anchor, CheckResult, Finding, ProjectManifest } from '../api/types'
import { CameraError, startRearCamera, stopCamera, type CameraStart } from '../camera/camera'
import { isCalibrated, loadQrSizeCorrection } from '../camera/intrinsics'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage } from '../check/messages'
import { runCheck } from '../check/runCheck'
import { buildSampleMeta } from '../check/sampleMeta'
import { captureSnapshot, type Snapshot } from '../check/snapshot'
import { estimatePose, type Intrinsics, type Pose, type Point2, type Quality } from '../pose'
import { QrWorkerClient } from '../qr/qrClient'
import { coachHint, effectiveQrSize, findAnchor, isDeskAnchor, isFar, scaleLabel } from '../scene/arMath'
import { makeEvalMarkers, parseEvalPoints } from '../scene/evalMarkers'
import { disposePins, makePins } from '../scene/pins'
import { buildWalkScene, canQuickLook, exportUsdz, isAndroid, isAppleMobile, openQuickLook, sceneViewerUrl, usdzUrl } from '../scene/walkthrough'
import { startXrWalk, xrArSupported } from '../scene/xrWalk'
import { NEEDED_VIEWS, startXrPlace, type XrPlaceSession, type XrPlaceState } from '../scene/xrPlace'
import { ModelControls } from './ModelControls'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { createOverlay, type Overlay, type OverlayState } from '../scene/overlay'
import { CalibrationPanel } from './CalibrationPanel'
import { EvidenceView } from './EvidenceView'
import { FindingsPanel } from './FindingsPanel'
import { IssueDialog } from './IssueDialog'
import { Link } from './Link'
import { QualityBadge } from './QualityBadge'

export type LivePageProps = { projectId: string; anchorId: string }

type Loaded = { project: ProjectManifest; anchor: Anchor; model: LoadedModel }
type Outcome = { result: CheckResult; runId: string | null; photoUrl: string }

const CAMERA_ERRORS: Record<CameraError['kind'], string> = {
  insecure: 'The camera only works over a secure (https) connection. Open the https link instead.',
  denied: 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
  notfound: 'No camera was found on this device.',
  overconstrained: "The camera couldn't start with the settings we need. Try another browser.",
  other: "The camera couldn't start. Close other apps that use it and try again.",
}

/** Live AR: the model over the camera view, anchored by the QR code (spec 4.1, 4.2). */
export function LivePage({ projectId, anchorId }: LivePageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<Overlay | null>(null)
  const camRef = useRef<CameraStart | null>(null)
  const qrRef = useRef<QrWorkerClient | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [camError, setCamError] = useState<CameraError['kind'] | null>(null)
  const [starting, setStarting] = useState(false)
  const [running, setRunning] = useState(false)
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
  const quickLook = useMemo(() => isAppleMobile() && canQuickLook(), [])
  const android = useMemo(() => isAndroid(), [])
  const [xrOk, setXrOk] = useState(false)
  const [xrPlaced, setXrPlaced] = useState(false)
  const xrOverlayRef = useRef<HTMLDivElement>(null)
  const xrStopRef = useRef<(() => void) | null>(null)
  const xrPlaceRef = useRef<XrPlaceSession | null>(null)
  const [xrPlace, setXrPlace] = useState<XrPlaceState | null>(null)
  useEffect(() => {
    void xrArSupported().then(setXrOk)
  }, [])
  const pinsRef = useRef<ReturnType<typeof makePins> | null>(null)
  const elements = useMemo(() => new Map((loaded?.project.elements ?? []).map((e) => [e.guid, e])), [loaded])

  useEffect(() => {
    let cancelled = false
    let model: LoadedModel | null = null
    ;(async () => {
      const project = await getProject(projectId)
      const anchor = findAnchor(project, anchorId)
      if (!anchor) throw new Error("This QR code isn't set up for this project.")
      model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
      if (new URLSearchParams(window.location.search).has('eval')) {
        // ?eval=1: green crosses at the surveyed points in web/public/eval/points.json (spec 10)
        const points = parseEvalPoints(await fetch('/eval/points.json').then((r) => (r.ok ? r.json() : [])).catch(() => []))
        model.ifcRoot.add(makeEvalMarkers(points))
      }
      if (cancelled) disposeModel(model)
      else setLoaded({ project, anchor, model })
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error && e.message.startsWith('This QR') ? e.message : "Couldn't load the project. Check your connection and try again.")
    })
    return () => {
      cancelled = true
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
    const canvas = canvasRef.current
    if (!loaded || !video || !canvas || starting) return
    setStarting(true)
    setCamError(null)
    try {
      const motion = await requestMotionPermission() // iOS asks inside this tap; must come before the camera prompt
      camRef.current = await startRearCamera(video)
      qrRef.current = new QrWorkerClient()
      const overlay = createOverlay({
        video, canvas, model: loaded.model, anchor: loaded.anchor, qr: qrRef.current,
        qrSizeCorrection: loadQrSizeCorrection(loaded.anchor.anchor_id), origin: window.location.origin,
        classOf: (guid) => elements.get(guid)?.ifc_class ?? '', motion,
      })
      overlay.onState(setState)
      overlay.start()
      overlayRef.current = overlay
      setRunning(true)
      if (!isCalibrated(camRef.current.width, camRef.current.height)) setCalibrating(true) // first use on this camera
    } catch (e) {
      setCamError(e instanceof CameraError ? e.kind : 'other')
      stopCamera(camRef.current, video)
      camRef.current = null
    } finally {
      setStarting(false)
    }
  }

  /** Snapshot + pose on the full frame (the last raw pose is the flip prior). Throws no_pose if the code is not in view. */
  async function snapshotWithPose(overlay: Overlay, video: HTMLVideoElement, anchor: Anchor): Promise<{ snap: Snapshot; K: Intrinsics; pose: Pose; quality: Quality }> {
    const last = overlay.lastRaw()
    const snap = await captureSnapshot(video, qrRef.current ?? undefined)
    const K = overlay.intrinsics()
    const s = effectiveQrSize(anchor, loadQrSizeCorrection(anchor.anchor_id))
    let pose: Pose | null = null
    let quality: Quality = last?.quality ?? 'poor'
    if (snap.corners) {
      const est = estimatePose(snap.corners.map((p) => [p.x, p.y] as Point2), s, K, last?.pose ?? null)
      if (est) {
        pose = { R: est.R, t: est.t }
        quality = est.quality
      }
    }
    if (!pose && last && performance.now() / 1000 - last.tSec < 0.5) pose = last.pose
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
      })
      if (!res.response) throw res.error ?? new ApiError('check failed', 0)
      const result = res.response.result
      if (outcome) URL.revokeObjectURL(outcome.photoUrl)
      setOutcome({ result, runId: res.response.run_id, photoUrl: URL.createObjectURL(snap.photo) })
      setShowResults(true)
      setSelectedMark(null)
      if (pinsRef.current) disposePins(pinsRef.current)
      pinsRef.current = makePins(result.findings, elements)
      loaded.model.ifcRoot.add(pinsRef.current)
      saveLastCheck(loaded.project.project_id, { result, runId: res.response.run_id, at: new Date().toISOString() })
    } catch (e) {
      setCheckError(checkErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)))
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
      setCheckError(checkErrorMessage(e instanceof ApiError ? e : new ApiError(String(e), 0)))
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
        if (r.ok) return setUsdz(url)
        const scene = buildWalkScene(loaded.model, (g) => elements.get(g)?.ifc_class ?? '', walkCentre(loaded.anchor, loaded.project))
        return exportUsdz(scene).then((b) => !cancelled && setUsdz(b))
      }).catch(() => undefined)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [loaded, quickLook, elements])

  // Android: place by the QR code inside AR (camera-access), then ARCore world-tracking holds it.
  async function startArPlace() {
    if (!loaded || !xrOverlayRef.current) return
    xrOverlayRef.current.style.display = 'flex'
    try {
      qrRef.current ??= new QrWorkerClient()
      xrPlaceRef.current = await startXrPlace({
        model: loaded.model, anchor: loaded.anchor, classOf: (g) => elements.get(g)?.ifc_class ?? '', qr: qrRef.current,
        qrSizeCorrection: loadQrSizeCorrection(loaded.anchor.anchor_id), overlay: xrOverlayRef.current, onState: setXrPlace,
        onEnd: () => {
          if (xrOverlayRef.current) xrOverlayRef.current.style.display = 'none'
          xrPlaceRef.current = null
          setXrPlace(null)
        },
      })
    } catch {
      // No camera access in AR on this phone: life-size models fall back to placing on the floor by tap;
      // a desk model can't be placed without the code (audit A-03).
      xrOverlayRef.current.style.display = 'none'
      if (isDeskAnchor(loaded.anchor)) setError("This phone can't read the code inside AR. Use Camera overlay for the desk model.")
      else await walkInside()
    }
  }

  async function walkInside() {
    if (!loaded) return
    if (xrOk && xrOverlayRef.current) {
      // Android Chrome + ARCore: world-tracked walk-through inside TrueSite.
      xrOverlayRef.current.style.display = 'flex' // dom-overlay root must be visible when the session starts
      setXrPlaced(false)
      try {
        xrStopRef.current = await startXrWalk({
          model: loaded.model, classOf: (g) => elements.get(g)?.ifc_class ?? '', centreIfc: walkCentre(loaded.anchor, loaded.project),
          overlay: xrOverlayRef.current, onPlaced: () => setXrPlaced(true),
          onEnd: () => {
            if (xrOverlayRef.current) xrOverlayRef.current.style.display = 'none'
            xrStopRef.current = null
          },
        })
      } catch {
        xrOverlayRef.current.style.display = 'none'
        setError("This phone couldn't start AR. Update Google Play Services for AR (ARCore) and Chrome, then try again.")
      }
      return
    }
    if (quickLook && usdz) openQuickLook(usdz)
    else if (android) {
      window.location.href = sceneViewerUrl(new URL(loaded.project.model_url, window.location.origin).href, loaded.project.name, window.location.href)
    }
  }
  const canWalk = xrOk || quickLook || android

  const desk = loaded ? isDeskAnchor(loaded.anchor) : false
  const selectFinding = (f: Finding) => setSelectedMark(f.mark)

  return (
    <main className="live-page">
      <div ref={xrOverlayRef} className="xr-overlay" style={{ display: 'none' }}>
        {xrPlace ? (
          <>
            {xrPlace.phase === 'scanning' ? (
              <div className="xr-scan">
                <svg viewBox="0 0 44 44" className="xr-ring" aria-hidden="true">
                  <circle cx="22" cy="22" r="18" className="xr-ring-bg" />
                  <circle cx="22" cy="22" r="18" className="xr-ring-fg" style={{ strokeDasharray: `${113 * xrPlace.progress} 113` }} />
                </svg>
                <p className="coach">
                  {xrPlace.codeSeen ? 'Good. Move slowly left and right, keeping the code in view, until the circle is full.'
                    : 'Point at the QR code from about 1 m away.'}
                </p>
                <p className="note">{xrPlace.views}/{NEEDED_VIEWS} views · {Math.round(xrPlace.spreadDeg)}° of angle</p>
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
              {xrPlace.phase === 'locked' && <button type="button" className="btn" onClick={() => xrPlaceRef.current?.rescan()}>Re-scan</button>}
              <button type="button" className="btn" onClick={() => xrPlaceRef.current?.end()}>Exit</button>
            </div>
          </>
        ) : (
          <>
            <p className="coach">{xrPlaced ? 'Walk through the model. It stays where you placed it.' : 'Point at the floor until the orange ring appears, then tap to place the model.'}</p>
            <button type="button" className="btn" onClick={() => xrStopRef.current?.()}>Exit</button>
          </>
        )}
      </div>
      <div className="live-stage">
        <video ref={videoRef} className="live-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="live-canvas" aria-label="Model overlay" />

        {running && (
          <div className="live-top">
            <div className="live-chips">
              {loaded && <span className="mode-chip">{scaleLabel(loaded.anchor)}</span>}
              <QualityBadge state={state} />
            </div>
            {!checking && <p className="coach">{coachHint(state, desk)}</p>}
            {isFar(state?.distanceM ?? null) && <p className="live-warning">More than 3 m from the code: the overlay is less accurate.</p>}
            {state?.otherAnchor && (
              <p className="live-warning">
                This is a different code ({state.otherAnchor.anchorId}).{' '}
                <Link to={`/a/${state.otherAnchor.projectId}/${state.otherAnchor.anchorId}`}>Switch to it</Link>
              </p>
            )}
            {checkError && <p className="live-warning" role="alert">{checkError}</p>}
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
            {outcome && <button type="button" className="btn" onClick={() => setShowResults(true)}>Last results</button>}
            {dev && <button type="button" className="btn" onClick={saveSample} disabled={!state?.tracking}>Save as sample</button>}
            <button type="button" className="btn btn-accent" onClick={check} disabled={checking || !state?.tracking}>
              {checking ? 'Checking…' : 'Check as-built'}
            </button>
          </div>
        )}

        {draftFor && (
        <IssueDialog open projectId={loaded?.project.project_id ?? projectId} runId={outcome?.runId ?? null} mark={draftFor.mark} finding={draftFor}
          element={elements.get(draftFor.guid) ?? null} onClose={() => setDraftFor(null)}
          onSaved={() => { setDraftFor(null); setNotice('Issue saved. See it under Issues.') }} />
      )}

        {showResults && outcome && (
          <div className="results-sheet">
            <EvidenceView imageUrl={outcome.photoUrl} result={outcome.result} selectedMark={selectedMark} onSelect={setSelectedMark} />
            <FindingsPanel result={outcome.result} selectedMark={selectedMark} onSelect={selectFinding} onDraftIssue={setDraftFor} onClose={() => setShowResults(false)} />
            {notice && <p className="note" role="status">{notice}</p>}
          </div>
        )}

        {!running && (
          <div className="live-start panel">
            {!loaded && !error && <p className="status">Loading the project…</p>}
            {error && <p className="status status-error" role="alert">{error}</p>}
            {loaded && (
              <>
                <p className="eyebrow">{loaded.project.name} · {loaded.anchor.label || loaded.anchor.anchor_id}</p>
                <h1>Live view · {scaleLabel(loaded.anchor)}</h1>
                <p>
                  {desk
                    ? 'The model appears as a 1:20 scale model beside the code, like an architect\'s model on the table.'
                    : 'The model appears at real size, lined up with the place where the code is fixed.'}
                </p>
                <ol className="steps">
                  <li>Tap <strong>Start camera</strong> and allow the camera.</li>
                  <li>Point at the code from under 1 m away, then step back slowly.</li>
                  <li>{desk ? 'Walk around the sheet to look at the model.' : 'Aim at the work and tap Check as-built.'}</li>
                </ol>
                <div className="live-start-actions">
                  {xrOk && (
                    <button type="button" className="btn btn-primary" onClick={() => void startArPlace()}>Start AR (place by code)</button>
                  )}
                  <button type="button" className={xrOk ? 'btn' : 'btn btn-primary'} onClick={start} disabled={starting}>
                    {starting ? 'Starting…' : xrOk ? 'Camera overlay' : 'Start camera'}
                  </button>
                  {canWalk && !desk && (
                    <button type="button" className="btn btn-accent" onClick={walkInside} disabled={quickLook && !usdz}>
                      {quickLook && !usdz ? 'Preparing walk-through…' : 'Walk inside (AR)'}
                    </button>
                  )}
                </div>
                {canWalk && !desk && (
                  <p className="note">
                    <strong>Walk inside</strong> opens the model in your phone's own AR viewer at 1:1. It stays put while you
                    walk through it. Point at the floor, let it place, then walk in.
                  </p>
                )}
              </>
            )}
            {camError && <p className="status status-error" role="alert">{CAMERA_ERRORS[camError]}</p>}
            {(camError || error) && (
              <p className="live-links">
                <Link to="/model" className="btn">Open the model viewer</Link> <Link to="/samples" className="btn">Try sample photos</Link>
              </p>
            )}
          </div>
        )}
      </div>
    </main>
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

/** Motion sensors for look-around. iOS needs an explicit permission from a tap; others just work. */
async function requestMotionPermission(): Promise<boolean> {
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
  if (!DOE) return false
  if (typeof DOE.requestPermission !== 'function') return true
  try {
    return (await DOE.requestPermission()) === 'granted'
  } catch {
    return false
  }
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
