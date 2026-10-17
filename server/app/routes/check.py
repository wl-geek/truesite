"""POST /api/check, GET /api/runs/{run_id}/{name}, GET /api/saved-results/{sample_id} (Part 3).

Flow: validate uploads and context -> project and every mark's element exist -> per-IP limit +
daily cap -> Gemini (in the threadpool) -> repair + severity -> best-effort persistence ->
CheckResponse.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
from pathlib import Path as FsPath
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Path, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from ..deps import NowDep, RepoDep, SessionId, SettingsDep, StoreDep, enforce_limits
from ..gemini_client import GeminiError
from ..projects import UnknownProject
from ..schemas import RUN_ID_PATTERN, SAMPLE_ID_PATTERN, CheckContext, CheckResponse, CheckRun
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
) -> CheckResponse:
    photo_bytes = await read_image(photo, field="photo", kind="jpeg", limit=settings.max_upload_bytes)
    render_bytes = await read_image(render, field="render", kind="png", limit=settings.max_upload_bytes)
    overlay_bytes = await read_image(overlay, field="overlay", kind="jpeg", limit=settings.max_upload_bytes) if overlay else None
    ctx = parse_context(context)
    try:
        elements = repo.elements_by_guid(ctx.project_id)
    except UnknownProject:
        raise HTTPException(status_code=404, detail={"code": "unknown_project"}) from None
    if any(v.guid not in elements for v in ctx.visible):
        raise HTTPException(status_code=422, detail={"code": "unknown_element"})
    ctx = with_project_identity(ctx, elements)  # names and classes from the project, not the client

    try:
        checker = make_checker(repo, client_for(request))  # before the cap: a setup error uses no quota
        await run_in_threadpool(enforce_limits, request, "check_limiter", "", settings.daily_check_cap)
        result = await run_in_threadpool(checker, photo_bytes, render_bytes, ctx, overlay_bytes)
    except GeminiError as err:
        log.warning("check failed: %s", err)
        raise http_error_for(err) from err

    # Persistence is best effort: findings are shown even if saving fails (spec section 8).
    run_id = secrets.token_urlsafe(16)
    photo_key = blob_key(session_id, run_id, "photo.jpg")
    render_key = blob_key(session_id, run_id, "render.png")
    saved = True
    try:
        await run_in_threadpool(store.put_blob, photo_key, photo_bytes, "image/jpeg")
        await run_in_threadpool(store.put_blob, render_key, render_bytes, "image/png")
        run = CheckRun(run_id=run_id, session_id=session_id, project_id=ctx.project_id, anchor_id=ctx.anchor_id,
                       created_at=now(), context=ctx.model_dump(mode="json"), result=result,
                       photo_key=photo_key, render_key=render_key)
        await run_in_threadpool(store.save_check_run, run)
    except Exception:  # noqa: BLE001 - log and carry on
        log.exception("saving check run %s failed", run_id)
        saved = False

    # Separate from the run, so `saved` says only whether the run (photo, issues) was stored.
    if await run_in_threadpool(is_shipped_sample, settings.static_dir, ctx, photo_bytes):
        try:
            await run_in_threadpool(store.put_saved_result, ctx.sample_id, {**result, "saved_at": now().isoformat()})
        except Exception:  # noqa: BLE001 - the fallback copy is a nice-to-have
            log.exception("saving the result for sample %s failed", ctx.sample_id)

    return CheckResponse(run_id=run_id, saved=saved, photo_url=f"/api/runs/{run_id}/photo.jpg" if saved else None,
                         result=result)


@router.get("/api/runs/{run_id}/{name}")
def run_image(
    run_id: Annotated[str, Path(pattern=RUN_ID_PATTERN)],
    name: Literal["photo.jpg", "render.png"],
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
