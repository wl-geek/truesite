import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getProject } from '../api/client'
import type { Anchor, CheckResult, Finding, ProjectManifest } from '../api/types'
import { CameraError, startRearCamera, stopCamera, type CameraStart } from '../camera/camera'
import { loadQrSizeCorrection } from '../camera/intrinsics'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage } from '../check/messages'
import { runCheck } from '../check/runCheck'
import { buildSampleMeta } from '../check/sampleMeta'
import { captureSnapshot, type Snapshot } from '../check/snapshot'
import { estimatePose, type Intrinsics, type Pose, type Point2, type Quality } from '../pose'
import { QrWorkerClient } from '../qr/qrClient'
import { effectiveQrSize, findAnchor, isDeskAnchor, isFar } from '../scene/arMath'
import { disposePins, makePins } from '../scene/pins'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { createOverlay, type Overlay, type OverlayState } from '../scene/overlay'
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
      camRef.current = await startRearCamera(video)
      qrRef.current = new QrWorkerClient()
      const overlay = createOverlay({
        video, canvas, model: loaded.model, anchor: loaded.anchor, qr: qrRef.current,
        qrSizeCorrection: loadQrSizeCorrection(loaded.anchor.anchor_id), origin: window.location.origin,
      })
      overlay.onState(setState)
      overlay.start()
      overlayRef.current = overlay
      setRunning(true)
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

  // Dev only (?dev=1): download photo.jpg + meta.json for public/samples/<sample_id>/ (contract section 8).
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

  const desk = loaded ? isDeskAnchor(loaded.anchor) : false
  const selectFinding = (f: Finding) => setSelectedMark(f.mark)

  return (
    <main className="live-page">
      <div className="live-stage">
        <video ref={videoRef} className="live-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="live-canvas" aria-label="Model overlay" />

        {running && (
          <div className="live-top">
            <QualityBadge state={state} />
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

        {running && !showResults && (
          <div className="live-actions">
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
                <h1>Live view</h1>
                <p>
                  Point the camera at the printed QR code. Start within about 1 m of it, then step back.
                  {desk && ' Desk mode: the model appears at 1:20 next to the code.'}
                </p>
                <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
                  {starting ? 'Starting…' : 'Start camera'}
                </button>
              </>
            )}
            {camError && <p className="status status-error" role="alert">{CAMERA_ERRORS[camError]}</p>}
            {(camError || error) && (
              <p className="live-links">
                <Link to="/" className="btn">Open the model viewer</Link> <Link to="/samples" className="btn">Try sample photos</Link>
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
