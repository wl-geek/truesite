"""POST /api/ask: a grounded answer about one element, from its own model data only (spec 4.2 step 6)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..deps import RepoDep, SessionId, SettingsDep, enforce_limits
from ..gemini_client import GeminiError
from ..projects import UnknownElement, UnknownProject
from ..schemas import AskAnswer, AskRequest
from ..services import client_for, http_error_for, make_asker

router = APIRouter()


@router.post("/api/ask", response_model=AskAnswer)
def ask(request: Request, body: AskRequest, session_id: SessionId, settings: SettingsDep, repo: RepoDep) -> AskAnswer:
    # Plain `def`: FastAPI runs it in the threadpool, so the blocking Gemini call never stalls the loop.
    try:
        repo.element(body.project_id, body.guid)
    except UnknownProject:
        raise HTTPException(status_code=404, detail={"code": "unknown_project"}) from None
    except UnknownElement:
        raise HTTPException(status_code=404, detail={"code": "unknown_element"}) from None
    enforce_limits(request, "ask_limiter", "-ask", settings.daily_ask_cap)
    try:
        return make_asker(repo, client_for(request))(body)
    except GeminiError as err:
        raise http_error_for(err) from err
