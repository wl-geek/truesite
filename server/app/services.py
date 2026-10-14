"""Gemini-backed services used by the routes, and the mapping of Gemini errors to HTTP."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request

from . import gemini_client
from .config import Settings
from .fake_gemini import FakeGeminiClient
from .gemini_client import GeminiError
from .projects import ProjectRepo
from .schemas import CheckContext, Usage
from .validate import repair_check

Checker = Callable[[bytes, bytes, CheckContext], dict]


def build_client(settings: Settings) -> Any:
    if settings.gemini_mode == "fake":
        return FakeGeminiClient()
    return gemini_client.default_client()


def client_for(request: Request) -> Any:
    """The app's Gemini client, built on first use (so tests and local runs need no credentials)."""
    state = request.app.state
    if state.client is None:
        state.client = build_client(state.settings)
    return state.client


def make_checker(repo: ProjectRepo, client: Any) -> Checker:
    def check(photo_jpeg: bytes, render_png: bytes, ctx: CheckContext) -> dict:
        out = gemini_client.check_asbuilt(photo_jpeg, render_png, ctx.model_dump(mode="json"), client=client)
        result = repair_check(out["result"], ctx, repo.elements_by_guid(ctx.project_id))
        result = result.model_copy(update={"usage": Usage(**out["usage"]), "model_version": out.get("model_version")})
        return result.model_dump(mode="json")

    return check


_ERRORS = {
    "timeout": (503, "model_unavailable"),
    "unavailable": (503, "model_unavailable"),
    "rate_limited": (503, "model_unavailable"),
    "bad_output": (502, "model_bad_output"),
    "blocked": (422, "model_blocked"),
    "bad_request": (500, "model_bad_request"),
}


def http_error_for(err: GeminiError) -> HTTPException:
    status, code = _ERRORS.get(err.kind, (503, "model_unavailable"))
    headers = {"Retry-After": "5"} if status == 503 else None
    return HTTPException(status_code=status, detail={"code": code}, headers=headers)
