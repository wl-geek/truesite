"""Issues: Gemini drafts from a stored finding, save, list, session scoping and demo issues."""
from .conftest import DEMO_ISSUES, GUID_DOOR, GUID_WALL, new_session, write_project
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


def test_list_without_a_project_returns_every_project(make_client, models):
    # The Issues page lists one session's issues across all projects (A-04).
    write_project(models, "second", demo_issues=[{**i, "project_id": "second"} for i in DEMO_ISSUES[:1]])
    client = make_client()
    s = new_session()
    for project_id in ("testproj", "second"):
        r = client.post("/api/issues", json={"project_id": project_id, "guid": GUID_WALL, "title": f"In {project_id}"}, headers=hdr(s))
        assert r.status_code == 201, r.text
    everything = client.get("/api/issues", headers=hdr(s)).json()
    assert sorted(i["project_id"] for i in everything["issues"]) == ["second", "testproj"]
    assert sorted(i["project_id"] for i in everything["demo"]) == ["second", "testproj", "testproj"]
    one = client.get("/api/issues?project_id=second", headers=hdr(s)).json()
    assert [i["project_id"] for i in one["issues"] + one["demo"]] == ["second", "second"]


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
