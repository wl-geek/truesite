// Sample photos (contract section 8): public/samples/index.json + <sample_id>/{photo.jpg, meta.json}.
import type { Intrinsics, Pose } from '../pose'

export type SampleIndexEntry = {
  sample_id: string; label: string; project_id: string; anchor_id: string
  /** A rendered stand-in for a site photo (scripts/make-samples.mjs), not a real one. */
  simulated?: boolean
  /** What was staged wrong on purpose, in plain words, so a reader can compare the findings with the truth. */
  staged?: string[]
}
export type SampleMeta = SampleIndexEntry & { video_w: number; video_h: number; K: Intrinsics; pose: Pose; captured_at: string }

const SAMPLE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ANCHOR_RE = /^[A-Za-z0-9_-]{1,16}$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(finite)

function entry(v: unknown): SampleIndexEntry | null {
  if (!isObj(v)) return null
  const { sample_id, label, project_id, anchor_id } = v
  if (typeof sample_id !== 'string' || !SAMPLE_RE.test(sample_id)) return null
  if (typeof project_id !== 'string' || !PROJECT_RE.test(project_id)) return null
  if (typeof anchor_id !== 'string' || !ANCHOR_RE.test(anchor_id)) return null
  const out: SampleIndexEntry = { sample_id, project_id, anchor_id, label: typeof label === 'string' && label ? label : sample_id }
  if (v.simulated === true) out.simulated = true
  if (Array.isArray(v.staged)) out.staged = v.staged.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 12)
  return out
}

/** index.json rows that are valid; anything else is skipped. */
export function parseSampleIndex(json: unknown): SampleIndexEntry[] {
  return Array.isArray(json) ? json.map(entry).filter((e): e is SampleIndexEntry => e !== null) : []
}

export function parseSampleMeta(json: unknown): SampleMeta {
  const base = entry(json)
  if (!base || !isObj(json)) throw new Error('meta.json: bad ids')
  const { video_w, video_h, K, pose, captured_at } = json
  if (!finite(video_w) || !finite(video_h) || video_w <= 0 || video_h <= 0) throw new Error('meta.json: bad video size')
  if (!isObj(K) || !finite(K.f) || K.f <= 0 || !finite(K.cx) || !finite(K.cy)) throw new Error('meta.json: bad intrinsics')
  if (!isObj(pose) || !nums(pose.R, 9) || !nums(pose.t, 3) || pose.t[2] <= 0) throw new Error('meta.json: bad pose')
  return {
    ...base, video_w, video_h, K: { f: K.f, cx: K.cx, cy: K.cy },
    pose: { R: pose.R, t: [pose.t[0], pose.t[1], pose.t[2]] }, captured_at: typeof captured_at === 'string' ? captured_at : '',
  }
}

export function buildSampleMeta(e: SampleIndexEntry, videoW: number, videoH: number, K: Intrinsics, pose: Pose, at: Date): SampleMeta {
  return { ...e, video_w: videoW, video_h: videoH, K: { ...K }, pose: { R: [...pose.R], t: [...pose.t] as Pose['t'] }, captured_at: at.toISOString() }
}
