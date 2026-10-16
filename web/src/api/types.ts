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

/** Server-side record of one check (never sent to the browser; mirrored for completeness). */
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
