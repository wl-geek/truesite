from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_MODELS_DIR, Settings
from app.limits import SlidingWindowLimiter
from app.main import build_store, create_app, seed_demo_issues
from app.projects import ProjectRepo
from app.store import InMemoryStore

from .conftest import GUID_DOOR, GUID_WALL, Clock, new_session, write_project
from .test_check_route import context as check_context, post as post_check


def test_health_reports_modes(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"ok": True, "gemini_mode": "fake", "store_backend": "memory"}


@pytest.mark.parametrize("xff,expected", [(None, "198.51.100.7"), ("6.6.6.6, 203.0.113.5", "203.0.113.5")])
def test_whoami_uses_the_right_most_forwarded_entry(client: TestClient, xff: str | None, expected: str) -> None:
    r = client.get("/api/whoami", headers={"X-Forwarded-For": xff} if xff else {})
    assert r.json() == {"ip": expected, "x_forwarded_for": xff, "peer": "198.51.100.7"}


def test_info_logs_reach_stderr(dist: Path, models: Path, store: InMemoryStore, clock: Clock) -> None:
    # uvicorn configures only its own loggers; without this, "truesite" INFO lines (Gemini usage
    # for Ask and Draft) are dropped by Python's last-resort handler, which shows WARNING and up.
    create_app(Settings(static_dir=dist, models_dir=models), store=store, now=clock.now)
    create_app(Settings(static_dir=dist, models_dir=models), store=store, now=clock.now)
    log = logging.getLogger("truesite")
    assert log.isEnabledFor(logging.INFO)
    assert len(log.handlers) == 1  # one handler, however many apps are built


def test_app_state_is_filled(dist: Path, models: Path, store: InMemoryStore, clock: Clock) -> None:
    settings = Settings(static_dir=dist, models_dir=models, checks_per_ip_per_hour=7, asks_per_ip_per_hour=9,
                        issues_per_ip_per_hour=11)
    client = object()
    app = create_app(settings, store=store, client=client, now=clock.now)
    s = app.state
    assert s.settings is settings and s.store is store and s.client is client and s.now == clock.now
    assert isinstance(s.repo, ProjectRepo) and s.repo.models_dir == models
    assert isinstance(s.check_limiter, SlidingWindowLimiter) and s.check_limiter.limit == 7
    assert isinstance(s.ask_limiter, SlidingWindowLimiter) and s.ask_limiter.limit == 9
    assert isinstance(s.issue_limiter, SlidingWindowLimiter) and s.issue_limiter.limit == 11
    assert s.check_limiter.window_s == s.ask_limiter.window_s == s.issue_limiter.window_s == 3600


@pytest.mark.parametrize("path", ["/api/docs", "/api/openapi.json"])
def test_api_docs_are_off_by_default(client: TestClient, path: str) -> None:
    # Swagger UI loads an unpinned script from jsDelivr on our origin (A-71).
    r = client.get(path)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


def test_api_docs_flag_turns_them_on(make_client) -> None:
    c = make_client(api_docs=True)
    assert c.get("/api/docs").status_code == 200 and "swagger" in c.get("/api/docs").text.lower()
    assert c.get("/api/openapi.json").json()["info"]["title"] == "TrueSite"


def test_defaults_without_arguments(dist: Path, models: Path) -> None:
    app = create_app(Settings(static_dir=dist, models_dir=models))
    assert isinstance(app.state.store, InMemoryStore) and app.state.client is None


def test_build_store() -> None:
    assert isinstance(build_store(Settings()), InMemoryStore)
    with pytest.raises(RuntimeError, match="GCS_BUCKET"):
        build_store(Settings(store_backend="gcp"))


def test_demo_issues_are_seeded_as_session_demo(make_client, store: InMemoryStore, clock: Clock) -> None:
    make_client()
    demo = store.list_issues("demo")
    assert [i.id for i in demo] == ["demo-testproj-1", "demo-testproj-2"]  # newest first = file order
    first = demo[0]
    assert (first.session_id, first.project_id, first.guid, first.photo_url) == ("demo", "testproj", GUID_DOOR, None)
    assert (first.severity, first.status, first.created_at) == ("medium", "open", clock.wall)
    assert demo[1].created_at == clock.wall - timedelta(seconds=1)


def test_seeding_is_idempotent(make_client, store: InMemoryStore) -> None:
    make_client()
    make_client()
    assert len(store.list_issues("demo")) == 2
    assert len(store.issues) == 2


def test_seeding_covers_every_project(tmp_path: Path, store: InMemoryStore, clock: Clock) -> None:
    models = tmp_path / "m"
    write_project(models, "alpha")
    write_project(models, "beta", demo_issues=None)
    assert seed_demo_issues(store, ProjectRepo(models), clock.now) == 2
    assert {i.id for i in store.list_issues("demo")} == {"demo-alpha-1", "demo-alpha-2"}


def test_bad_demo_rows_do_not_stop_the_app(tmp_path: Path, dist: Path, store: InMemoryStore) -> None:
    models = tmp_path / "m"
    d = write_project(models, "broken")
    (d / "demo_issues.json").write_text(json.dumps([{"project_id": "broken", "guid": "x", "title": ""}]))
    c = TestClient(create_app(Settings(static_dir=dist, models_dir=models), store=store))
    assert c.get("/api/health").status_code == 200
    assert store.list_issues("demo") == []


def test_the_committed_demo_issues_are_seeded(tmp_path: Path, store: InMemoryStore) -> None:
    # The default models dir: whatever demo_issues.json the committed projects ship (site ships none) is seeded.
    create_app(Settings(static_dir=tmp_path / "no-dist"), store=store)
    repo = ProjectRepo(DEFAULT_MODELS_DIR)
    assert "site" in repo.project_ids()
    expected = {f"demo-{p}-{n}" for p in repo.project_ids() for n in range(1, len(repo.demo_issues(p)) + 1)}
    assert {i.id for i in store.list_issues("demo")} == expected


# ---- 422 bodies are strict JSON ----------------------------------------------------------------------
RUN = "a" * 22
# json.loads reads NaN, Infinity, -Infinity and an out-of-range 1e999 (as inf); strict JSON has no words for them.
NON_FINITE = [("NaN", "NaN"), ("Infinity", "Infinity"), ("-Infinity", "-Infinity"), ("1e999", "Infinity")]
JSON_POSTS = {  # path -> (body with {bad} in one field, that field's loc)
    "/api/ask": ('{{"project_id": "testproj", "guid": "%s", "question": {bad}}}' % GUID_WALL, ["body", "question"]),
    "/api/report": ('{{"run_ids": [{bad}]}}', ["body", "run_ids", 0]),
    "/api/issues/draft": ('{{"run_id": "%s", "mark": {bad}}}' % RUN, ["body", "mark"]),
    "/api/issues": ('{{"project_id": "testproj", "guid": "%s", "title": {bad}}}' % GUID_WALL, ["body", "title"]),
}


def strict_json(text: str) -> Any:
    """Parse as browsers do: JSON.parse rejects NaN and Infinity."""
    def reject(token: str) -> None:
        raise AssertionError(f"{token} in a response body")
    return json.loads(text, parse_constant=reject)


@pytest.mark.parametrize("token,echo", NON_FINITE)
@pytest.mark.parametrize("path", [*JSON_POSTS, "/api/check"])
def test_non_finite_numbers_in_a_body_get_the_usual_422(client: TestClient, path: str, token: str, echo: str) -> None:
    """C-12: FastAPI's default handler echoed NaN or inf back in `input`, JSONResponse refused it, and every POST
    answered 500. The 422 keeps FastAPI's shape and loc paths; the number comes back as a string."""
    if path == "/api/check":
        ctx = check_context().replace('"distance_m": 1.5', f'"distance_m": {token}')
        r, loc = post_check(client, ctx=ctx), ["body", "context", "distance_m"]
    else:
        body, loc = JSON_POSTS[path]
        r = client.post(path, content=body.format(bad=token),
                        headers={"X-Session-Id": new_session(), "Content-Type": "application/json"})
    assert r.status_code == 422, r.text
    detail = strict_json(r.text)["detail"]
    assert [e["loc"] for e in detail] == [loc]
    assert {"type", "loc", "msg", "input"} <= set(detail[0]) and detail[0]["input"] == echo


def test_non_finite_numbers_nested_in_an_input_are_spelled_out(client: TestClient) -> None:
    body = '{"project_id": "testproj", "guid": "%s", "question": {"q": [NaN, 1.5, -Infinity]}}' % GUID_WALL
    r = client.post("/api/ask", content=body, headers={"X-Session-Id": new_session(), "Content-Type": "application/json"})
    assert r.status_code == 422
    assert strict_json(r.text)["detail"][0]["input"] == {"q": ["NaN", 1.5, "-Infinity"]}


def test_other_422s_keep_fastapis_body(client: TestClient) -> None:
    r = client.post("/api/ask", json={"project_id": "testproj", "guid": GUID_WALL, "question": ""},
                    headers={"X-Session-Id": new_session()})
    assert r.status_code == 422
    assert r.json() == {"detail": [{"type": "string_too_short", "loc": ["body", "question"],
                                    "msg": "String should have at least 1 character", "input": "",
                                    "ctx": {"min_length": 1}}]}
