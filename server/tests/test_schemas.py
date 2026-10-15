from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import (
    SESSION_ID_RE, AskAnswer, AskRequest, CheckContext, CheckResponse, CheckResult, Finding, Issue, IssueDraft,
    IssueDraftRequest, IssueIn, Offset, UnexpectedItem, Usage, VisibleElement,
)

GUID = "2O2Fr$t4X7Zf8NOew3FLOH"
T0 = datetime(2026, 10, 15, 8, 0, tzinfo=timezone.utc)


def visible(mark: int = 1, **kw) -> dict:
    return {"mark": mark, "guid": GUID, "ifc_class": "IfcWall", "name": "Partition P-01",
            "box": [100, 50, 900, 400], "key_dims": "100 mm thick, 2700 mm high", **kw}


def context(**kw) -> dict:
    return {"project_id": "room1", "anchor_id": "A1", "pose_quality": "good", "distance_m": 1.8,
            "visible": [visible(1), visible(2, ifc_class="IfcDoor")], **kw}


def finding(mark: int, **kw) -> dict:
    return {"mark": mark, "guid": GUID, "name": "Partition P-01", "ifc_class": "IfcWall", "status": "present_ok",
            "confidence": 0.9, "evidence_box": None, "offset": None, "explanation": "", "severity": None, **kw}


def result(**kw) -> dict:
    return {"project_id": "room1", "anchor_id": "A1", "image_quality": "good", "pose_quality": "good",
            "findings": [finding(1), finding(2)], "unexpected": [], "summary": "ok", "warnings": [], **kw}


def test_session_pattern_is_lowercase_uuid4_only() -> None:
    assert SESSION_ID_RE.match(str(uuid.uuid4()))
    for bad in ("demo", str(uuid.uuid4()).upper(), str(uuid.uuid1()), "", str(uuid.uuid4()) + "x"):
        assert not SESSION_ID_RE.match(bad), bad


@pytest.mark.parametrize("box", [[0, 0, 1001, 10], [0, 0, 10], [0, 0, 10, 10, 10], [900, 0, 100, 10], [0, 50, 10, 40],
                                 [-1, 0, 10, 10]])
def test_bad_boxes_are_rejected(box: list[int]) -> None:
    with pytest.raises(ValidationError):
        VisibleElement.model_validate(visible(box=box))


def test_full_frame_box_is_fine() -> None:
    assert VisibleElement.model_validate(visible(box=[0, 0, 1000, 1000])).box == [0, 0, 1000, 1000]


def test_check_context_rules() -> None:
    assert CheckContext.model_validate(context()).sample_id is None
    assert CheckContext.model_validate(context(sample_id="room1-door")).sample_id == "room1-door"
    for bad in (
        context(visible=[visible(1), visible(1)]),  # duplicate marks
        context(visible=[]),
        context(visible=[visible(i) for i in range(1, 27)]),  # 26 marks
        context(pose_quality="great"),
        context(project_id="../etc"),
        context(distance_m=51),
        context(sample_id="Room 1"),
        context(extra_field=1),
        context(visible=[visible(1, extra=True)]),
        context(visible=[visible(26)]),
        context(visible=[visible(1, key_dims="x" * 201)]),
    ):
        with pytest.raises(ValidationError):
            CheckContext.model_validate(bad)


def test_check_result_and_response() -> None:
    r = CheckResult.model_validate(result(usage={"prompt_tokens": 1, "output_tokens": 2, "thought_tokens": 3,
                                                 "total_tokens": 6, "cost_usd_est": 0.01}))
    assert r.usage == Usage(prompt_tokens=1, output_tokens=2, thought_tokens=3, total_tokens=6, cost_usd_est=0.01)
    assert (r.model_version, r.saved_at) == (None, None)
    resp = CheckResponse(run_id="r" * 22, saved=True, photo_url="/api/runs/x/photo.jpg", result=r)
    assert resp.model_dump(mode="json")["result"]["findings"][0]["mark"] == 1


@pytest.mark.parametrize("bad", [
    result(findings=[finding(2), finding(1)]),  # not ordered by mark
    result(findings=[finding(1), finding(1)]),  # duplicate
    result(unexpected=[{"description": "x", "confidence": 0.5}] * 11),
    result(summary="x" * 301),
    result(image_quality="dark"),
    result(findings=[finding(1, status="broken")]),
    result(findings=[finding(1, confidence=1.5)]),
    result(findings=[finding(1, explanation="x" * 201)]),
    result(findings=[finding(1, severity="critical")]),
])
def test_check_result_rejects(bad: dict) -> None:
    with pytest.raises(ValidationError):
        CheckResult.model_validate(bad)


def test_finding_offset_and_unexpected() -> None:
    f = Finding.model_validate(finding(3, status="misplaced", offset={"direction": "left", "approx_cm": 30},
                                       evidence_box=[10, 20, 30, 40], severity="medium"))
    assert f.offset == Offset(direction="left", approx_cm=30)
    with pytest.raises(ValidationError):
        Offset(direction="sideways", approx_cm=30)
    with pytest.raises(ValidationError):
        Offset(direction="left", approx_cm=501)
    u = UnexpectedItem(evidence_box=None, description="Ladder against the wall", confidence=0.7)
    assert u.severity == "medium"
    with pytest.raises(ValidationError):
        UnexpectedItem(description="x" * 151, confidence=0.5)


def test_ask_models() -> None:
    assert AskRequest(project_id="room1", guid=GUID, question="Fire rating?").question == "Fire rating?"
    for bad in ({"question": ""}, {"question": "x" * 301}, {"extra": 1}, {"project_id": "Room 1"}):
        with pytest.raises(ValidationError):
            AskRequest.model_validate({"project_id": "room1", "guid": GUID, "question": "q", **bad})
    a = AskAnswer(answer="60 min", cited_properties=["Pset_WallCommon.FireRating"], confidence=0.9)
    assert a.cited_properties == ["Pset_WallCommon.FireRating"]
    with pytest.raises(ValidationError):
        AskAnswer(answer="x" * 601, cited_properties=[], confidence=0.5)


def test_issue_draft_models() -> None:
    assert IssueDraftRequest(run_id="r" * 22, mark=3).mark == 3
    for bad in ({"mark": 0}, {"run_id": "abc"}, {"run_id": "x/" * 11}, {"run_id": "r" * 33}):
        with pytest.raises(ValidationError):
            IssueDraftRequest.model_validate({"run_id": "r" * 22, "mark": 3, **bad})
    IssueDraft(title="t" * 80, description="d" * 500, suggested_action="s" * 200)
    with pytest.raises(ValidationError):
        IssueDraft(title="t" * 81, description="", suggested_action="")


def test_issue_in_and_issue() -> None:
    body = IssueIn(project_id="room1", guid=GUID, title="Door D-01 about 30 cm left of design")
    assert (body.description, body.suggested_action, body.severity, body.crop_box) == ("", "", None, None)
    for bad in ({"title": ""}, {"title": "x" * 121}, {"session_id": "demo"}, {"id": "x"}, {"crop_box": [5, 0, 1, 1]},
                {"severity": "urgent"}, {"description": "x" * 2001}, {"run_id": "x/" * 11}, {"run_id": "abc"}):
        with pytest.raises(ValidationError):
            IssueIn.model_validate({"project_id": "room1", "guid": GUID, "title": "t", **bad})
    issue = Issue(**body.model_dump(), id="i1", session_id="demo", created_at=T0)
    assert (issue.status, issue.photo_url) == ("open", None)
    # store-only fields (Firestore expire_at) are ignored when reading back
    again = Issue.model_validate({**issue.model_dump(), "expire_at": T0})
    assert again == issue
