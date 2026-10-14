from __future__ import annotations

import json
from datetime import timedelta

from fastapi.testclient import TestClient

from app.config import MiB
from app.store import InMemoryStore

from .conftest import JPEG, PNG, check_files, context, new_session


def _post(client: TestClient, sid: str | None = None, files=None, ctx: str | None = None, headers=None):
    hdrs = {"X-Session-Id": sid or new_session(), **(headers or {})}
    return client.post("/api/check", files=files or check_files(), data={"context": ctx or context()}, headers=hdrs)


def test_happy_path_stores_blobs_under_session(client: TestClient, store: InMemoryStore) -> None:
    sid = new_session()
    r = _post(client, sid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] is True
    assert body["result"]["summary"] == "stub"
    run_id = body["run_id"]
    assert store.blobs[f"uploads/{sid}/{run_id}/photo.jpg"] == (JPEG, "image/jpeg")
    assert store.blobs[f"uploads/{sid}/{run_id}/render.png"] == (PNG, "image/png")
    run = store.get_check_run(run_id, sid)
    assert run is not None and run.project_id == "room1" and run.context["visible"][0]["mark"] == 1


def test_photo_over_4mib_is_413(client: TestClient) -> None:
    big = JPEG + b"\x00" * (4 * MiB)
    r = _post(client, files=check_files(photo=big))
    assert r.status_code == 413
    assert "photo" in r.json()["detail"]


def test_render_over_4mib_is_413(client: TestClient) -> None:
    big = PNG + b"\x00" * (4 * MiB)
    r = _post(client, files=check_files(render=big))
    assert r.status_code == 413
    assert "render" in r.json()["detail"]


def test_exactly_4mib_is_accepted(client: TestClient) -> None:
    exact = JPEG + b"\x00" * (4 * MiB - len(JPEG))
    assert len(exact) == 4 * MiB
    assert _post(client, files=check_files(photo=exact)).status_code == 200


def test_whole_body_cap_rejects_on_content_length(client: TestClient, store: InMemoryStore) -> None:
    near = b"\x00" * (4 * MiB + 600 * 1024)  # 2 x 4.6 MiB > 9 MiB body cap
    r = _post(client, files=check_files(photo=JPEG + near, render=PNG + near))
    assert r.status_code == 413
    assert "Request body" in r.json()["detail"]
    assert store.runs == {}


def test_whole_body_cap_rejects_chunked_body_without_content_length(client: TestClient) -> None:
    boundary = "x-boundary-123"
    payload = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"p.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode() + JPEG + b"\x00" * (10 * MiB) + f"\r\n--{boundary}--\r\n".encode()

    def chunks():
        for i in range(0, len(payload), 256 * 1024):
            yield payload[i : i + 256 * 1024]

    r = client.post(
        "/api/check",
        content=chunks(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Session-Id": new_session()},
    )
    assert r.status_code == 413
    assert r.request.headers.get("content-length") is None  # really was chunked


def test_wrong_image_type_is_415(client: TestClient) -> None:
    assert _post(client, files=check_files(photo=PNG)).status_code == 415
    assert _post(client, files=check_files(render=JPEG)).status_code == 415


def _locs(r) -> list[list]:
    return [e["loc"] for e in r.json()["detail"]]


def test_context_not_json_is_422(client: TestClient) -> None:
    r = _post(client, ctx="{not json")
    assert r.status_code == 422
    assert r.json()["detail"][0]["type"] == "json_invalid"
    assert r.json()["detail"][0]["loc"][:2] == ["body", "context"]


def test_context_schema_errors_are_422(client: TestClient) -> None:
    bad_box = json.loads(context())
    bad_box["visible"][0]["box"] = [0, 0, 1001, 10]
    r = _post(client, ctx=json.dumps(bad_box))
    assert r.status_code == 422
    assert ["body", "context", "visible", 0, "box", 2] in _locs(r)

    r = _post(client, ctx=context(pose_quality="great"))
    assert r.status_code == 422
    assert ["body", "context", "pose_quality"] in _locs(r)

    r = _post(client, ctx=context(project_id="../etc"))
    assert r.status_code == 422

    r = _post(client, ctx=context(unexpected_field=1))
    assert r.status_code == 422

    dup = json.loads(context())
    dup["visible"][1]["mark"] = 1
    r = _post(client, ctx=json.dumps(dup))
    assert r.status_code == 422
    assert "unique" in r.json()["detail"][0]["msg"]

    flipped = json.loads(context())
    flipped["visible"][0]["box"] = [900, 0, 100, 10]
    assert _post(client, ctx=json.dumps(flipped)).status_code == 422

    too_many = json.loads(context())
    too_many["visible"] = [dict(too_many["visible"][0], mark=i) for i in range(1, 27)]
    assert _post(client, ctx=json.dumps(too_many)).status_code == 422


def test_context_too_long_is_422(client: TestClient) -> None:
    r = _post(client, ctx=context(pad="x" * 70_000))
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["body", "context"]


def test_missing_parts_are_422(client: TestClient) -> None:
    r = client.post(
        "/api/check",
        files={"photo": ("p.jpg", JPEG, "image/jpeg")},
        data={"context": context()},
        headers={"X-Session-Id": new_session()},
    )
    assert r.status_code == 422
    assert ["body", "render"] in _locs(r)


def test_sample_result_is_saved_for_fallback(client: TestClient) -> None:
    sid = new_session()
    assert client.get("/api/saved-results/room1-01").status_code == 404
    assert _post(client, sid, ctx=context(sample_id="room1-01")).status_code == 200
    saved = client.get("/api/saved-results/room1-01").json()
    assert saved["summary"] == "stub"
    assert saved["saved_at"].startswith("2026-10-15T23:59")


def test_storage_failure_still_returns_findings(make_client, store: InMemoryStore) -> None:
    def boom(*a, **k):
        raise RuntimeError("GCS down")

    store.put_blob = boom  # type: ignore[method-assign]
    r = make_client().post(
        "/api/check", files=check_files(), data={"context": context()}, headers={"X-Session-Id": new_session()}
    )
    assert r.status_code == 200
    assert r.json()["saved"] is False
    assert r.json()["result"]["summary"] == "stub"


def test_daily_cap_is_enforced_and_resets_next_utc_day(make_client, clock, store: InMemoryStore) -> None:
    c = make_client(daily_check_cap=2)
    assert _post(c).status_code == 200
    assert _post(c).status_code == 200
    r = _post(c)
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "daily_cap"
    assert store.daily == {"2026-10-15": 2}

    clock.wall += timedelta(minutes=2)  # 00:01 UTC on the 16th
    assert _post(c).status_code == 200
    assert store.daily["2026-10-16"] == 1


def test_cap_store_failure_fails_closed_with_503(make_client, store: InMemoryStore) -> None:
    calls = []

    def broken(*a, **k):
        raise RuntimeError("Firestore unavailable")

    store.try_consume_daily = broken  # type: ignore[method-assign]
    c = make_client()
    c.app.state.checker = lambda *a: calls.append(a) or {"summary": "should not run"}
    r = _post(c)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "busy"
    assert r.headers["Retry-After"] == "2"
    assert calls == []  # Gemini never called
