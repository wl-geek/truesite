"""The Checks page API: GET /api/runs, GET /api/runs/{run_id}, PUT /api/runs/{run_id}/review/{mark}, the outline
image, and the provenance POST /api/check stores. Everything is scoped to the caller's session."""
import hashlib
import json
from datetime import timedelta

import pytest

from app.schemas import CheckRun, FindingReview, Provenance
from app.summaries import summarise_run

from .conftest import GUID_DOOR, JPEG, PNG, new_session
from .test_check_route import context, post

OVERLAY = b"\xff\xd8\xff\xe1" + b"\x01" * 64


def hdr(session):
    return {"X-Session-Id": session}


def review(client, session, run_id, mark, decision):
    return client.put(f"/api/runs/{run_id}/review/{mark}", json={"decision": decision}, headers=hdr(session))


def door_mark(body) -> int:
    return next(f["mark"] for f in body["result"]["findings"] if f["guid"] == GUID_DOOR)


# ---- GET /api/runs -------------------------------------------------------------------------------------------------
def test_list_is_empty_for_a_new_session(client):
    r = client.get("/api/runs", headers=hdr(new_session()))
    assert r.status_code == 200 and r.json() == {"runs": []}


def test_list_needs_a_session(client):
    assert client.get("/api/runs").status_code == 422


def test_list_shows_only_this_sessions_runs_newest_first_with_counts(client, clock):
    a, b = new_session(), new_session()
    first = post(client, a).json()["run_id"]
    clock.wall += timedelta(minutes=5)
    second = post(client, a, ctx=context(anchor_id="D1", source="virtual")).json()["run_id"]
    other = post(client, b).json()["run_id"]

    runs = client.get("/api/runs", headers=hdr(a)).json()["runs"]
    assert [r["run_id"] for r in runs] == [second, first]
    assert other not in {r["run_id"] for r in runs}
    top = runs[0]
    # The offline stand-in: the wall matches (0.9), the door is misplaced (0.75, medium).
    assert top["anchor_id"] == "D1" and top["project_id"] == "testproj" and top["source"] == "virtual"
    assert top["by_status"] == {"present_ok": 1, "missing": 0, "misplaced": 1, "different_from_design": 0, "cannot_judge": 0}
    assert top["by_severity"] == {"high": 0, "medium": 1, "low": 0}
    assert top["lowest_confidence"] == 0.75 and top["unexpected"] == 0 and top["image_quality"] == "good"
    assert (top["needs_review"], top["confirmed"], top["dismissed"], top["reviewed"], top["high_open"]) == (1, 0, 0, 0, 0)
    assert top["model_version"] == "fake" and top["cost_usd_est"] == 0.0
    assert isinstance(top["duration_ms"], int) and top["duration_ms"] >= 0
    assert top["summary"].startswith("Offline check:")
    assert runs[1]["source"] is None  # a client that doesn't say where the check came from
    assert [r["run_id"] for r in client.get("/api/runs", headers=hdr(b)).json()["runs"]] == [other]


def test_list_filters_by_project_and_limits(client, clock):
    s = new_session()
    for _ in range(3):
        post(client, s)
        clock.wall += timedelta(minutes=1)
    assert len(client.get("/api/runs?limit=2", headers=hdr(s)).json()["runs"]) == 2
    assert len(client.get("/api/runs?project_id=testproj", headers=hdr(s)).json()["runs"]) == 3
    assert client.get("/api/runs?project_id=other", headers=hdr(s)).json() == {"runs": []}
    for bad in ("limit=0", "limit=101", "project_id=Not%20a%20project"):
        assert client.get(f"/api/runs?{bad}", headers=hdr(s)).status_code == 422, bad


# ---- GET /api/runs/{run_id} ----------------------------------------------------------------------------------------
def test_detail_has_the_context_result_review_provenance_and_images(make_client, clock):
    client = make_client(app_version="3f2a9c1")
    s = new_session()
    received = clock.wall
    body = post(client, s, ctx=context(source="sample", distance_m=2.25, pose_quality="fair"), overlay=OVERLAY).json()
    run_id = body["run_id"]

    r = client.get(f"/api/runs/{run_id}", headers=hdr(s))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["run_id"] == run_id and d["anchor_id"] == "A1" and d["source"] == "sample"
    assert d["result"] == body["result"] and d["context"]["visible"][1]["guid"] == GUID_DOOR
    assert d["review"] == {}
    assert d["images"] == {"photo": f"/api/runs/{run_id}/photo.jpg", "render": f"/api/runs/{run_id}/render.png",
                           "overlay": f"/api/runs/{run_id}/overlay.jpg"}
    p = d["provenance"]
    assert p["photo_sha256"] == hashlib.sha256(JPEG).hexdigest()
    assert p["render_sha256"] == hashlib.sha256(PNG).hexdigest()
    assert p["overlay_sha256"] == hashlib.sha256(OVERLAY).hexdigest()
    assert p["received_at"].startswith(received.isoformat()[:19]) and p["app_version"] == "3f2a9c1"
    assert (p["source"], p["pose_quality"], p["distance_m"]) == ("sample", "fair", 2.25)
    assert isinstance(d["duration_ms"], int) and d["duration_ms"] >= 0


def test_detail_without_an_outline_image(client):
    s = new_session()
    run_id = post(client, s).json()["run_id"]
    d = client.get(f"/api/runs/{run_id}", headers=hdr(s)).json()
    assert d["images"]["overlay"] is None and d["provenance"]["overlay_sha256"] is None
    assert d["provenance"]["app_version"] == "dev"
    assert client.get(f"/api/runs/{run_id}/overlay.jpg", headers=hdr(s)).status_code == 404


def test_detail_is_for_the_owner_session_only(client):
    s = new_session()
    run_id = post(client, s).json()["run_id"]
    r = client.get(f"/api/runs/{run_id}", headers=hdr(new_session()))
    assert r.status_code == 404 and r.json()["detail"] == {"code": "unknown_run"}
    assert client.get("/api/runs/" + "x" * 22, headers=hdr(s)).status_code == 404
    assert client.get("/api/runs/short", headers=hdr(s)).status_code == 422  # not RUN_ID_PATTERN
    assert client.get(f"/api/runs/{run_id}").status_code == 422  # no session header


def test_the_outline_image_is_stored_and_served_to_its_session_only(client):
    s = new_session()
    run_id = post(client, s, overlay=OVERLAY).json()["run_id"]
    mine = client.get(f"/api/runs/{run_id}/overlay.jpg", headers=hdr(s))
    assert mine.status_code == 200 and mine.content == OVERLAY and mine.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/runs/{run_id}/overlay.jpg", headers=hdr(new_session())).status_code == 404
    # The image route and the detail route live side by side.
    assert client.get(f"/api/runs/{run_id}/photo.jpg", headers=hdr(s)).content == JPEG
    assert client.get(f"/api/runs/{run_id}/other.png", headers=hdr(s)).status_code == 422


# ---- PUT /api/runs/{run_id}/review/{mark} --------------------------------------------------------------------------
def test_confirm_dismiss_and_undo_a_finding(client, clock):
    s = new_session()
    body = post(client, s).json()
    run_id, mark = body["run_id"], door_mark(body)
    clock.wall += timedelta(minutes=3)

    r = review(client, s, run_id, mark, "confirmed")
    assert r.status_code == 200, r.text
    assert r.json() == {"run_id": run_id, "mark": mark, "decision": "confirmed", "at": clock.wall.isoformat().replace("+00:00", "Z")}
    d = client.get(f"/api/runs/{run_id}", headers=hdr(s)).json()
    assert d["review"][str(mark)]["decision"] == "confirmed"
    row = client.get("/api/runs", headers=hdr(s)).json()["runs"][0]
    assert (row["needs_review"], row["confirmed"], row["dismissed"], row["reviewed"]) == (0, 1, 0, 1)

    assert review(client, s, run_id, mark, "dismissed").json()["decision"] == "dismissed"
    row = client.get("/api/runs", headers=hdr(s)).json()["runs"][0]
    assert (row["needs_review"], row["confirmed"], row["dismissed"], row["reviewed"]) == (0, 0, 1, 1)

    undo = review(client, s, run_id, mark, None)
    assert undo.status_code == 200 and undo.json() == {"run_id": run_id, "mark": mark, "decision": None, "at": None}
    assert client.get(f"/api/runs/{run_id}", headers=hdr(s)).json()["review"] == {}
    assert client.get("/api/runs", headers=hdr(s)).json()["runs"][0]["needs_review"] == 1


def test_a_review_needs_the_owner_session_and_a_finding_of_the_run(client):
    s = new_session()
    body = post(client, s).json()
    run_id, mark = body["run_id"], door_mark(body)
    other = review(client, new_session(), run_id, mark, "confirmed")
    assert other.status_code == 404 and other.json()["detail"] == {"code": "unknown_run"}
    assert client.get(f"/api/runs/{run_id}", headers=hdr(s)).json()["review"] == {}  # untouched
    gone = review(client, s, "y" * 22, 1, "confirmed")
    assert gone.status_code == 404 and gone.json()["detail"] == {"code": "unknown_run"}
    no_mark = review(client, s, run_id, 7, "confirmed")  # the run has marks 1 and 2
    assert no_mark.status_code == 404 and no_mark.json()["detail"] == {"code": "unknown_mark"}


@pytest.mark.parametrize("path_mark,payload", [
    (0, {"decision": "confirmed"}), (26, {"decision": "confirmed"}), (1, {"decision": "maybe"}), (1, {}),
    (1, {"decision": "confirmed", "at": "2026-01-01T00:00:00Z"}),  # the time is the server's
])
def test_bad_reviews_are_422(client, path_mark, payload):
    s = new_session()
    run_id = post(client, s).json()["run_id"]
    r = client.put(f"/api/runs/{run_id}/review/{path_mark}", json=payload, headers=hdr(s))
    assert r.status_code == 422, (path_mark, payload)
    assert client.put(f"/api/runs/{run_id}/review/1", json={"decision": "confirmed"}).status_code == 422  # no session


def test_reviews_have_a_per_ip_limit(make_client):
    client = make_client(reviews_per_ip_per_hour=1)
    s = new_session()
    body = post(client, s).json()
    assert review(client, s, body["run_id"], 1, "confirmed").status_code == 200
    r = review(client, s, body["run_id"], 1, None)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "rate_limited" and "retry-after" in r.headers
    # An unknown run is a 404 before the limit is counted.
    assert review(client, s, "z" * 22, 1, "confirmed").status_code == 404


def test_a_failed_save_stores_no_run_and_lists_nothing(client, store, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(store, "save_check_run", boom)
    s = new_session()
    assert post(client, s).json()["saved"] is False
    assert client.get("/api/runs", headers=hdr(s)).json() == {"runs": []}


# ---- the summary of one run ----------------------------------------------------------------------------------------
def _finding(mark, status, confidence, severity):
    return {"mark": mark, "guid": f"g{mark}", "name": f"E{mark}", "ifc_class": "IfcColumn", "status": status,
            "confidence": confidence, "evidence_box": None, "offset": None, "explanation": "", "severity": severity}


def _stored(findings, review=None, **extra) -> CheckRun:
    from datetime import datetime, timezone

    at = datetime(2026, 11, 25, 9, 0, tzinfo=timezone.utc)
    return CheckRun(
        run_id="r" * 22, session_id="s", project_id="site", anchor_id="P1", created_at=at,
        context={"source": "live"}, photo_key="k", render_key="k",
        result={"image_quality": "blurred", "findings": findings, "unexpected": [{"description": "a skip", "confidence": 0.7}],
                "summary": "s", "usage": {"cost_usd_est": 0.0151}, "model_version": "gemini-3.8-flash"},
        review={k: FindingReview(decision=v, at=at) for k, v in (review or {}).items()}, **extra,
    )


def test_summary_counts_flagged_findings_and_decisions():
    run = _stored([
        _finding(1, "missing", 0.92, "high"),
        _finding(2, "misplaced", 0.55, "high"),
        _finding(3, "different_from_design", 0.71, "medium"),
        _finding(4, "cannot_judge", 0.3, None),
        _finding(5, "present_ok", 0.4, None),  # never "flagged", however unsure
    ], review={"1": "confirmed", "2": "dismissed", "4": "confirmed"}, duration_ms=8400)
    s = summarise_run(run)
    assert s.by_status.model_dump() == {"present_ok": 1, "missing": 1, "misplaced": 1, "different_from_design": 1, "cannot_judge": 1}
    assert s.by_severity.model_dump() == {"high": 2, "medium": 1, "low": 0}
    assert s.lowest_confidence == 0.55
    # The decision on the can't-judge mark 4 is kept but not counted: only flagged findings are reviewed.
    assert (s.needs_review, s.confirmed, s.dismissed, s.reviewed) == (1, 1, 1, 2)
    assert s.high_open == 1  # the dismissed high finding was a false alarm
    assert (s.unexpected, s.image_quality, s.model_version, s.cost_usd_est, s.duration_ms) == (1, "blurred", "gemini-3.8-flash", 0.0151, 8400)
    assert s.source == "live"  # from the context when the run has no provenance


def test_summary_of_a_run_with_nothing_flagged_or_an_odd_result():
    s = summarise_run(_stored([_finding(1, "present_ok", 0.9, None)]))
    assert s.lowest_confidence is None and s.needs_review == 0 and s.by_severity.high == 0
    odd = _stored([]).model_copy(update={"result": {"findings": [{"mark": 1}, "junk"]}, "context": {"source": "elsewhere"}})
    s = summarise_run(odd)
    assert s.by_status.model_dump() == {"present_ok": 0, "missing": 0, "misplaced": 0, "different_from_design": 0, "cannot_judge": 0}
    assert s.source is None and s.cost_usd_est is None and s.model_version is None and s.summary == ""


def test_the_provenance_source_wins_over_the_context():
    from datetime import datetime, timezone

    prov = Provenance(photo_sha256="a", render_sha256="b", received_at=datetime(2026, 11, 25, tzinfo=timezone.utc),
                      app_version="dev", source="virtual")
    assert summarise_run(_stored([], provenance=prov)).source == "virtual"
    assert json.loads(_stored([], provenance=prov).model_dump_json())["provenance"]["source"] == "virtual"
