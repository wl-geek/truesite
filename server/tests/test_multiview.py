"""app/multiview.py: what the session's other viewpoints said about each element of a check."""
from datetime import datetime, timedelta, timezone

import pytest

from app.multiview import WINDOW, other_views, verdict
from app.schemas import CheckRun

T0 = datetime(2026, 11, 28, 9, 0, tzinfo=timezone.utc)


def run(run_id, anchor, findings, at=T0, project="site"):
    return CheckRun(run_id=run_id, session_id="s", project_id=project, anchor_id=anchor, created_at=at, context={},
                    result={"findings": findings}, photo_key="p", render_key="r")


def f(mark, guid, status, confidence=0.9):
    return {"mark": mark, "guid": guid, "status": status, "confidence": confidence}


@pytest.mark.parametrize("status, others, expected", [
    ("misplaced", ["misplaced"], "confirmed"),
    ("missing", ["missing", "different_from_design"], "confirmed"),
    ("missing", ["missing", "cannot_judge"], "confirmed"),
    ("missing", ["present_ok"], "disputed"),
    ("missing", ["missing", "present_ok"], "disputed"),
    ("missing", ["cannot_judge"], None),
    ("missing", [], None),
    ("present_ok", ["misplaced"], "flagged_elsewhere"),
    ("present_ok", ["present_ok"], None),
    ("present_ok", ["cannot_judge"], None),
    ("cannot_judge", ["missing"], "flagged_elsewhere"),
    ("cannot_judge", ["present_ok"], "seen_ok_elsewhere"),
    ("cannot_judge", ["cannot_judge"], None),
])
def test_verdict(status, others, expected):
    assert verdict(status, others) == expected


def test_a_shift_this_view_cannot_see_is_flagged_from_the_other_viewpoint():
    here = run("a", "P1", [f(1, "col-c1", "present_ok"), f(2, "col-b2", "misplaced"), f(3, "beam", "present_ok")])
    there = run("b", "P2", [f(7, "col-c1", "misplaced", 0.95), f(8, "col-b2", "misplaced"), f(9, "beam", "present_ok")])
    views = other_views(here, [here, there])
    assert set(views) == {"1", "2"}  # the beam matches from both: nothing to add
    assert views["1"].verdict == "flagged_elsewhere" and views["2"].verdict == "confirmed"
    v = views["1"].views[0]
    assert (v.anchor_id, v.run_id, v.mark, v.status, v.confidence) == ("P2", "b", 7, "misplaced", 0.95)


def test_only_the_newest_check_per_other_viewpoint_counts():
    here = run("a", "P1", [f(1, "g", "missing")])
    old = run("b", "P2", [f(1, "g", "present_ok")], at=T0 - timedelta(hours=1))
    new = run("c", "P2", [f(1, "g", "missing")], at=T0 + timedelta(minutes=5))
    views = other_views(here, [old, new, here])
    assert views["1"].verdict == "confirmed" and [v.run_id for v in views["1"].views] == ["c"]


def test_same_viewpoint_other_projects_and_old_checks_are_left_out():
    here = run("a", "P1", [f(1, "g", "missing")])
    same_spot = run("b", "P1", [f(1, "g", "present_ok")], at=T0 + timedelta(minutes=1))
    other_project = run("c", "P2", [f(1, "g", "present_ok")], project="other")
    too_old = run("d", "P3", [f(1, "g", "present_ok")], at=T0 - WINDOW - timedelta(seconds=1))
    assert other_views(here, [here, same_spot, other_project, too_old]) == {}


def test_views_come_in_viewpoint_order_and_malformed_findings_are_skipped():
    here = run("a", "P1", [f(1, "g", "missing"), "junk", {"mark": "x", "guid": "g", "status": "missing"}])
    p3 = run("c", "P3", [f(4, "g", "present_ok")])
    p2 = run("b", "P2", [f(5, "g", "missing"), {"guid": "g", "status": "nonsense"}, {"status": "missing"}])
    views = other_views(here, [p3, p2])
    assert list(views) == ["1"] and views["1"].verdict == "disputed"
    assert [v.anchor_id for v in views["1"].views] == ["P2", "P3"]
