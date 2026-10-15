from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.limits import SlidingWindowLimiter
from app.main import build_store, create_app, seed_demo_issues
from app.projects import ProjectRepo
from app.store import InMemoryStore

from .conftest import GUID_DOOR, Clock, write_project


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
    settings = Settings(static_dir=dist, models_dir=models, checks_per_ip_per_hour=7, asks_per_ip_per_hour=9)
    client = object()
    app = create_app(settings, store=store, client=client, now=clock.now)
    s = app.state
    assert s.settings is settings and s.store is store and s.client is client and s.now == clock.now
    assert isinstance(s.repo, ProjectRepo) and s.repo.models_dir == models
    assert isinstance(s.check_limiter, SlidingWindowLimiter) and s.check_limiter.limit == 7
    assert isinstance(s.ask_limiter, SlidingWindowLimiter) and s.ask_limiter.limit == 9
    assert s.check_limiter.window_s == s.ask_limiter.window_s == 3600


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


def test_the_committed_room1_demo_issues_are_seeded(tmp_path: Path, store: InMemoryStore) -> None:
    create_app(Settings(static_dir=tmp_path / "no-dist"), store=store)
    assert [i.id for i in store.list_issues("demo", "room1")] == ["demo-room1-1", "demo-room1-2"]
