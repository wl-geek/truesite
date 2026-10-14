"""validate.repair_check: the server-side rules of spec section 6, one test per rule."""
from app.schemas import CheckContext, Element
from app.validate import repair_check

WALL, DOOR, COL = "W" * 22, "D" * 22, "C" * 22
ELEMENTS = {
    WALL: Element(guid=WALL, ifc_class="IfcWall", name="Wall W-01", storey="L1",
                  bbox_m=[[0, 0, 0], [3, 0.1, 2.7]], load_bearing=True, props={}),
    DOOR: Element(guid=DOOR, ifc_class="IfcDoor", name="Door D-01", storey="L1",
                  bbox_m=[[1, 0, 0], [1.9, 0.1, 2.1]], load_bearing=None, props={}),
    COL: Element(guid=COL, ifc_class="IfcColumn", name="Column C-01", storey="L1",
                 bbox_m=[[2, 2, 0], [2.3, 2.3, 2.7]], load_bearing=True, props={}),
}
CTX = CheckContext.model_validate({
    "project_id": "room1", "anchor_id": "A1", "pose_quality": "good", "distance_m": 1.8,
    "visible": [
        {"mark": 1, "guid": WALL, "ifc_class": "IfcWall", "name": "Wall W-01", "box": [0, 0, 500, 500]},
        {"mark": 2, "guid": DOOR, "ifc_class": "IfcDoor", "name": "Door D-01", "box": [100, 100, 900, 400]},
        {"mark": 3, "guid": COL, "ifc_class": "IfcColumn", "name": "Column C-01", "box": [0, 600, 1000, 700]},
    ],
})


def finding(mark, status="present_ok", confidence=0.9, **kw):
    return {"mark": mark, "status": status, "confidence": confidence, "evidence_box": [10, 10, 20, 20],
            "offset": {"direction": "none", "approx_cm": 0}, "explanation": "ok", **kw}


def raw(findings, unexpected=(), image_quality="good", summary="Looks fine."):
    return {"image_quality": image_quality, "findings": list(findings), "unexpected": list(unexpected), "summary": summary}


def by_mark(result):
    return {f.mark: f for f in result.findings}


def test_one_finding_per_mark_ordered_and_identity_from_context():
    r = repair_check(raw([finding(3), finding(1), finding(2)]), CTX, ELEMENTS)
    assert [f.mark for f in r.findings] == [1, 2, 3]
    assert (r.findings[1].guid, r.findings[1].name, r.findings[1].ifc_class) == (DOOR, "Door D-01", "IfcDoor")
    assert r.project_id == "room1" and r.anchor_id == "A1" and r.pose_quality == "good" and r.warnings == []


def test_missing_mark_becomes_cannot_judge_not_assessed():
    r = repair_check(raw([finding(1), finding(3)]), CTX, ELEMENTS)
    f2 = by_mark(r)[2]
    assert f2.status == "cannot_judge" and f2.explanation == "not assessed" and f2.severity is None
    assert any("mark 2" in w for w in r.warnings)


def test_unknown_and_duplicate_marks_are_dropped_with_warnings():
    r = repair_check(raw([finding(1), finding(1, status="missing"), finding(9), finding(2), finding(3)]), CTX, ELEMENTS)
    assert by_mark(r)[1].status == "present_ok"  # first one wins
    assert len(r.findings) == 3
    assert any("duplicate" in w for w in r.warnings) and any("unknown mark 9" in w for w in r.warnings)


def test_boxes_are_clamped_ordered_and_zero_box_is_none():
    r = repair_check(raw([finding(1, evidence_box=[-5, 1200, 50, 20]), finding(2, evidence_box=[0, 0, 0, 0]),
                          finding(3, evidence_box="junk")]), CTX, ELEMENTS)
    assert by_mark(r)[1].evidence_box == [0, 20, 50, 1000]
    assert by_mark(r)[2].evidence_box is None and by_mark(r)[3].evidence_box is None


def test_offset_kept_only_for_misplaced_and_none_direction_dropped():
    r = repair_check(raw([
        finding(1, status="misplaced", offset={"direction": "left", "approx_cm": 33}),
        finding(2, status="misplaced", offset={"direction": "none", "approx_cm": 0}),
        finding(3, status="missing", offset={"direction": "up", "approx_cm": 50}),
    ]), CTX, ELEMENTS)
    assert by_mark(r)[1].offset.model_dump() == {"direction": "left", "approx_cm": 30}  # rounded to 10 cm
    assert by_mark(r)[2].offset is None and by_mark(r)[3].offset is None


def test_text_is_truncated_to_the_limits():
    r = repair_check(raw([finding(1, explanation="x" * 500), finding(2), finding(3)],
                         unexpected=[{"evidence_box": [1, 1, 2, 2], "description": "y" * 400, "confidence": 0.9}],
                         summary="z" * 900), CTX, ELEMENTS)
    assert len(by_mark(r)[1].explanation) == 200 and r.findings[0].explanation.endswith("…")
    assert len(r.unexpected[0].description) == 150 and len(r.summary) == 300


def test_low_confidence_becomes_cannot_judge():
    r = repair_check(raw([finding(1, status="missing", confidence=0.4), finding(2), finding(3)]), CTX, ELEMENTS)
    assert by_mark(r)[1].status == "cannot_judge" and by_mark(r)[1].severity is None


def test_invalid_status_and_confidence_are_repaired():
    r = repair_check(raw([finding(1, status="exploded"), finding(2, confidence="high"), finding(3, confidence=7)]),
                     CTX, ELEMENTS)
    assert by_mark(r)[1].status == "cannot_judge"
    assert by_mark(r)[2].status == "cannot_judge" and by_mark(r)[2].confidence == 0.0
    assert by_mark(r)[3].confidence == 1.0


def test_severity_comes_from_code():
    r = repair_check(raw([finding(1, status="missing"), finding(2, status="misplaced",
                                                                  offset={"direction": "right", "approx_cm": 30}),
                          finding(3, status="different_from_design", severity="low")]), CTX, ELEMENTS)
    assert [f.severity for f in r.findings] == ["high", "medium", "high"]


def test_unexpected_capped_at_ten_low_confidence_dropped_and_medium():
    items = [{"evidence_box": [1, 1, 2, 2], "description": f"thing {i}", "confidence": 0.9} for i in range(14)]
    items.append({"evidence_box": [1, 1, 2, 2], "description": "faint", "confidence": 0.2})
    r = repair_check(raw([finding(1), finding(2), finding(3)], unexpected=items), CTX, ELEMENTS)
    assert len(r.unexpected) == 10 and {u.severity for u in r.unexpected} == {"medium"}
    assert all(u.description != "faint" for u in r.unexpected)


def test_bad_image_quality_and_missing_lists_are_tolerated():
    r = repair_check({"image_quality": "sepia", "findings": "nope", "summary": 5}, CTX, ELEMENTS)
    assert r.image_quality == "good" and any("image_quality" in w for w in r.warnings)
    assert [f.status for f in r.findings] == ["cannot_judge"] * 3 and r.summary == "" and r.unexpected == []


def test_element_missing_from_project_still_gets_class_severity():
    r = repair_check(raw([finding(1), finding(2, status="missing"), finding(3)]), CTX, {})
    assert by_mark(r)[2].severity == "medium"
