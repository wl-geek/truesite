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
from .schemas import AskAnswer, AskRequest, CheckContext, Element, Usage
from .validate import clamp_confidence, repair_check, truncate_text

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


def element_fields(element: Element) -> set[str]:
    """Names the model may cite: the core fields plus every property name (as gemini_client sends them)."""
    return {"ifc_class", "name", "storey", "load_bearing", "bbox_m", *element.props}


def make_asker(repo: ProjectRepo, client: Any) -> Callable[[AskRequest], AskAnswer]:
    def ask(req: AskRequest) -> AskAnswer:
        element = repo.element(req.project_id, req.guid)
        raw = gemini_client.ask_element(element.model_dump(mode="json"), req.question, client=client)["result"]
        allowed = element_fields(element)
        cited = raw.get("cited_properties") if isinstance(raw.get("cited_properties"), list) else []
        cited = list(dict.fromkeys(c for c in cited if isinstance(c, str) and c in allowed))[:10]
        answer = truncate_text(raw.get("answer"), 600) or "The element data does not say."
        return AskAnswer(answer=answer, cited_properties=cited, confidence=clamp_confidence(raw.get("confidence")))

    return ask
