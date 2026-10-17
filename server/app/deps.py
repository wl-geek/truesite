"""FastAPI dependencies shared by every router (contract section 10).

Routers never import main.py: everything they need hangs off request.app.state, which
create_app() fills in (settings, store, repo, client, now, check_limiter, ask_limiter, issue_limiter).
"""
from __future__ import annotations

import logging
import math
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request

from .config import Settings
from .limits import client_ip, rate_key
from .projects import ProjectRepo
from .schemas import SESSION_ID_PATTERN
from .store import Store

log = logging.getLogger("truesite")


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> Store:
    return request.app.state.store


def get_repo(request: Request) -> ProjectRepo:
    return request.app.state.repo


def get_client(request: Request) -> Any:
    return request.app.state.client


def get_now(request: Request) -> Callable[[], datetime]:
    return request.app.state.now


# Missing or malformed header -> 422 with loc ["header", "X-Session-Id"].
SessionId = Annotated[str, Header(alias="X-Session-Id", pattern=SESSION_ID_PATTERN)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
StoreDep = Annotated[Store, Depends(get_store)]
RepoDep = Annotated[ProjectRepo, Depends(get_repo)]
ClientDep = Annotated[Any, Depends(get_client)]
NowDep = Annotated[Callable[[], datetime], Depends(get_now)]


def enforce_rate_limit(request: Request, limiter_name: str) -> None:
    """Per-IP sliding window only: 429 rate_limited (+ Retry-After). For writes that make no
    Gemini call (POST /api/issues), so they never touch the daily caps."""
    state = request.app.state
    ip = client_ip(request, state.settings.trusted_proxy_hops)
    allowed, retry_after = getattr(state, limiter_name).hit(rate_key(ip))
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "retry_after_s": retry_after},
            headers={"Retry-After": str(retry_after)},
        )


def enforce_limits(request: Request, limiter_name: str, day_suffix: str, cap: int) -> None:
    """Per-IP sliding window, then the global daily cap. Call it after validating the request
    (so bad requests do not use up the caller's allowance) and before calling Gemini.

    limiter_name: "check_limiter" or "ask_limiter" (attributes of app.state).
    day_suffix:   "" for checks, "-ask" for questions -> store key "2026-10-12" / "2026-10-12-ask".

    Blocking (the store call): use it from plain `def` endpoints or via run_in_threadpool.
    Raises 429 rate_limited (+ Retry-After), 429 daily_cap, or 503 busy when the cap check
    itself fails (fail closed: no cap check, no Gemini call).
    """
    enforce_rate_limit(request, limiter_name)
    state = request.app.state
    day = state.now().astimezone(timezone.utc).strftime("%Y-%m-%d")
    try:
        ok, _count = state.store.try_consume_daily(f"{day}{day_suffix}", cap)
    except Exception:  # noqa: BLE001 - fail closed
        log.exception("daily cap check failed")
        raise HTTPException(status_code=503, detail={"code": "busy"}, headers={"Retry-After": "2"}) from None
    if not ok:  # the cap resets at midnight UTC: say how long that is, so the web can count down
        now = state.now().astimezone(timezone.utc)
        wait = max(1, math.ceil(((now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0) - now).total_seconds()))
        raise HTTPException(status_code=429, detail={"code": "daily_cap", "retry_after_s": wait}, headers={"Retry-After": str(wait)})
