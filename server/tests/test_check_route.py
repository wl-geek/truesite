"""POST /api/check end to end with the offline FakeGeminiClient, plus limits, errors,
session-scoped images and saved sample results."""
import json
from types import SimpleNamespace

import httpx

from app import services

from .conftest import GUID_DOOR, GUID_WALL, JPEG, PNG, new_session
from .test_ask_route import no_credentials


def context(**overrides) -> str:
    ctx = {
        "project_id": "testproj", "anchor_id": "A1", "pose_quality": "good", "distance_m": 1.5,
        "visible": [
            {"mark": 1, "guid": GUID_WALL, "ifc_class": "IfcWall", "name": "Partition P-01", "box": [0, 0, 600, 400]},
            {"mark": 2, "guid": GUID_DOOR, "ifc_class": "IfcDoor", "name": "Door D-01", "box": [100, 450, 900, 700]},
        ],
    }
    ctx.update(overrides)
    return json.dumps(ctx)


def post(client, session=None, photo=JPEG, render=PNG, ctx=None):
    return client.post(
        "/api/check",
        files={"photo": ("p.jpg", photo, "image/jpeg"), "render": ("r.png", render, "image/png")},
        data={"context": ctx or context()},
        headers={"X-Session-Id": session or new_session()},
    )


def test_fake_check_end_to_end(client):
    r = post(client)
    assert r.status_code == 200, r.text
    body = r.json()
    findings = {f["mark"]: f for f in body["result"]["findings"]}
    assert findings[1]["status"] == "present_ok" and findings[1]["severity"] is None
    assert findings[2]["status"] == "misplaced" and findings[2]["severity"] == "medium"
    assert findings[2]["offset"] == {"direction": "right", "approx_cm": 30}
    assert body["saved"] is True and body["photo_url"] == f"/api/runs/{body['run_id']}/photo.jpg"
    assert body["result"]["model_version"] == "fake" and body["result"]["usage"]["total_tokens"] == 0


def test_run_images_are_session_scoped(client):
    session = new_session()
    run_id = post(client, session).json()["run_id"]
    mine = client.get(f"/api/runs/{run_id}/photo.jpg", headers={"X-Session-Id": session})
    assert mine.status_code == 200 and mine.content == JPEG and mine.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/runs/{run_id}/render.png", headers={"X-Session-Id": session}).content == PNG
    assert client.get(f"/api/runs/{run_id}/photo.jpg", headers={"X-Session-Id": new_session()}).status_code == 404


def test_upload_errors(make_client):
    client = make_client(max_upload_bytes=100)
    assert post(client, photo=JPEG + b"\x00" * 200).status_code == 413
    assert post(client, photo=PNG).status_code == 415
    bad = post(client, ctx=context(pose_quality="great"))
    assert bad.status_code == 422 and bad.json()["detail"][0]["loc"][:3] == ["body", "context", "pose_quality"]
    assert post(client, ctx=context(project_id="nope")).status_code == 404


def test_missing_session_is_rejected(client):
    r = client.post("/api/check", files={"photo": ("p.jpg", JPEG), "render": ("r.png", PNG)}, data={"context": context()})
    assert r.status_code == 422


def test_per_ip_rate_limit(make_client):
    client = make_client(checks_per_ip_per_hour=1)
    assert post(client).status_code == 200
    r = post(client)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "rate_limited" and "retry-after" in r.headers


def test_daily_cap_across_ips(make_client):
    assert post(make_client(peer="198.51.100.1", daily_check_cap=1)).status_code == 200
    r = post(make_client(peer="198.51.100.2", daily_check_cap=1))
    assert r.status_code == 429 and r.json()["detail"]["code"] == "daily_cap"


def test_cap_store_failure_fails_closed(client, store, monkeypatch):
    def boom(*_a):
        raise RuntimeError("firestore down")
    monkeypatch.setattr(store, "try_consume_daily", boom)
    r = post(client)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "busy"


class JunkClient:
    vertexai = False

    def __init__(self):
        self.models = SimpleNamespace(generate_content=lambda **_k: SimpleNamespace(
            text="not json", parsed=None, usage_metadata=None, candidates=[], prompt_feedback=None))


class TimeoutClient:
    vertexai = False

    def __init__(self):
        def boom(**_k):
            raise httpx.ReadTimeout("slow")
        self.models = SimpleNamespace(generate_content=boom)


def test_client_setup_error_is_a_json_500_and_uses_no_quota(make_client, monkeypatch):
    client = make_client(daily_check_cap=1)
    build = services.build_client
    monkeypatch.setattr(services, "build_client", no_credentials)
    r = post(client)
    assert r.status_code == 500 and r.json()["detail"]["code"] == "model_bad_request"
    monkeypatch.setattr(services, "build_client", build)
    assert post(client).status_code == 200  # the failed setup did not use the one allowed check


def test_model_bad_output_is_502(client):
    client.app.state.client = JunkClient()
    r = post(client)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "model_bad_output"


def test_model_timeout_is_503(client):
    client.app.state.client = TimeoutClient()
    r = post(client)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "model_unavailable"


def test_sample_result_is_saved_and_served(client):
    assert client.get("/api/saved-results/room1-door").status_code == 404
    assert post(client, ctx=context(sample_id="room1-door")).status_code == 200
    saved = client.get("/api/saved-results/room1-door").json()
    assert saved["saved_at"] and len(saved["findings"]) == 2


def test_persistence_failure_still_returns_findings(client, store, monkeypatch):
    def boom(*_a):
        raise RuntimeError("gcs down")
    monkeypatch.setattr(store, "put_blob", boom)
    r = post(client)
    assert r.status_code == 200 and r.json()["saved"] is False and r.json()["photo_url"] is None
