"""Shared dependencies: the X-Session-Id header and enforce_limits, on stand-in routes."""
from __future__ import annotations

import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.config import Settings
from app.deps import ClientDep, NowDep, RepoDep, SessionId, SettingsDep, StoreDep, enforce_limits
from app.main import create_app
from app.store import InMemoryStore

from .conftest import Clock, new_session


@pytest.fixture
def api(tmp_path: Path, models: Path, store: InMemoryStore, clock: Clock) -> TestClient:
    settings = Settings(static_dir=tmp_path / "no-dist", models_dir=models, checks_per_ip_per_hour=2,
                        asks_per_ip_per_hour=1, daily_check_cap=3, daily_ask_cap=5)
    marker = object()
    app = create_app(settings, store=store, client=marker, now=clock.now, limiter_clock=clock.monotonic)

    @app.get("/api/_t/session")
    def session(session_id: SessionId) -> dict[str, str]:
        return {"session_id": session_id}

    @app.get("/api/_t/deps")
    def deps(request: Request, settings: SettingsDep, store: StoreDep, repo: RepoDep, client: ClientDep,
             now: NowDep) -> dict[str, Any]:
        s = request.app.state
        return {"same": [settings is s.settings, store is s.store, repo is s.repo, client is marker,
                         now() == clock.wall]}

    @app.post("/api/_t/check")
    def limited_check(request: Request, settings: SettingsDep) -> dict[str, bool]:
        enforce_limits(request, "check_limiter", "", settings.daily_check_cap)
        return {"ok": True}

    @app.post("/api/_t/ask")
    def limited_ask(request: Request, settings: SettingsDep) -> dict[str, bool]:
        enforce_limits(request, "ask_limiter", "-ask", settings.daily_ask_cap)
        return {"ok": True}

    return TestClient(app, client=("198.51.100.7", 50000))


def from_ip(ip: str) -> dict[str, str]:
    return {"X-Forwarded-For": ip}


# ---- X-Session-Id ----------------------------------------------------------------------------
@pytest.mark.parametrize(
    "bad",
    [None, "", "demo", "not-a-uuid", str(uuid.uuid4()).upper(), str(uuid.uuid1()), str(uuid.uuid4()) + "x",
     "../../etc/passwd"],
)
def test_session_header_is_required_and_validated(api: TestClient, bad: str | None) -> None:
    r = api.get("/api/_t/session", headers={} if bad is None else {"X-Session-Id": bad})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["header", "X-Session-Id"]


def test_valid_session_header_any_case(api: TestClient) -> None:
    sid = new_session()
    assert api.get("/api/_t/session", headers={"x-session-id": sid}).json() == {"session_id": sid}


def test_getters_return_app_state(api: TestClient) -> None:
    assert api.get("/api/_t/deps").json() == {"same": [True, True, True, True, True]}


# ---- enforce_limits ------------------------------------------------------------------------------
def test_per_ip_limit_then_retry_after(api: TestClient, clock: Clock) -> None:
    assert api.post("/api/_t/check", headers=from_ip("203.0.113.5")).status_code == 200
    clock.mono += 60
    assert api.post("/api/_t/check", headers=from_ip("203.0.113.5")).status_code == 200
    r = api.post("/api/_t/check", headers=from_ip("203.0.113.5"))
    assert r.status_code == 429
    assert r.json() == {"detail": {"code": "rate_limited", "retry_after_s": 3540}}
    assert r.headers["Retry-After"] == "3540"
    # a forged left-hand X-Forwarded-For entry does not get a fresh bucket
    assert api.post("/api/_t/check", headers=from_ip("10.9.9.9, 203.0.113.5")).status_code == 429
    clock.mono += 3600
    assert api.post("/api/_t/check", headers=from_ip("203.0.113.5")).status_code == 200


def test_daily_cap_is_global_and_per_utc_day(api: TestClient, store: InMemoryStore, clock: Clock) -> None:
    for ip in ("203.0.113.1", "203.0.113.2", "203.0.113.3"):
        assert api.post("/api/_t/check", headers=from_ip(ip)).status_code == 200
    r = api.post("/api/_t/check", headers=from_ip("203.0.113.4"))
    assert r.status_code == 429 and r.json() == {"detail": {"code": "daily_cap"}}
    assert store.daily == {"2026-10-15": 3}
    clock.wall += timedelta(minutes=2)  # 23:59 -> 00:01 UTC: a new day
    assert api.post("/api/_t/check", headers=from_ip("203.0.113.5")).status_code == 200
    assert store.daily == {"2026-10-15": 3, "2026-10-16": 1}


def test_ask_counter_is_separate(api: TestClient, store: InMemoryStore) -> None:
    assert api.post("/api/_t/ask", headers=from_ip("203.0.113.1")).status_code == 200
    assert api.post("/api/_t/ask", headers=from_ip("203.0.113.1")).json()["detail"]["code"] == "rate_limited"
    assert api.post("/api/_t/check", headers=from_ip("203.0.113.1")).status_code == 200  # own limiter
    assert store.daily == {"2026-10-15-ask": 1, "2026-10-15": 1}


def test_rate_limited_calls_do_not_use_the_daily_cap(api: TestClient, store: InMemoryStore) -> None:
    for _ in range(5):
        api.post("/api/_t/check", headers=from_ip("203.0.113.9"))
    assert store.daily == {"2026-10-15": 2}


def test_cap_check_failure_is_503_busy(api: TestClient, store: InMemoryStore, monkeypatch) -> None:
    def broken(day: str, cap: int) -> tuple[bool, int]:
        raise RuntimeError("firestore down")

    monkeypatch.setattr(store, "try_consume_daily", broken)
    r = api.post("/api/_t/check")
    assert r.status_code == 503
    assert r.json() == {"detail": {"code": "busy"}} and r.headers["Retry-After"] == "2"
