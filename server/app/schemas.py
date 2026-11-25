"""Every wire and record model in the interface contract (section 5).

JSON is snake_case on the wire; web/src/api/types.ts mirrors these field for field.
Request bodies forbid unknown fields, so a client can never set server-owned fields
(id, session_id, severity of a finding, ...).
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

# Browser: crypto.randomUUID() -> lowercase RFC 4122 v4 UUID. The literal "demo" session
# (seeded, read-only issues) can never match this pattern, so no client can claim it.
SESSION_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
SESSION_ID_RE = re.compile(SESSION_ID_PATTERN)
DEMO_SESSION = "demo"

PROJECT_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,31}$"
ANCHOR_ID_PATTERN = r"^[A-Za-z0-9_-]{1,16}$"
SAMPLE_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"
# secrets.token_urlsafe(16) -> 22 chars. Also a Firestore document id, so never a "/".
RUN_ID_PATTERN = r"^[A-Za-z0-9_-]{16,32}$"
PROJECT_ID_RE = re.compile(PROJECT_ID_PATTERN)

ProjectId = Annotated[str, Field(pattern=PROJECT_ID_PATTERN)]
AnchorId = Annotated[str, Field(pattern=ANCHOR_ID_PATTERN)]
Guid = Annotated[str, Field(min_length=1, max_length=64)]
RunId = Annotated[str, Field(pattern=RUN_ID_PATTERN)]


def _box_order(box: list[int]) -> list[int]:
    if box[0] > box[2] or box[1] > box[3]:
        raise ValueError("box must be [ymin, xmin, ymax, xmax] with min <= max")
    return box


Coord = Annotated[int, Field(ge=0, le=1000)]
# [ymin, xmin, ymax, xmax], integers 0..1000, rows top-down (Gemini convention).
Box = Annotated[list[Coord], Field(min_length=4, max_length=4), AfterValidator(_box_order)]
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]

Status = Literal["present_ok", "missing", "misplaced", "different_from_design", "cannot_judge"]
ImageQuality = Literal["good", "too_dark", "blurred", "marker_far", "occluded"]
PoseQuality = Literal["good", "fair", "poor"]
Direction = Literal["left", "right", "up", "down", "forward", "back", "none"]
Severity = Literal["high", "medium", "low"]
# Where a check came from: the virtual demo, the ready-made sample photos, or the live camera.
CheckSource = Literal["virtual", "live", "sample"]
# A person's decision on one finding: the deviation is real, or it was a false alarm.
ReviewDecision = Literal["confirmed", "dismissed"]


# ---- project data (bim/models/<project>/) -------------------------------------------------
class Element(BaseModel):
    """One elements.json row. bbox_m is [[minX, minY, minZ], [maxX, maxY, maxZ]] in IFC metres, Z up."""

    guid: str
    ifc_class: str
    name: str
    storey: str
    bbox_m: Annotated[list[Vec3], Field(min_length=2, max_length=2)]
    load_bearing: bool | None
    props: dict[str, Any]


class Anchor(BaseModel):
    """One anchors.json row: QR centre, outward normal and top-edge direction in IFC coordinates."""

    anchor_id: AnchorId
    project_id: ProjectId
    qr_size_m: float = Field(gt=0)
    position_m: Vec3
    normal: Vec3
    up: Vec3
    scale: float = Field(gt=0)
    label: str = ""


class ProjectManifest(BaseModel):
    project_id: ProjectId
    name: str
    model_url: str
    elements: list[Element]
    anchors: list[Anchor]


# ---- as-built check -------------------------------------------------------------------------
class VisibleElement(BaseModel):
    """A numbered mark in the check context. Exported to TypeScript as MarkedElement."""

    model_config = ConfigDict(extra="forbid")

    mark: int = Field(ge=1, le=25)
    guid: Guid
    ifc_class: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=200)
    box: Box
    key_dims: str = Field(default="", max_length=200)


class CheckContext(BaseModel):
    """The `context` form field of POST /api/check."""

    model_config = ConfigDict(extra="forbid")

    project_id: ProjectId
    anchor_id: AnchorId
    pose_quality: PoseQuality
    distance_m: float = Field(ge=0, le=50)
    visible: list[VisibleElement] = Field(min_length=1, max_length=25)
    # Set in sample-photo mode: a successful real result becomes that sample's saved result.
    sample_id: str | None = Field(default=None, pattern=SAMPLE_ID_PATTERN)
    # What the client says it ran the check from (stored in the run's provenance; not trusted for anything else).
    source: CheckSource | None = None

    @model_validator(mode="after")
    def _marks_1_to_n(self) -> "CheckContext":
        # The Gemini schema caps the mark at n (gemini_client._check_schema), so marks are exactly 1..n.
        if sorted(v.mark for v in self.visible) != list(range(1, len(self.visible) + 1)):
            raise ValueError("visible[].mark values must be 1..n, each once")
        return self


class Offset(BaseModel):
    direction: Direction
    approx_cm: int = Field(ge=0, le=500)


class Finding(BaseModel):
    mark: int = Field(ge=1, le=25)
    guid: str
    name: str
    ifc_class: str
    status: Status
    confidence: float = Field(ge=0, le=1)
    evidence_box: Box | None = None
    offset: Offset | None = None
    explanation: str = Field(default="", max_length=200)
    severity: Severity | None = None  # set by code (severity.py), never by the model


class UnexpectedItem(BaseModel):
    evidence_box: Box | None = None
    description: str = Field(max_length=150)
    confidence: float = Field(ge=0, le=1)
    severity: Literal["medium"] = "medium"  # "a person should look"


class Usage(BaseModel):
    prompt_tokens: int
    output_tokens: int
    thought_tokens: int
    total_tokens: int
    cost_usd_est: float


class CheckResult(BaseModel):
    project_id: str
    anchor_id: str
    image_quality: ImageQuality
    pose_quality: PoseQuality
    findings: list[Finding]  # exactly one per context mark, ordered by mark (validate.repair_check)
    unexpected: list[UnexpectedItem] = Field(max_length=10)
    summary: str = Field(max_length=300)
    warnings: list[str]
    usage: Usage | None = None
    model_version: str | None = None
    saved_at: str | None = None  # ISO time, set only on /api/saved-results responses

    @model_validator(mode="after")
    def _ordered_unique_marks(self) -> "CheckResult":
        marks = [f.mark for f in self.findings]
        if marks != sorted(set(marks)):
            raise ValueError("findings must have unique marks in ascending order")
        return self


class CheckResponse(BaseModel):
    run_id: str
    saved: bool
    photo_url: str | None
    result: CheckResult


class FindingReview(BaseModel):
    """A person's decision on one finding, stamped with the server's time."""

    model_config = ConfigDict(extra="ignore")

    decision: ReviewDecision
    at: datetime


class Provenance(BaseModel):
    """What the server received for a check, recorded as it arrived: the audit trail. The hashes identify the
    exact images Gemini was sent; source, pose_quality and distance_m are the client's own statements."""

    model_config = ConfigDict(extra="ignore")

    photo_sha256: str
    render_sha256: str
    overlay_sha256: str | None = None
    received_at: datetime  # server time, before the Gemini call
    app_version: str  # APP_VERSION of the server that ran the check
    source: CheckSource | None = None
    pose_quality: PoseQuality | None = None
    distance_m: float | None = None


class CheckRun(BaseModel):
    """Stored per check (session-scoped); the photo, render and outline image live in blobs under blob_key().

    The fields after render_key were added for the Checks page; runs stored before them load with the defaults."""

    model_config = ConfigDict(extra="ignore")  # tolerate store-only fields such as expire_at

    run_id: str
    session_id: str
    project_id: str
    anchor_id: str
    created_at: datetime
    context: dict[str, Any]
    result: dict[str, Any]
    photo_key: str
    render_key: str
    overlay_key: str | None = None  # the outline image (IMAGE 3), when the client sent one
    duration_ms: int | None = None  # server time for the Gemini call (and its repair)
    provenance: Provenance | None = None
    review: dict[str, FindingReview] = Field(default_factory=dict)  # str(mark) -> decision


# ---- the Checks page (GET /api/runs, GET /api/runs/{run_id}, PUT /api/runs/{run_id}/review/{mark}) ----------
class ReviewIn(BaseModel):
    """Body of PUT /api/runs/{run_id}/review/{mark}: null takes the decision back."""

    model_config = ConfigDict(extra="forbid")

    decision: ReviewDecision | None


class ReviewOut(BaseModel):
    run_id: str
    mark: int
    decision: ReviewDecision | None
    at: datetime | None


class StatusCounts(BaseModel):
    present_ok: int = 0
    missing: int = 0
    misplaced: int = 0
    different_from_design: int = 0
    cannot_judge: int = 0


class SeverityCounts(BaseModel):
    high: int = 0
    medium: int = 0
    low: int = 0


class RunSummary(BaseModel):
    """One row of GET /api/runs. "Flagged" findings are the deviations: those with a severity."""

    run_id: str
    created_at: datetime
    project_id: str
    anchor_id: str
    source: CheckSource | None
    image_quality: str | None
    by_status: StatusCounts
    by_severity: SeverityCounts  # every flagged finding, reviewed or not
    unexpected: int
    lowest_confidence: float | None  # the least sure flagged finding; None when nothing is flagged
    needs_review: int  # flagged findings with no decision yet
    confirmed: int
    dismissed: int
    reviewed: int  # confirmed + dismissed
    high_open: int  # high-severity findings not dismissed as false alarms
    model_version: str | None
    cost_usd_est: float | None
    duration_ms: int | None
    summary: str


class RunList(BaseModel):
    runs: list[RunSummary]


class RunImages(BaseModel):
    """Session-scoped image paths (fetch them with X-Session-Id)."""

    photo: str
    render: str
    overlay: str | None


class RunDetail(BaseModel):
    """GET /api/runs/{run_id}: the whole stored check for its own session."""

    run_id: str
    created_at: datetime
    project_id: str
    anchor_id: str
    source: CheckSource | None
    context: dict[str, Any]
    result: dict[str, Any]
    review: dict[str, FindingReview]
    provenance: Provenance | None
    duration_ms: int | None
    images: RunImages


# ---- element Q&A ------------------------------------------------------------------------------
class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: ProjectId
    guid: Guid
    question: str = Field(min_length=1, max_length=300)


class AskAnswer(BaseModel):
    answer: str = Field(max_length=600)
    cited_properties: list[str]
    confidence: float = Field(ge=0, le=1)


# ---- issues -------------------------------------------------------------------------------------
# Languages Gemini drafts issues in: JAPAC site crews often don't share a language with their supervisor.
IssueLanguage = Literal["en", "th", "my", "id", "ms", "vi", "zh", "ja"]


class IssueDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: RunId
    mark: int = Field(ge=1, le=25)
    language: IssueLanguage = "en"


class ReportRequest(BaseModel):
    """Body of POST /api/report: the session's stored checks to write the day's site report from."""
    model_config = ConfigDict(extra="forbid")

    run_ids: list[RunId] = Field(min_length=1, max_length=8)
    language: IssueLanguage = "en"


class SiteReport(BaseModel):
    """Gemini's draft daily report: safety first, then structure, then progress. A person approves it."""
    title: str = Field(max_length=100)
    summary: str = Field(max_length=700)
    safety: list[str] = Field(max_length=10)
    structure: list[str] = Field(max_length=10)
    progress: list[str] = Field(max_length=10)
    next_steps: list[str] = Field(max_length=8)
    checks: int


class IssueDraft(BaseModel):
    title: str = Field(max_length=80)
    description: str = Field(max_length=500)
    suggested_action: str = Field(max_length=200)


class IssueIn(BaseModel):
    """Body of POST /api/issues (after the user edits the draft). Also the demo_issues.json row shape."""

    model_config = ConfigDict(extra="forbid")

    project_id: ProjectId
    guid: Guid
    finding_ref: str | None = Field(default=None, max_length=64)  # "<run_id>:<mark>"
    run_id: RunId | None = None
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    suggested_action: str = Field(default="", max_length=600)
    severity: Severity | None = None
    crop_box: Box | None = None


class Issue(IssueIn):
    model_config = ConfigDict(extra="ignore")  # tolerate store-only fields such as expire_at

    id: str
    session_id: str
    photo_url: str | None = None
    created_at: datetime
    status: Literal["open", "closed"] = "open"
