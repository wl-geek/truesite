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


class CheckRun(BaseModel):
    """Stored per check (session-scoped); the photo and render live in blobs under blob_key()."""

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
class IssueDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: RunId
    mark: int = Field(ge=1, le=25)


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
