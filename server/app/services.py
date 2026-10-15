"""Gemini-backed services used by the routes, and the mapping of Gemini errors to HTTP."""
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request

from . import gemini_client
from .config import Settings
from .fake_gemini import FakeGeminiClient
from .gemini_client import GeminiError
from .projects import ProjectRepo
from .schemas import AskAnswer, AskRequest, CheckContext, CheckRun, Element, IssueDraft, Usage
from .validate import clamp_confidence, repair_check, truncate_text

log = logging.getLogger("truesite.gemini")

Checker = Callable[[bytes, bytes, CheckContext], dict]
VISUAL_CHECK_LABEL = "Visual check, not a survey."  # spec 4.4: every drafted issue carries it


def build_client(settings: Settings) -> Any:
    if settings.gemini_mode == "fake":
        return FakeGeminiClient()
    return gemini_client.default_client()


def client_for(request: Request) -> Any:
    """The app's Gemini client, built on first use (so tests and local runs need no credentials).

    A setup failure (no API key, no ADC project) raises GeminiError("bad_request"), so routes
    answer with the usual JSON error. Routes call this before enforce_limits: no quota is used.
    """
    state = request.app.state
    if state.client is None:
        try:
            state.client = build_client(state.settings)
        except Exception as exc:  # noqa: BLE001 - any setup failure is a configuration problem
            raise GeminiError("bad_request", f"Gemini client setup failed: {exc}") from exc
    return state.client


def log_usage(what: str, out: dict) -> None:
    """Ask and Draft results are not stored, so this log line is their only cost record."""
    log.info("%s usage %s", what, json.dumps(
        {**out.get("usage", {}), "attempts": out.get("attempts"), "latency_ms": out.get("latency_ms")}))


def make_checker(repo: ProjectRepo, client: Any) -> Checker:
    def check(photo_jpeg: bytes, render_png: bytes, ctx: CheckContext) -> dict:
        out = gemini_client.check_asbuilt(photo_jpeg, render_png, ctx.model_dump(mode="json"),
                                          project_note=repo.check_note(ctx.project_id), client=client)
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
        out = gemini_client.ask_element(element.model_dump(mode="json"), req.question, client=client)
        log_usage("ask", out)
        raw = out["result"]
        allowed = element_fields(element)
        cited = raw.get("cited_properties") if isinstance(raw.get("cited_properties"), list) else []
        cited = list(dict.fromkeys(c for c in cited if isinstance(c, str) and c in allowed))[:10]
        answer = truncate_text(raw.get("answer"), 600) or "The element data does not say."
        return AskAnswer(answer=answer, cited_properties=cited, confidence=clamp_confidence(raw.get("confidence")))

    return ask


class UnknownMark(LookupError):
    pass


def with_label(text: str, limit: int) -> str:
    """``text`` ending with the copy-rule label, within ``limit`` characters; the model may leave it out."""
    if VISUAL_CHECK_LABEL.lower().rstrip(".") in text.lower():
        return text
    body = truncate_text(text, limit - len(VISUAL_CHECK_LABEL) - 1)
    return f"{body} {VISUAL_CHECK_LABEL}" if body else VISUAL_CHECK_LABEL


def make_drafter(repo: ProjectRepo, client: Any) -> Callable[[CheckRun, int], IssueDraft]:
    """Issue title/description/next step drafted from one stored finding; severity stays with code."""

    def draft(run: CheckRun, mark: int) -> IssueDraft:
        findings = run.result.get("findings") if isinstance(run.result.get("findings"), list) else []
        finding = next((f for f in findings if isinstance(f, dict) and f.get("mark") == mark), None)
        if finding is None:
            raise UnknownMark(mark)
        element = repo.element(run.project_id, finding["guid"])
        facts = {k: finding.get(k) for k in ("name", "ifc_class", "status", "offset", "explanation", "confidence")}
        out = gemini_client.draft_issue(facts, element.model_dump(mode="json"), client=client)
        log_usage("draft", out)
        raw = out["result"]
        status = str(finding.get("status", "deviation")).replace("_", " ")
        return IssueDraft(
            title=truncate_text(raw.get("title"), 80) or truncate_text(f"{element.name}: {status}", 80),
            description=with_label(truncate_text(raw.get("description"), 500), 500),
            suggested_action=truncate_text(raw.get("suggested_action"), 200),
        )

    return draft
