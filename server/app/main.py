"""FastAPI app factory: API routers + the built SPA on one origin.

Run locally (from server/):  GEMINI_MODE=fake uv run uvicorn --factory app.main:create_app --reload --port 8000
Cloud Run:                   see the root Dockerfile (listens on $PORT, 0.0.0.0)

create_app() fills app.state (settings, store, repo, client, now, check_limiter, ask_limiter, issue_limiter);
routers read it through app/deps.py and never import this module.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI, Request
from starlette.middleware.gzip import GZipMiddleware

from .config import Settings
from .limits import SlidingWindowLimiter, client_ip
from .projects import ProjectRepo
from .routes import ask, check, issues, projects
from .schemas import DEMO_SESSION, Issue, IssueIn
from .security_headers import SecurityHeadersMiddleware
from .spa import SPAStaticFiles
from .store import InMemoryStore, Store
from .uploads import BodySizeLimitMiddleware

log = logging.getLogger("truesite")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def build_store(settings: Settings) -> Store:
    if settings.store_backend == "memory":
        return InMemoryStore()
    if not settings.gcs_bucket:
        raise RuntimeError("STORE_BACKEND=gcp needs GCS_BUCKET")
    from .store_gcp import FirestoreGcsStore  # lazy: keeps the google libraries out of local runs and tests

    return FirestoreGcsStore(bucket=settings.gcs_bucket, project=settings.gcp_project, database=settings.firestore_database)


def seed_demo_issues(store: Store, repo: ProjectRepo, now: Callable[[], datetime]) -> int:
    """Upsert every project's demo_issues.json as session "demo", ids "demo-<project>-<n>" (n from 1).

    Idempotent: the same ids are rewritten on every start. Issue n is n-1 seconds older than
    issue 1, so "newest first" keeps the file's order.
    """
    base = now()
    count = 0
    for project_id in repo.project_ids():
        for n, row in enumerate(repo.demo_issues(project_id), start=1):
            body = IssueIn.model_validate(row)
            store.save_issue(
                Issue(
                    **body.model_dump(),
                    id=f"demo-{project_id}-{n}",
                    session_id=DEMO_SESSION,
                    photo_url=None,
                    created_at=base - timedelta(seconds=n - 1),
                )
            )
            count += 1
    return count


def create_app(
    settings: Settings | None = None,
    *,
    store: Store | None = None,
    repo: ProjectRepo | None = None,
    client: Any = None,
    now: Callable[[], datetime] = _utcnow,
    limiter_clock: Callable[[], float] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    docs = settings.api_docs  # off in production: Swagger UI loads an unpinned jsDelivr script (A-71)
    app = FastAPI(title="TrueSite", docs_url="/api/docs" if docs else None, redoc_url=None,
                  openapi_url="/api/openapi.json" if docs else None)
    app.state.settings = settings
    app.state.store = store if store is not None else build_store(settings)
    app.state.repo = repo if repo is not None else ProjectRepo(settings.models_dir)
    app.state.client = client  # the Gemini client (real or fake); None until a Gemini route needs one
    app.state.now = now
    limiter_kwargs: dict[str, Any] = {"clock": limiter_clock} if limiter_clock else {}
    app.state.check_limiter = SlidingWindowLimiter(settings.checks_per_ip_per_hour, 3600, **limiter_kwargs)
    app.state.ask_limiter = SlidingWindowLimiter(settings.asks_per_ip_per_hour, 3600, **limiter_kwargs)
    app.state.issue_limiter = SlidingWindowLimiter(settings.issues_per_ip_per_hour, 3600, **limiter_kwargs)

    # Last added = outermost. The body-size cap must see the raw body first; the security
    # headers wrap everything, so its early 413 gets them too.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "gemini_mode": settings.gemini_mode, "store_backend": settings.store_backend}

    @app.get("/api/whoami")
    def whoami(request: Request) -> dict[str, Any]:
        """Day-1 check of the X-Forwarded-For trust position: only the caller's own address and header."""
        return {
            "ip": client_ip(request, settings.trusted_proxy_hops),
            "x_forwarded_for": request.headers.get("x-forwarded-for"),
            "peer": request.client.host if request.client else None,
        }

    app.include_router(projects.router)
    app.include_router(check.router)
    app.include_router(ask.router)
    app.include_router(issues.router)

    try:
        seeded = seed_demo_issues(app.state.store, app.state.repo, now)
        log.info("seeded %d demo issues", seeded)
    except Exception:  # noqa: BLE001 - the app must still start if the store is briefly unavailable
        log.exception("seeding demo issues failed")

    if settings.static_dir.is_dir():
        # Mounted last: API routes always win; unknown /api/* paths get a JSON 404.
        app.mount("/", SPAStaticFiles(directory=settings.static_dir), name="spa")
    else:
        log.warning("static dir %s not found; serving the API only", settings.static_dir)
    return app
