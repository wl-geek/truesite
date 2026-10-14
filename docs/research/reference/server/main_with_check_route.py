"""FastAPI app factory: API routes + the built SPA on the same origin.

Run locally:   uvicorn --factory app.main:create_app --reload        (from server/)
Cloud Run:     see Dockerfile CMD (listens on $PORT, 0.0.0.0)

This file shows the cloud-layer wiring (uploads, limits, sessions, storage,
SPA). The Gemini call is injected as `app.state.checker` so tests can stub it.
"""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Path, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import ValidationError
from starlette.middleware.gzip import GZipMiddleware

from .config import Settings
from .limits import SlidingWindowLimiter, client_ip, rate_key
from .schemas import DEMO_SESSION, SESSION_ID_PATTERN, CheckContext, CheckRun, Issue, IssueIn
from .spa import SPAStaticFiles
from .store import InMemoryStore, Store, blob_key, content_type_for
from .uploads import BodySizeLimitMiddleware, read_image

log = logging.getLogger("truesite")

RUN_ID_PATTERN = r"^[A-Za-z0-9_-]{16,32}$"
SAMPLE_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"
MAX_CONTEXT_CHARS = 64 * 1024

Checker = Callable[[bytes, bytes, CheckContext], dict[str, Any]]


def _stub_checker(photo: bytes, render: bytes, ctx: CheckContext) -> dict[str, Any]:
    return {"image_quality": "good", "findings": [], "unexpected": [], "summary": "stub"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---- dependencies ----------------------------------------------------------------

# Missing or malformed header -> 422 (FastAPI validates `pattern`).
SessionId = Annotated[str, Header(alias="X-Session-Id", pattern=SESSION_ID_PATTERN)]


def get_store(request: Request) -> Store:
    return request.app.state.store


StoreDep = Annotated[Store, Depends(get_store)]


def parse_context(raw: str) -> CheckContext:
    try:
        return CheckContext.model_validate_json(raw)
    except ValidationError as exc:
        errors = [{**e, "loc": ("body", "context", *e["loc"])} for e in exc.errors(include_url=False)]
        raise RequestValidationError(errors) from None


def build_store(settings: Settings) -> Store:
    if settings.store_backend == "memory":
        return InMemoryStore()
    if settings.store_backend == "gcp":
        if not settings.gcs_bucket:
            raise RuntimeError("STORE_BACKEND=gcp needs GCS_BUCKET")
        from .store_gcp import FirestoreGcsStore  # lazy: keeps google libs out of unit tests

        return FirestoreGcsStore(
            bucket=settings.gcs_bucket, project=settings.gcp_project, database=settings.firestore_database
        )
    raise RuntimeError(f"Unknown STORE_BACKEND {settings.store_backend!r}")


# ---- app ------------------------------------------------------------------------------


def create_app(
    settings: Settings | None = None,
    *,
    store: Store | None = None,
    checker: Checker | None = None,
    now: Callable[[], datetime] = _utcnow,
    limiter_clock: Callable[[], float] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="TrueSite", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
    app.state.settings = settings
    app.state.store = store if store is not None else build_store(settings)
    app.state.checker = checker or _stub_checker
    app.state.now = now
    limiter_kwargs = {"clock": limiter_clock} if limiter_clock else {}
    app.state.check_limiter = SlidingWindowLimiter(settings.checks_per_ip_per_hour, 3600, **limiter_kwargs)

    # Last added = outermost. The size cap must see the raw body first.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/whoami")
    def whoami(request: Request) -> dict[str, Any]:
        """Day-1 check of the X-Forwarded-For trust position. Returns only the
        caller's own address and header."""
        return {
            "ip": client_ip(request, settings.trusted_proxy_hops),
            "x_forwarded_for": request.headers.get("x-forwarded-for"),
            "peer": request.client.host if request.client else None,
        }

    @app.post("/api/check")
    async def check(
        request: Request,
        photo: Annotated[UploadFile, File(description="JPEG snapshot, <= 4 MiB")],
        render: Annotated[UploadFile, File(description="PNG model render, <= 4 MiB")],
        context: Annotated[str, Form(max_length=MAX_CONTEXT_CHARS)],
        session_id: SessionId,
        store: StoreDep,
    ) -> dict[str, Any]:
        photo_bytes = await read_image(photo, field="photo", kind="jpeg", limit=settings.max_upload_bytes)
        render_bytes = await read_image(render, field="render", kind="png", limit=settings.max_upload_bytes)
        ctx = parse_context(context)

        ip = client_ip(request, settings.trusted_proxy_hops)
        allowed, retry_after = app.state.check_limiter.hit(rate_key(ip))
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={"code": "rate_limited", "retry_after_s": retry_after},
                headers={"Retry-After": str(retry_after)},
            )
        day = app.state.now().astimezone(timezone.utc).strftime("%Y-%m-%d")
        try:
            ok, _count = await run_in_threadpool(store.try_consume_daily, day, settings.daily_check_cap)
        except Exception:  # noqa: BLE001 - fail closed: no cap check, no Gemini call
            log.exception("daily cap check failed")
            raise HTTPException(status_code=503, detail={"code": "busy"}, headers={"Retry-After": "2"}) from None
        if not ok:
            raise HTTPException(status_code=429, detail={"code": "daily_cap"})

        result = await run_in_threadpool(app.state.checker, photo_bytes, render_bytes, ctx)

        # Persistence is best effort: findings are shown even if saving fails (spec §8).
        run_id = secrets.token_urlsafe(16)
        photo_key = blob_key(session_id, run_id, "photo.jpg")
        render_key = blob_key(session_id, run_id, "render.png")
        saved = True
        try:
            await run_in_threadpool(store.put_blob, photo_key, photo_bytes, "image/jpeg")
            await run_in_threadpool(store.put_blob, render_key, render_bytes, "image/png")
            run = CheckRun(
                run_id=run_id,
                session_id=session_id,
                project_id=ctx.project_id,
                anchor_id=ctx.anchor_id,
                created_at=app.state.now(),
                context=ctx.model_dump(),
                result=result,
                photo_key=photo_key,
                render_key=render_key,
            )
            await run_in_threadpool(store.save_check_run, run)
            if ctx.sample_id:
                saved_result = {**result, "saved_at": app.state.now().isoformat()}
                await run_in_threadpool(store.put_saved_result, ctx.sample_id, saved_result)
        except Exception:  # noqa: BLE001 - log and carry on
            log.exception("saving check run %s failed", run_id)
            saved = False

        return {
            "run_id": run_id,
            "saved": saved,
            "photo_url": f"/api/runs/{run_id}/photo.jpg" if saved else None,
            "result": result,
        }

    @app.get("/api/runs/{run_id}/{name}")
    def run_image(
        run_id: Annotated[str, Path(pattern=RUN_ID_PATTERN)],
        name: Literal["photo.jpg", "render.png"],
        session_id: SessionId,
        store: StoreDep,
    ) -> Response:
        # The key is built from the caller's own session id, so another
        # session's images are unreachable even with a guessed run id.
        # <img src> cannot send headers: the web app fetch()es with
        # X-Session-Id and shows URL.createObjectURL(blob).
        data = store.get_blob(blob_key(session_id, run_id, name))
        if data is None:
            raise HTTPException(status_code=404)
        return Response(data, media_type=content_type_for(name), headers={"Cache-Control": "private, max-age=86400"})

    @app.get("/api/saved-results/{sample_id}")
    def saved_result(sample_id: Annotated[str, Path(pattern=SAMPLE_ID_PATTERN)], store: StoreDep) -> dict[str, Any]:
        result = store.get_saved_result(sample_id)
        if result is None:
            raise HTTPException(status_code=404)
        return result

    @app.post("/api/issues", status_code=201)
    def create_issue(body: IssueIn, session_id: SessionId, store: StoreDep) -> Issue:
        issue = Issue(
            **body.model_dump(),
            id=secrets.token_urlsafe(16),
            session_id=session_id,
            photo_url=f"/api/runs/{body.run_id}/photo.jpg" if body.run_id else None,
            created_at=app.state.now(),
        )
        store.save_issue(issue)
        return issue

    @app.get("/api/issues")
    def list_issues(
        session_id: SessionId,
        store: StoreDep,
        project_id: Annotated[str | None, Query(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")] = None,
    ) -> dict[str, list[Issue]]:
        return {
            "issues": store.list_issues(session_id, project_id),
            # Seeded demo issues: visible to everyone, owned by nobody.
            "demo": store.list_issues(DEMO_SESSION, project_id),
        }

    if settings.static_dir.is_dir():
        # Mounted last: API routes above always win; unknown /api/* -> JSON 404.
        app.mount("/", SPAStaticFiles(directory=settings.static_dir), name="spa")
    else:
        log.warning("static dir %s not found; serving API only", settings.static_dir)

    return app
