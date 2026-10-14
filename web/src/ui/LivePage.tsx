import { useEffect, useRef, useState } from 'react'
import { getProject } from '../api/client'
import type { Anchor, ProjectManifest } from '../api/types'
import { CameraError, startRearCamera, stopCamera, type CameraStart } from '../camera/camera'
import { loadQrSizeCorrection } from '../camera/intrinsics'
import { QrWorkerClient } from '../qr/qrClient'
import { findAnchor, isDeskAnchor, isFar } from '../scene/arMath'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { createOverlay, type Overlay, type OverlayState } from '../scene/overlay'
import { Link } from './Link'
import { QualityBadge } from './QualityBadge'

export type LivePageProps = { projectId: string; anchorId: string }

type Loaded = { project: ProjectManifest; anchor: Anchor; model: LoadedModel }

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

  const desk = loaded ? isDeskAnchor(loaded.anchor) : false

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
