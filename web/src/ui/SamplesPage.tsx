import { useEffect, useMemo, useRef, useState } from 'react'
import { Scene, WebGLRenderer } from 'three'
import { ApiError, getProject } from '../api/client'
import type { CheckResult, Finding, ProjectManifest } from '../api/types'
import { saveLastCheck } from '../check/lastCheck'
import { checkErrorMessage } from '../check/messages'
import { runCheck } from '../check/runCheck'
import { parseSampleIndex, parseSampleMeta, type SampleIndexEntry } from '../check/sampleMeta'
import { findAnchor } from '../scene/arMath'
import { disposeModel, loadModel, type LoadedModel } from '../scene/loadModel'
import { navigate } from '../router'
import { EvidenceView } from './EvidenceView'
import { FindingsPanel } from './FindingsPanel'
import { Link } from './Link'

type Loaded = { project: ProjectManifest; model: LoadedModel; renderer: WebGLRenderer; scene: Scene }
type Outcome = { result: CheckResult; photoUrl: string; saved: boolean }

async function getJsonFile(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Sample-photo mode (spec 2, criterion 1): judges without a printer run the real check on photos
 * we captured with the app, each with its stored camera pose. Runs off-screen; no camera needed.
 */
export function SamplesPage() {
  const [samples, setSamples] = useState<SampleIndexEntry[] | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [selectedMark, setSelectedMark] = useState<number | null>(null)
  const loadedRef = useRef<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    getJsonFile('/samples/index.json')
      .then((json) => !cancelled && setSamples(parseSampleIndex(json)))
      .catch(() => !cancelled && setSamples([]))
    return () => {
      cancelled = true
      const l = loadedRef.current
      if (l) {
        disposeModel(l.model)
        l.renderer.dispose()
      }
    }
  }, [])

  async function ensureLoaded(projectId: string): Promise<Loaded> {
    if (loadedRef.current?.project.project_id === projectId) return loadedRef.current
    const project = await getProject(projectId)
    const model = await loadModel(project.model_url, new Set(project.elements.map((e) => e.guid)))
    const renderer = new WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false })
    const scene = new Scene()
    scene.add(model.ifcRoot)
    const l = { project, model, renderer, scene }
    loadedRef.current = l
    setLoaded(l)
    return l
  }

  async function check(sample: SampleIndexEntry) {
    setRunning(sample.sample_id)
    setError(null)
    setSelectedMark(null)
    try {
      const base = `/samples/${sample.sample_id}`
      const [meta, photo] = await Promise.all([
        getJsonFile(`${base}/meta.json`).then(parseSampleMeta),
        fetch(`${base}/photo.jpg`).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      ])
      const l = await ensureLoaded(meta.project_id)
      const anchor = findAnchor(l.project, meta.anchor_id)
      if (!anchor) throw new Error('This sample belongs to an anchor that no longer exists.')
      const bitmap = await createImageBitmap(photo)
      const res = await runCheck({
        photo, photoW: bitmap.width, photoH: bitmap.height, videoW: meta.video_w, videoH: meta.video_h, K: meta.K, pose: meta.pose,
        anchor, poseQuality: 'good', model: l.model, scene: l.scene, renderer: l.renderer,
        elements: new Map(l.project.elements.map((e) => [e.guid, e])), sampleId: meta.sample_id,
      })
      bitmap.close()
      const result = res.response?.result ?? res.saved
      if (!result) throw res.error ?? new ApiError('check failed', 0)
      if (outcome) URL.revokeObjectURL(outcome.photoUrl)
      setOutcome({ result, photoUrl: URL.createObjectURL(photo), saved: !res.response })
      saveLastCheck(meta.project_id, { result, runId: res.response?.run_id ?? null, at: new Date().toISOString() })
    } catch (e) {
      setError(e instanceof ApiError ? checkErrorMessage(e) : e instanceof Error ? e.message : 'Check failed — try again.')
    } finally {
      setRunning(null)
    }
  }

  const selectFinding = (f: Finding) => setSelectedMark(f.mark)
  const ready = useMemo(() => samples ?? [], [samples])

  return (
    <main className="page samples-page">
      <h1>Sample photos</h1>
      <p>
        No printer or site needed: these photos were taken with TrueSite in our demo room and on our 1:20 model, with the
        deviations staged on purpose. Tap one to run the real as-built check.
      </p>
      {samples === null && <p className="status">Loading samples…</p>}
      {samples !== null && ready.length === 0 && <p className="status">No sample photos yet.</p>}
      <ul className="sample-list">
        {ready.map((s) => (
          <li key={s.sample_id}>
            <button type="button" className="btn" disabled={running !== null} onClick={() => check(s)}>
              {running === s.sample_id ? 'Checking…' : s.label}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="status status-error" role="alert">{error}</p>}
      {outcome && (
        <div className="sample-results">
          <EvidenceView imageUrl={outcome.photoUrl} result={outcome.result} selectedMark={selectedMark} onSelect={setSelectedMark} />
          <FindingsPanel result={outcome.result} selectedMark={selectedMark} onSelect={selectFinding} />
          <p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>See the pins on the 3D model</button>
          </p>
        </div>
      )}
      {loaded === null && outcome === null && <p className="note"><Link to="/">Open the model viewer</Link></p>}
    </main>
  )
}
