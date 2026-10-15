"""POST /api/issues/draft, POST /api/issues, GET /api/issues (spec 4.2 step 5).

Issues belong to the browser session that created them; the seeded demo issues (session "demo",
which no client id can match) are listed for everyone, separately.
"""
from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from ..deps import NowDep, RepoDep, SessionId, SettingsDep, StoreDep, enforce_limits, enforce_rate_limit
from ..gemini_client import GeminiError
from ..projects import UnknownElement, UnknownProject
from ..schemas import DEMO_SESSION, PROJECT_ID_PATTERN, Issue, IssueDraft, IssueDraftRequest, IssueIn
from ..services import UnknownMark, client_for, http_error_for, make_drafter

router = APIRouter()


def _not_found(code: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": code})


@router.post("/api/issues/draft", response_model=IssueDraft)
def draft_issue(request: Request, body: IssueDraftRequest, session_id: SessionId, settings: SettingsDep,
                store: StoreDep, repo: RepoDep) -> IssueDraft:
    run = store.get_check_run(body.run_id, session_id)
    if run is None:
        raise _not_found("unknown_run")
    if not any(isinstance(f, dict) and f.get("mark") == body.mark for f in run.result.get("findings", [])):
        raise _not_found("unknown_mark")
    enforce_limits(request, "ask_limiter", "-ask", settings.daily_ask_cap)  # drafting shares the question budget
    try:
        return make_drafter(repo, client_for(request))(run, body.mark)
    except UnknownMark:
        raise _not_found("unknown_mark") from None
    except (UnknownElement, UnknownProject):
        raise _not_found("unknown_element") from None
    except GeminiError as err:
        raise http_error_for(err) from err


@router.post("/api/issues", status_code=201, response_model=Issue)
def create_issue(request: Request, body: IssueIn, session_id: SessionId, settings: SettingsDep, store: StoreDep,
                 repo: RepoDep, now: NowDep) -> Issue:
    try:
        repo.element(body.project_id, body.guid)
    except UnknownProject:
        raise _not_found("unknown_project") from None
    except UnknownElement:
        raise _not_found("unknown_element") from None
    # No Gemini call, so no daily cap: a per-IP write limit, then a per-session total, which also
    # bounds what each GET /api/issues reads (A-24). Concurrent posts may pass the total by a few.
    enforce_rate_limit(request, "issue_limiter")
    if len(store.list_issues(session_id, limit=settings.issues_per_session)) >= settings.issues_per_session:
        raise HTTPException(status_code=429, detail={"code": "issue_cap"})
    photo_url = None
    if body.run_id:
        if store.get_check_run(body.run_id, session_id) is None:
            raise _not_found("unknown_run")
        photo_url = f"/api/runs/{body.run_id}/photo.jpg"
    issue = Issue(**body.model_dump(), id=secrets.token_urlsafe(16), session_id=session_id, photo_url=photo_url, created_at=now())
    store.save_issue(issue)
    return issue


@router.get("/api/issues")
def list_issues(session_id: SessionId, store: StoreDep,
                project_id: Annotated[str | None, Query(pattern=PROJECT_ID_PATTERN)] = None) -> dict[str, list[Issue]]:
    return {"issues": store.list_issues(session_id, project_id), "demo": store.list_issues(DEMO_SESSION, project_id)}
