/**
 * Wire types: field-for-field mirrors of server/app/schemas.py (contract section 5).
 * JSON stays snake_case; datetimes arrive as ISO strings.
 */

/** [ymin, xmin, ymax, xmax], integers 0..1000, rows top-down (Gemini convention). */
export type Box = [number, number, number, number]
export type Vec3 = [number, number, number]

export type Status = 'present_ok' | 'missing' | 'misplaced' | 'different_from_design' | 'cannot_judge'
export type ImageQuality = 'good' | 'too_dark' | 'blurred' | 'marker_far' | 'occluded'
export type PoseQuality = 'good' | 'fair' | 'poor'
export type Direction = 'left' | 'right' | 'up' | 'down' | 'forward' | 'back' | 'none'
export type Severity = 'high' | 'medium' | 'low'
/** Where a check came from: the virtual demo, the ready-made sample photos, or the live camera. */
export type CheckSource = 'virtual' | 'live' | 'sample'
/** A person's decision on one finding: the deviation is real, or it was a false alarm. */
export type ReviewDecision = 'confirmed' | 'dismissed'

export const DEMO_SESSION = 'demo'

// ---- project data -------------------------------------------------------------------------
/** One elements.json row. bbox_m: [[minX, minY, minZ], [maxX, maxY, maxZ]] in IFC metres, Z up. */
export interface Element {
  guid: string
  ifc_class: string
  name: string
  storey: string
  bbox_m: [Vec3, Vec3]
  load_bearing: boolean | null
  props: Record<string, unknown>
}

/** One anchors.json row: QR centre, outward normal and the code's top-edge direction, IFC coordinates. */
export interface Anchor {
  anchor_id: string
  project_id: string
  qr_size_m: number
  position_m: Vec3
  normal: Vec3
  up: Vec3
  scale: number
  label: string
}

export interface ProjectManifest {
  project_id: string
  name: string
  model_url: string
  elements: Element[]
  anchors: Anchor[]
}

// ---- as-built check -------------------------------------------------------------------------
/** The server's VisibleElement (one numbered mark), renamed so it does not clash with scene/elements.ts. */
export interface MarkedElement {
  mark: number
  guid: string
  ifc_class: string
  name: string
  box: Box
  key_dims: string
}

export interface CheckContext {
  project_id: string
  anchor_id: string
  pose_quality: PoseQuality
  distance_m: number
  visible: MarkedElement[]
  sample_id?: string | null
  /** Stored in the run's provenance; the server trusts it for nothing else. */
  source?: CheckSource | null
}

export interface Offset {
  direction: Direction
  approx_cm: number
}

export interface Finding {
  mark: number
  guid: string
  name: string
  ifc_class: string
  status: Status
  confidence: number
  evidence_box: Box | null
  offset: Offset | null
  explanation: string
  severity: Severity | null
}

export interface UnexpectedItem {
  evidence_box: Box | null
  description: string
  confidence: number
  severity: 'medium'
}

export interface Usage {
  prompt_tokens: number
  output_tokens: number
  thought_tokens: number
  total_tokens: number
  cost_usd_est: number
}

export interface CheckResult {
  project_id: string
  anchor_id: string
  image_quality: ImageQuality
  pose_quality: PoseQuality
  findings: Finding[]
  unexpected: UnexpectedItem[]
  summary: string
  warnings: string[]
  usage: Usage | null
  model_version: string | null
  /** ISO time; set only on /api/saved-results responses ("Saved result from <date>"). */
  saved_at: string | null
}

export interface CheckResponse {
  run_id: string
  saved: boolean
  photo_url: string | null
  result: CheckResult
}

/**
 * POST /api/check's `event: first_look`: with the close-up second look on, the first pass (repaired, with severity) as
 * soon as it answers, and the marks the second look is still settling. The CheckResponse (`event: done`) follows.
 */
export interface FirstLook {
  result: CheckResult
  pending: number[]
}

/** Server-side record of one check (never sent to the browser as is; mirrored for completeness). */
export interface CheckRun {
  run_id: string
  session_id: string
  project_id: string
  anchor_id: string
  created_at: string
  context: Record<string, unknown>
  result: Record<string, unknown>
  photo_key: string
  render_key: string
  overlay_key: string | null
  duration_ms: number | null
  provenance: Provenance | null
  review: Record<string, FindingReview>
}

// ---- the Checks page ------------------------------------------------------------------------------
/** A person's decision on one finding, stamped with the server's time (ISO). */
export interface FindingReview {
  decision: ReviewDecision
  at: string
}

/** What the server received for a check: the audit trail. source, pose_quality and distance_m are the client's word. */
export interface Provenance {
  photo_sha256: string
  render_sha256: string
  overlay_sha256: string | null
  received_at: string
  app_version: string
  source: CheckSource | null
  pose_quality: PoseQuality | null
  distance_m: number | null
}

export interface StatusCounts {
  present_ok: number
  missing: number
  misplaced: number
  different_from_design: number
  cannot_judge: number
}

export interface SeverityCounts {
  high: number
  medium: number
  low: number
}

/** One row of GET /api/runs. Flagged findings are the deviations: those with a severity. */
export interface RunSummary {
  run_id: string
  created_at: string
  project_id: string
  anchor_id: string
  source: CheckSource | null
  image_quality: ImageQuality | null
  by_status: StatusCounts
  /** Every flagged finding, reviewed or not. */
  by_severity: SeverityCounts
  unexpected: number
  /** The least sure flagged finding; null when nothing is flagged. */
  lowest_confidence: number | null
  needs_review: number
  confirmed: number
  dismissed: number
  reviewed: number
  /** High-severity findings not dismissed as false alarms. */
  high_open: number
  model_version: string | null
  cost_usd_est: number | null
  duration_ms: number | null
  summary: string
}

export interface RunList {
  runs: RunSummary[]
}

/** GET /api/runs/{run_id}: the whole stored check, for its own session only. */
export interface RunDetail {
  run_id: string
  created_at: string
  project_id: string
  anchor_id: string
  source: CheckSource | null
  context: Partial<CheckContext>
  result: CheckResult
  /** str(mark) -> decision */
  review: Record<string, FindingReview>
  provenance: Provenance | null
  duration_ms: number | null
  /** Session-scoped image paths: fetch them with X-Session-Id (fetchRunImage). */
  images: { photo: string; render: string; overlay: string | null }
}

/** PUT /api/runs/{run_id}/review/{mark}: decision and at are null once the decision is taken back. */
export interface ReviewOut {
  run_id: string
  mark: number
  decision: ReviewDecision | null
  at: string | null
}

// ---- element Q&A ------------------------------------------------------------------------------
export interface AskRequest {
  project_id: string
  guid: string
  question: string
}

export interface AskAnswer {
  answer: string
  cited_properties: string[]
  confidence: number
}

// ---- issues -------------------------------------------------------------------------------------
export type IssueLanguage = 'en' | 'th' | 'my' | 'id' | 'ms' | 'vi' | 'zh' | 'ja'

/** POST /api/report: the day's site report from this session's stored checks. */
export interface ReportRequest {
  run_ids: string[]
  language?: IssueLanguage
}

/** Gemini's draft daily report, safety first. A person approves it. */
export interface SiteReport {
  title: string
  summary: string
  safety: string[]
  structure: string[]
  progress: string[]
  next_steps: string[]
  checks: number
}

export interface IssueDraftRequest {
  run_id: string
  mark: number
  /** The crew's language for the draft (default English). */
  language?: IssueLanguage
}

export interface IssueDraft {
  title: string
  description: string
  suggested_action: string
}

export interface IssueIn {
  project_id: string
  guid: string
  /** "<run_id>:<mark>" */
  finding_ref?: string | null
  run_id?: string | null
  title: string
  description?: string
  suggested_action?: string
  severity?: Severity | null
  crop_box?: Box | null
}

export interface Issue {
  id: string
  session_id: string
  project_id: string
  guid: string
  finding_ref: string | null
  run_id: string | null
  title: string
  description: string
  suggested_action: string
  severity: Severity | null
  crop_box: Box | null
  photo_url: string | null
  created_at: string
  status: 'open' | 'closed'
}

export interface IssueList {
  issues: Issue[]
  demo: Issue[]
}
