"""Property tests for validate.repair_check and its helpers (spec section 6, server rules).

Gemini's answer is untrusted JSON. Whatever it holds, the repaired result must be a valid CheckResult
with exactly one finding per context mark (ordered by mark), boxes rounded, clamped and ordered in
0..1000, low confidence shown as "can't judge" with no offset and no severity, at most ten unexpected
items, and each mark's name and class taken from the project rather than the client.
"""
from __future__ import annotations

import json

import pytest
from hypothesis import HealthCheck, example, given, settings, strategies as st

from app.schemas import CheckContext, CheckResult, Element
from app.severity import severity_for
from app.validate import clamp_confidence, repair_check, truncate_text, with_project_identity

PROPS = settings(max_examples=100, deadline=None,
                 suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large, HealthCheck.large_base_example])

STATUSES = ["present_ok", "missing", "misplaced", "different_from_design", "cannot_judge"]
DEVIATIONS = {"missing", "misplaced", "different_from_design"}
DIRECTIONS = ["left", "right", "up", "down", "forward", "back", "none"]
QUALITIES = ["good", "too_dark", "blurred", "marker_far", "occluded"]
PROJECT_CLASSES = [("IfcColumn", True), ("IfcWall", True), ("IfcWall", False), ("IfcDoor", None),
                   ("IfcRailing", None), ("IfcFurniture", None), ("IfcPipeSegment", None), ("IfcReinforcingBar", None)]

# What json.loads can hand back at the leaves, NaN and inf included. Integers stay within float range.
scalars = st.none() | st.booleans() | st.integers(-10**9, 10**9) | st.floats() | st.text(max_size=8)
json_values = st.recursive(
    scalars, lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(max_size=5), inner, max_size=3),
    max_leaves=6)
finite = st.integers(-2000, 3000) | st.floats(-2000, 3000)
boxes = (st.lists(st.integers(-300, 1300), min_size=4, max_size=4)
         | st.lists(finite | scalars, min_size=3, max_size=5) | scalars)
offsets = st.fixed_dictionaries({}, optional={
    "direction": st.sampled_from(DIRECTIONS) | scalars,
    "approx_cm": st.integers(-100, 900) | st.floats(-100, 900) | scalars,
}) | scalars
unexpected_items = st.fixed_dictionaries({}, optional={
    "description": st.text(max_size=180) | scalars,
    "confidence": st.floats(0, 1) | scalars,
    "evidence_box": boxes,
}) | json_values


def finding_dicts(n: int) -> st.SearchStrategy:
    mark = st.integers(-1, n + 2)
    return st.fixed_dictionaries({}, optional={
        "mark": mark | mark.map(float) | mark.map(str) | mark.map(lambda m: f" {m} ") | scalars,
        "status": st.sampled_from(STATUSES) | scalars,
        "confidence": st.floats(0, 1) | scalars,
        "evidence_box": boxes,
        "offset": offsets,
        "explanation": st.text(max_size=250) | scalars,
    })


def answers(n: int) -> st.SearchStrategy:
    """A Gemini answer for a context with n marks: right-shaped, wrong-typed or missing at every level."""
    return st.fixed_dictionaries({}, optional={
        "image_quality": st.sampled_from(QUALITIES) | scalars,
        "findings": st.lists(finding_dicts(n) | json_values, max_size=n + 5) | scalars,
        "unexpected": st.lists(unexpected_items, max_size=14) | scalars,
        "summary": st.text(max_size=350) | scalars,
    })


@st.composite
def checks(draw) -> tuple[CheckContext, dict[str, Element], dict]:
    """(context, project elements, answer). Marks are 1..n in any order. Some guids are missing from the
    project: POST /api/check rejects those first, but repair_check must not rely on it."""
    n = draw(st.integers(1, 25))
    visible, elements = [], {}
    for mark in draw(st.permutations(range(1, n + 1))):
        guid = f"guid-{mark:02d}"
        if draw(st.booleans()):
            ifc_class, load_bearing = draw(st.sampled_from(PROJECT_CLASSES))
            elements[guid] = Element(guid=guid, ifc_class=ifc_class, name=f"Project element {mark}", storey="L1",
                                     bbox_m=[[0, 0, 0], [1, 1, 1]], load_bearing=load_bearing, props={})
        y0, y1 = sorted(draw(st.lists(st.integers(0, 1000), min_size=2, max_size=2)))
        x0, x1 = sorted(draw(st.lists(st.integers(0, 1000), min_size=2, max_size=2)))
        visible.append({"mark": mark, "guid": guid, "name": f"Client name {mark}", "box": [y0, x0, y1, x1],
                        "ifc_class": draw(st.sampled_from(["IfcColumn", "IfcDoor", "IfcBuildingElementProxy"]))})
    ctx = CheckContext.model_validate({"project_id": "site", "anchor_id": "P1", "distance_m": 2.0, "visible": visible,
                                       "pose_quality": draw(st.sampled_from(["good", "fair", "poor"]))})
    return ctx, elements, draw(answers(n))


def assert_box(box: list[int] | None) -> None:
    if box is not None:
        assert len(box) == 4 and all(type(v) is int and 0 <= v <= 1000 for v in box)
        assert box[0] <= box[2] and box[1] <= box[3] and any(box)


# ---- any answer -----------------------------------------------------------------------------------
@PROPS
@given(checks())
def test_any_answer_repairs_to_one_valid_finding_per_mark(case):
    ctx, elements, raw = case
    result = repair_check(raw, ctx, elements)

    # A valid wire result: strict JSON (no NaN, no inf) that validates as a CheckResult again.
    CheckResult.model_validate_json(json.dumps(result.model_dump(mode="json"), allow_nan=False))
    assert [f.mark for f in result.findings] == list(range(1, len(ctx.visible) + 1))
    by_mark = {v.mark: v for v in ctx.visible}
    for f in result.findings:
        vis = by_mark[f.mark]
        project = elements.get(vis.guid)
        assert f.guid == vis.guid
        # Name and class come from the project; the client's copy is used only for a guid the project lacks.
        assert (f.name, f.ifc_class) == ((project.name, project.ifc_class) if project else (vis.name, vis.ifc_class))
        element = project or Element(guid=vis.guid, ifc_class=vis.ifc_class, name=vis.name, storey="",
                                     bbox_m=[[0, 0, 0], [0, 0, 0]], load_bearing=None, props={})
        assert f.severity == severity_for(element, f.status)
        assert 0.0 <= f.confidence <= 1.0 and len(f.explanation) <= 200
        if f.confidence < 0.5:
            assert f.status == "cannot_judge"
        if f.status == "cannot_judge":
            assert f.offset is None and f.severity is None
        if f.offset is not None:
            assert f.status == "misplaced" and f.offset.direction != "none"
            assert 0 <= f.offset.approx_cm <= 500 and f.offset.approx_cm % 10 == 0
        assert_box(f.evidence_box)
    assert len(result.unexpected) <= 10
    for u in result.unexpected:
        assert u.description.strip() and len(u.description) <= 150
        assert 0.5 <= u.confidence <= 1.0 and u.severity == "medium"
        assert_box(u.evidence_box)
    assert (result.project_id, result.anchor_id, result.pose_quality) == (ctx.project_id, ctx.anchor_id, ctx.pose_quality)
    assert result.image_quality in QUALITIES and len(result.summary) <= 300


@PROPS
@given(checks())
def test_a_repaired_result_needs_no_more_repair(case):
    ctx, elements, raw = case
    once = repair_check(raw, ctx, elements)
    twice = repair_check(once.model_dump(mode="json"), ctx, elements)
    assert twice.warnings == []
    assert twice.model_dump(exclude={"warnings"}) == once.model_dump(exclude={"warnings"})


@PROPS
@given(checks(), st.data())
def test_the_order_of_marks_in_the_context_does_not_matter(case, data):
    ctx, elements, raw = case
    shuffled = ctx.model_copy(update={"visible": data.draw(st.permutations(ctx.visible))})
    a, b = repair_check(raw, ctx, elements), repair_check(raw, shuffled, elements)
    assert a.model_dump(exclude={"warnings"}) == b.model_dump(exclude={"warnings"})
    assert sorted(a.warnings) == sorted(b.warnings)


@PROPS
@given(checks())
def test_with_project_identity_takes_name_and_class_from_the_project(case):
    ctx, elements, _ = case
    project = {**elements, **{
        v.guid: Element(guid=v.guid, ifc_class="IfcSlab", name=f"Slab {v.mark}", storey="L2",
                        bbox_m=[[0, 0, 0], [1, 1, 1]], load_bearing=True, props={})
        for v in ctx.visible if v.guid not in elements}}
    before = ctx.model_dump()
    out = with_project_identity(ctx, project)
    assert ctx.model_dump() == before  # the client's context is left as it was
    assert out.model_dump(exclude={"visible"}) == ctx.model_dump(exclude={"visible"})
    for old, new in zip(ctx.visible, out.visible, strict=True):
        assert (new.name, new.ifc_class) == (project[old.guid].name, project[old.guid].ifc_class)
        assert new.model_dump(exclude={"name", "ifc_class"}) == old.model_dump(exclude={"name", "ifc_class"})


# ---- one rule at a time, on a one-mark context (a load-bearing column: deviations are high) -----------
COLUMN = Element(guid="col-1", ifc_class="IfcColumn", name="Column C1", storey="L1",
                 bbox_m=[[0, 0, 0], [0.3, 0.3, 3]], load_bearing=True, props={})
ONE = CheckContext.model_validate({
    "project_id": "site", "anchor_id": "P1", "pose_quality": "good", "distance_m": 2.0,
    "visible": [{"mark": 1, "guid": "col-1", "ifc_class": "IfcColumn", "name": "Column C1", "box": [0, 0, 500, 500]}],
})
THREE = CheckContext.model_validate({
    "project_id": "site", "anchor_id": "P1", "pose_quality": "good", "distance_m": 2.0,
    "visible": [{"mark": m, "guid": "col-1", "ifc_class": "IfcColumn", "box": [0, 0, 10, 10]} for m in (1, 2, 3)],
})


def repair_one(**finding):
    return repair_check({"findings": [{"mark": 1, **finding}]}, ONE, {"col-1": COLUMN}).findings[0]


@PROPS
@given(st.lists(finite, min_size=4, max_size=4))
@example([500, 0, 0, 0])  # one non-zero coordinate is still a box
@example([7, 7, 0, 0])
@example([5, 5, 5, 0])
@example([5, 5, 5, 5])
@example([-3, -0.4, 0.2, -9])  # rounds and clamps to all zero: no box
@example([1200.6, -50, 999.5, 1000.4])
def test_evidence_box_is_rounded_clamped_and_ordered(box):
    y0, x0, y1, x1 = (min(1000, max(0, round(v))) for v in box)
    expected = None if (y0, x0, y1, x1) == (0, 0, 0, 0) else [min(y0, y1), min(x0, x1), max(y0, y1), max(x0, x1)]
    assert repair_one(status="present_ok", confidence=0.9, evidence_box=box).evidence_box == expected


@PROPS
@given(st.lists(finite, min_size=4, max_size=4), st.integers(0, 3),
       st.sampled_from([float("nan"), float("inf"), -float("inf"), True, None, "5", [5]]))
def test_a_box_with_anything_but_finite_numbers_is_dropped(box, i, bad):
    box = [*box[:i], bad, *box[i + 1:]]
    assert repair_one(status="present_ok", confidence=0.9, evidence_box=box).evidence_box is None


@pytest.mark.parametrize("box", [None, 5, "0 0 9 9", {"y0": 1}, [], [1, 2, 3], [1, 2, 3, 4, 5]])
def test_a_box_that_is_not_a_list_of_four_is_dropped(box):
    assert repair_one(status="present_ok", confidence=0.9, evidence_box=box).evidence_box is None
    unexpected = repair_check({"unexpected": [{"description": "Ladder", "confidence": 0.9, "evidence_box": box}]},
                              ONE, {"col-1": COLUMN}).unexpected
    assert [(u.description, u.evidence_box) for u in unexpected] == [("Ladder", None)]


@PROPS
@given(st.sampled_from(DIRECTIONS), st.integers(-200, 1000) | st.floats(-200, 1000))
@example("right", 600)  # capped at 5 m
@example("up", -30)  # never negative
@example("left", 34)  # rough: to the nearest 10 cm
def test_offset_is_rounded_to_10_cm_and_kept_for_misplaced_only(direction, cm):
    offset = {"direction": direction, "approx_cm": cm}
    expected = None if direction == "none" else {"direction": direction, "approx_cm": min(500, max(0, round(cm / 10) * 10))}
    got = repair_one(status="misplaced", confidence=0.9, offset=offset).offset
    assert (got.model_dump() if got else None) == expected
    for status in ("present_ok", "missing", "different_from_design", "cannot_judge"):
        assert repair_one(status=status, confidence=0.9, offset=offset).offset is None


@pytest.mark.parametrize("offset", [None, "left", 30, {}, {"direction": "left"}, {"approx_cm": 30},
                                    {"direction": "sideways", "approx_cm": 30}, {"direction": "left", "approx_cm": "30"},
                                    {"direction": "left", "approx_cm": float("nan")}, {"direction": "left", "approx_cm": True}])
def test_a_malformed_offset_is_dropped(offset):
    f = repair_one(status="misplaced", confidence=0.9, offset=offset)
    assert (f.status, f.offset, f.severity) == ("misplaced", None, "high")


@PROPS
@given(st.sampled_from(STATUSES), st.floats(0, 1))
@example("missing", 0.5)  # the floor itself is confident enough
@example("missing", 0.4999)
@example("misplaced", 0.0)
@example("cannot_judge", 0.2)
def test_low_confidence_is_shown_as_cannot_judge_without_offset_or_severity(status, confidence):
    f = repair_one(status=status, confidence=confidence, explanation="Seen clearly.",
                   offset={"direction": "left", "approx_cm": 30})
    assert f.confidence == confidence
    if confidence < 0.5 and status != "cannot_judge":
        assert (f.status, f.explanation, f.offset, f.severity) == ("cannot_judge", "Low confidence.", None, None)
    else:
        assert (f.status, f.explanation) == (status, "Seen clearly.")
        assert f.severity == ("high" if status in DEVIATIONS else None)
        assert (f.offset is not None) == (status == "misplaced")


@pytest.mark.parametrize("status", [None, "", "MISSING", "ok", 3, 0.9, True])
def test_an_unknown_status_is_cannot_judge(status):
    f = repair_one(status=status, confidence=0.9, offset={"direction": "left", "approx_cm": 30})
    assert (f.status, f.offset, f.severity) == ("cannot_judge", None, None)


def test_a_mark_without_a_finding_is_not_assessed_with_zero_confidence():
    result = repair_check({"image_quality": "good", "findings": []}, ONE, {"col-1": COLUMN})
    f = result.findings[0]
    assert (f.status, f.confidence, f.explanation, f.severity, f.offset, f.evidence_box) == \
        ("cannot_judge", 0.0, "not assessed", None, None, None)
    assert (f.name, f.ifc_class) == ("Column C1", "IfcColumn")
    assert result.warnings == ["no finding for mark 1; marked not assessed"]


def as_mark(value):
    """The marks repair_check reads: ints, integral floats and ASCII digit strings."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        return int(value.strip())
    return None


MARK_FORMS = (st.integers(1, 3) | st.integers(1, 3).map(float) | st.integers(1, 3).map(lambda m: f" {m}")
              | st.sampled_from([0, 4, 25, -1, True, None, "x", 2.5, "²", float("nan")]))
JUNK = json_values.filter(lambda v: not isinstance(v, dict) or "mark" not in v)


@PROPS
@given(st.lists(st.tuples(st.just("finding"), MARK_FORMS) | st.tuples(st.just("junk"), JUNK), max_size=8))
@example([("junk", 1), ("finding", 2)])  # junk is skipped, not the end of the list
@example([("finding", 9), ("finding", 1)])  # so is an unknown mark
@example([("finding", 1), ("finding", 1.0), ("finding", 3)])  # and a duplicate
def test_each_mark_takes_its_first_valid_finding(entries):
    raw = [{"mark": value, "status": "present_ok", "confidence": 0.9, "explanation": f"item {i}"}
           if kind == "finding" else value for i, (kind, value) in enumerate(entries)]
    result = repair_check({"findings": raw}, THREE, {"col-1": COLUMN})
    expected: dict[int, str] = {}
    for i, (kind, value) in enumerate(entries):
        mark = as_mark(value) if kind == "finding" else None
        if mark in (1, 2, 3) and mark not in expected:
            expected[mark] = f"item {i}"
    assert {f.mark: f.explanation for f in result.findings} == {m: expected.get(m, "not assessed") for m in (1, 2, 3)}
    assert {f.mark: f.status for f in result.findings} == {m: "present_ok" if m in expected else "cannot_judge" for m in (1, 2, 3)}
    assert {w for w in result.warnings if w.startswith("no finding")} == \
        {f"no finding for mark {m}; marked not assessed" for m in (1, 2, 3) if m not in expected}


@PROPS
@given(st.lists(unexpected_items, max_size=16))
@example([{"description": "Ladder", "confidence": 0.5}])  # the floor is kept
@example([{"description": "Ladder", "confidence": 0.49}])
@example([{"description": "   ", "confidence": 0.9}, {"confidence": 0.9}])  # no description: dropped
@example([{"description": f"Item {i}", "confidence": 0.9} for i in range(12)])
@example(["junk", {"description": "Skip", "confidence": 0.1}, {"description": "Ladder", "confidence": 0.9}])
@example([{"description": "Ladder", "confidence": -0.5}, {"description": "Hose", "confidence": 7}])
def test_unexpected_keeps_the_first_ten_described_confident_items(items):
    result = repair_check({"unexpected": items}, ONE, {"col-1": COLUMN})
    kept = [i for i in items if isinstance(i, dict) and truncate_text(i.get("description"), 150)
            and clamp_confidence(i.get("confidence")) >= 0.5][:10]
    assert [(u.description, u.confidence) for u in result.unexpected] == \
        [(truncate_text(i["description"], 150), clamp_confidence(i.get("confidence"))) for i in kept]
    assert all(u.severity == "medium" for u in result.unexpected)


@PROPS
@given(st.sampled_from(QUALITIES) | scalars)
def test_image_quality_is_kept_only_when_known(value):
    result = repair_check({"image_quality": value}, ONE, {"col-1": COLUMN})
    known = isinstance(value, str) and value in QUALITIES
    assert result.image_quality == (value if known else "good")
    assert any(w.startswith("image_quality") for w in result.warnings) == (not known)


# ---- helpers ----------------------------------------------------------------------------------------
@PROPS
@given(st.text(max_size=300) | scalars, st.integers(1, 260))
@example("x" * 200, 200)  # exactly at the limit: kept whole
@example("x" * 201, 200)
@example("  padded  ", 6)
def test_truncate_text_keeps_what_fits_and_cuts_the_rest_with_an_ellipsis(value, limit):
    out = truncate_text(value, limit)
    s = value.strip() if isinstance(value, str) else ""
    assert len(out) <= limit
    if len(s) <= limit:
        assert out == s
    else:
        assert len(out) == limit and out.endswith("…") and s.startswith(out[:-1])


@PROPS
@given(scalars | st.floats(-2, 3))
@example(-0.5)
@example(1.5)
@example(float("nan"))
def test_confidence_is_clamped_to_0_1(value):
    out = clamp_confidence(value)
    assert type(out) is float and 0.0 <= out <= 1.0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        assert out == 0.0  # not a number, or NaN: no confidence
    elif 0 <= value <= 1:
        assert out == value
    else:
        assert out == (0.0 if value < 0 else 1.0)
