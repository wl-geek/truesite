"""Issues: Gemini drafts from a stored finding, save, list, session scoping and demo issues."""
from .conftest import GUID_DOOR, GUID_WALL, new_session
from .test_check_route import post as post_check


def check_run(client, session):
    body = post_check(client, session).json()
    door = next(f for f in body["result"]["findings"] if f["guid"] == GUID_DOOR)
    return body["run_id"], door["mark"]


def hdr(session):
    return {"X-Session-Id": session}


def test_draft_from_a_finding(client):
    session = new_session()
    run_id, mark = check_run(client, session)
    r = client.post("/api/issues/draft", json={"run_id": run_id, "mark": mark}, headers=hdr(session))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"].startswith("Door D-01") and "Visual check, not a survey." in d["description"] and d["suggested_action"]


def test_draft_is_session_scoped_and_checks_the_mark(client):
    session = new_session()
    run_id, _ = check_run(client, session)
    assert client.post("/api/issues/draft", json={"run_id": run_id, "mark": 1}, headers=hdr(new_session())).json()["detail"]["code"] == "unknown_run"
    assert client.post("/api/issues/draft", json={"run_id": run_id, "mark": 9}, headers=hdr(session)).json()["detail"]["code"] == "unknown_mark"


def test_save_and_list_with_photo_and_scoping(client):
    session = new_session()
    run_id, mark = check_run(client, session)
    body = {"project_id": "testproj", "guid": GUID_DOOR, "run_id": run_id, "finding_ref": f"{run_id}:{mark}",
            "title": "Door D-01 about 30 cm right", "description": "Visual check, not a survey.", "severity": "medium",
            "crop_box": [100, 450, 900, 700]}
    r = client.post("/api/issues", json=body, headers=hdr(session))
    assert r.status_code == 201, r.text
    issue = r.json()
    assert issue["photo_url"] == f"/api/runs/{run_id}/photo.jpg" and issue["session_id"] == session and issue["status"] == "open"
    mine = client.get("/api/issues?project_id=testproj", headers=hdr(session)).json()
    assert [i["id"] for i in mine["issues"]] == [issue["id"]]
    assert len(mine["demo"]) == 2 and all(i["session_id"] == "demo" for i in mine["demo"])
    other = client.get("/api/issues?project_id=testproj", headers=hdr(new_session())).json()
    assert other["issues"] == [] and len(other["demo"]) == 2


def test_save_rejects_unknown_things(client):
    s = new_session()
    base = {"project_id": "testproj", "guid": GUID_WALL, "title": "x"}
    assert client.post("/api/issues", json={**base, "guid": "0" * 22}, headers=hdr(s)).json()["detail"]["code"] == "unknown_element"
    assert client.post("/api/issues", json={**base, "project_id": "nope"}, headers=hdr(s)).json()["detail"]["code"] == "unknown_project"
    assert client.post("/api/issues", json={**base, "run_id": "A" * 22}, headers=hdr(s)).json()["detail"]["code"] == "unknown_run"
    assert client.post("/api/issues", json={**base, "title": ""}, headers=hdr(s)).status_code == 422
    assert client.post("/api/issues", json={**base, "session_id": "demo"}, headers=hdr(s)).status_code == 422  # extra field
    r = client.post("/api/issues", json=base, headers=hdr(s))
    assert r.status_code == 201 and r.json()["photo_url"] is None


def test_demo_session_cannot_be_claimed(client):
    assert client.get("/api/issues", headers=hdr("demo")).status_code == 422


def test_an_unsaved_run_takes_no_issues(client, store, monkeypatch):
    """saved=false means the run wasn't stored: its run_id 404s, so the web sends run_id null instead (A-12)."""
    def boom(*_a):
        raise RuntimeError("gcs down")
    monkeypatch.setattr(store, "put_blob", boom)
    session = new_session()
    body = post_check(client, session).json()
    assert body["saved"] is False
    base = {"project_id": "testproj", "guid": GUID_DOOR, "title": "Door D-01 about 30 cm right"}
    r = client.post("/api/issues", json={**base, "run_id": body["run_id"]}, headers=hdr(session))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "unknown_run"
    r = client.post("/api/issues", json={**base, "run_id": None}, headers=hdr(session))
    assert r.status_code == 201 and r.json()["photo_url"] is None
