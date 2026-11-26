"""POST /api/check, GET /api/runs/{run_id}/{name}, GET /api/saved-results/{sample_id} (Part 3).

Flow: validate uploads and context -> project and every mark's element exist -> per-IP limit +
daily cap -> Gemini (in the threadpool) -> repair + severity -> best-effort persistence ->
CheckResponse.

With the second look on (CHECK_VERIFY=1) and `Accept: text/event-stream`, a check whose first pass answers while the
close-ups are still out streams instead: `event: first_look` (the repaired first pass and the marks being looked at
again), then `event: done` (the CheckResponse) or `event: error` ({status, detail}, as the HTTP error would have been).
A check that fails or finishes before its first look is a plain HTTP error or JSON response, as without the header.

The stored run keeps the outline image when one was sent, the time the Gemini call took, and a provenance
block (the images' SHA-256, the server's receive time, its APP_VERSION and what the client said about the
check), so the Checks page can show an audit trail.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import time
from collections.abc import AsyncIterator
from pathlib import Path as FsPath
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Path, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from ..deps import NowDep, RepoDep, SessionId, SettingsDep, StoreDep, enforce_limits
from ..gemini_client import GeminiError
from ..projects import UnknownProject
from ..schemas import RUN_ID_PATTERN, SAMPLE_ID_PATTERN, CheckContext, CheckResponse, CheckRun, Provenance
from ..services import client_for, http_error_for, make_checker
from ..store import blob_key, content_type_for
from ..uploads import read_image
from ..validate import with_project_identity

log = logging.getLogger("truesite.check")
router = APIRouter()

MAX_CONTEXT_CHARS = 64 * 1024


def is_shipped_sample(static_dir: FsPath, ctx: CheckContext, photo: bytes) -> bool:
    """True when `photo` is the deployed static_dir/samples/<sample_id>/photo.jpg (same sha256) and
    the context's project and anchor match that sample's meta.json. Only such a check may refresh
    the saved result that every /samples visitor falls back to (A-06)."""
    if not ctx.sample_id:
        return False
    folder = static_dir / "samples" / ctx.sample_id  # SAMPLE_ID_PATTERN allows no "/" and no "."
    try:
        shipped = (folder / "photo.jpg").read_bytes()
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (isinstance(meta, dict) and meta.get("project_id") == ctx.project_id
            and meta.get("anchor_id") == ctx.anchor_id
            and hashlib.sha256(shipped).digest() == hashlib.sha256(photo).digest())


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def wants_stream(request: Request) -> bool:
    return "text/event-stream" in request.headers.get("accept", "")


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _settle(fut: asyncio.Future, value: object) -> None:
    if not fut.done():
        fut.set_result(value)


# Streamed checks still settling: held here so a check whose page has gone is not garbage-collected half way.
_SETTLING: set[asyncio.Future] = set()


def _settled(fut: asyncio.Future) -> None:
    _SETTLING.discard(fut)
    if fut.cancelled():
        return
    err = fut.exception()  # also marks it retrieved when no stream is left to read it
    if isinstance(err, GeminiError):
        log.warning("check failed after its first look: %s", err)
    elif err is not None:
        log.error("check failed after its first look", exc_info=err)


def parse_context(raw: str) -> CheckContext:
    try:
        return CheckContext.model_validate_json(raw)
    except ValidationError as exc:
        errors = [{**e, "loc": ("body", "context", *e["loc"])} for e in exc.errors(include_url=False)]
        raise RequestValidationError(errors) from None


@router.post("/api/check", response_model=CheckResponse)
async def check(
    request: Request,
    photo: Annotated[UploadFile, File(description="JPEG snapshot, <= 4 MiB")],
    render: Annotated[UploadFile, File(description="PNG model render, <= 4 MiB")],
    context: Annotated[str, Form(max_length=MAX_CONTEXT_CHARS)],
    session_id: SessionId,
    settings: SettingsDep,
    store: StoreDep,
    repo: RepoDep,
    now: NowDep,
    overlay: Annotated[UploadFile | None, File(description="JPEG photo with the design outlines (IMAGE 3), <= 4 MiB")] = None,
) -> CheckResponse | Response:
    received_at = now()
    caps = {"limit": settings.max_upload_bytes, "max_pixels": settings.max_image_pixels}
    photo_bytes = await read_image(photo, field="photo", kind="jpeg", **caps)
    render_bytes = await read_image(render, field="render", kind="png", **caps)
    overlay_bytes = await read_image(overlay, field="overlay", kind="jpeg", **caps) if overlay else None
    ctx = parse_context(context)
    try:
        elements = repo.elements_by_guid(ctx.project_id)
    except UnknownProject:
        raise HTTPException(status_code=404, detail={"code": "unknown_project"}) from None
    if any(v.guid not in elements for v in ctx.visible):
        raise HTTPException(status_code=422, detail={"code": "unknown_element"})
    ctx = with_project_identity(ctx, elements)  # names and classes from the project, not the client

    async def finished(result: dict, duration_ms: int) -> CheckResponse:
        # Persistence is best effort: findings are shown even if saving fails (spec section 8).
        run_id = secrets.token_urlsafe(16)
        photo_key = blob_key(session_id, run_id, "photo.jpg")
        render_key = blob_key(session_id, run_id, "render.png")
        overlay_key = blob_key(session_id, run_id, "overlay.jpg") if overlay_bytes else None
        provenance = Provenance(
            photo_sha256=sha256_hex(photo_bytes), render_sha256=sha256_hex(render_bytes),
            overlay_sha256=sha256_hex(overlay_bytes) if overlay_bytes else None, received_at=received_at,
            app_version=settings.app_version, source=ctx.source, pose_quality=ctx.pose_quality, distance_m=ctx.distance_m,
        )
        saved = True
        try:
            await run_in_threadpool(store.put_blob, photo_key, photo_bytes, "image/jpeg")
            await run_in_threadpool(store.put_blob, render_key, render_bytes, "image/png")
            if overlay_key and overlay_bytes:
                await run_in_threadpool(store.put_blob, overlay_key, overlay_bytes, "image/jpeg")
            run = CheckRun(run_id=run_id, session_id=session_id, project_id=ctx.project_id, anchor_id=ctx.anchor_id,
                           created_at=now(), context=ctx.model_dump(mode="json"), result=result,
                           photo_key=photo_key, render_key=render_key, overlay_key=overlay_key,
                           duration_ms=duration_ms, provenance=provenance)
            await run_in_threadpool(store.save_check_run, run)
        except Exception:  # noqa: BLE001 - log and carry on
            log.exception("saving check run %s failed", run_id)
            saved = False

        # Separate from the run, so `saved` says only whether the run (photo, issues) was stored.
        if settings.save_sample_results and await run_in_threadpool(is_shipped_sample, settings.static_dir, ctx, photo_bytes):
            try:
                await run_in_threadpool(store.put_saved_result, ctx.sample_id, {**result, "saved_at": now().isoformat()})
            except Exception:  # noqa: BLE001 - the fallback copy is a nice-to-have
                log.exception("saving the result for sample %s failed", ctx.sample_id)

        return CheckResponse(run_id=run_id, saved=saved, photo_url=f"/api/runs/{run_id}/photo.jpg" if saved else None,
                             result=result)

    stream = settings.check_verify and wants_stream(request)  # only the second look leaves a first look to show early
    loop = asyncio.get_running_loop()
    first_look: asyncio.Future[dict] = loop.create_future()

    def on_first_look(result: dict, pending: list[int]) -> None:  # on the checker's thread
        loop.call_soon_threadsafe(_settle, first_look, {"result": result, "pending": pending})

    try:
        checker = make_checker(repo, client_for(request), verify=settings.check_verify)  # before the cap: a setup error uses no quota
        await run_in_threadpool(enforce_limits, request, "check_limiter", "", settings.daily_check_cap)
        started = time.perf_counter()
        task = asyncio.ensure_future(run_in_threadpool(checker, photo_bytes, render_bytes, ctx, overlay_bytes,
                                                       on_first_look if stream else None))
        if stream:
            await asyncio.wait({task, first_look}, return_when=asyncio.FIRST_COMPLETED)
        if not first_look.done():  # no first look to show (the second look is off, or the check ended first)
            result = await task
            return await finished(result, round((time.perf_counter() - started) * 1000))
    except GeminiError as err:
        log.warning("check failed: %s", err)
        raise http_error_for(err) from err

    # The settled answer is stored even if the page goes away mid-stream (Starlette then cancels the stream): Gemini has
    # answered and been paid for. The stream only waits on it.
    async def settle() -> CheckResponse:
        result = await task
        return await finished(result, round((time.perf_counter() - started) * 1000))

    settling = asyncio.ensure_future(settle())
    _SETTLING.add(settling)
    settling.add_done_callback(_settled)

    async def events() -> AsyncIterator[str]:
        yield sse("first_look", first_look.result())
        try:
            response = await asyncio.shield(settling)
        except GeminiError as err:
            exc = http_error_for(err)
            yield sse("error", {"status": exc.status_code, "detail": exc.detail})
            return
        except Exception:  # noqa: BLE001 - the headers are sent: say so in the stream
            yield sse("error", {"status": 500, "detail": {"code": "internal_error"}})
            return
        yield sse("done", response.model_dump(mode="json"))

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@router.get("/api/runs/{run_id}/{name}")
def run_image(
    run_id: Annotated[str, Path(pattern=RUN_ID_PATTERN)],
    name: Literal["photo.jpg", "render.png", "overlay.jpg"],
    session_id: SessionId,
    store: StoreDep,
) -> Response:
    # The key is built from the caller's own session id, so another session's images are
    # unreachable even with a guessed run id. <img src> cannot send headers: the web app
    # fetch()es with X-Session-Id and shows URL.createObjectURL(blob).
    data = store.get_blob(blob_key(session_id, run_id, name))
    if data is None:
        raise HTTPException(status_code=404, detail={"code": "unknown_run"})
    return Response(data, media_type=content_type_for(name), headers={"Cache-Control": "private, max-age=86400"})


@router.get("/api/saved-results/{sample_id}")
def saved_result(sample_id: Annotated[str, Path(pattern=SAMPLE_ID_PATTERN)], store: StoreDep) -> dict:
    result = store.get_saved_result(sample_id)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "unknown_sample"})
    return result
