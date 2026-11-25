"""The Checks page: GET /api/runs, GET /api/runs/{run_id}, PUT /api/runs/{run_id}/review/{mark}.

Every route is scoped to the caller's X-Session-Id: another session's run is a 404, as if it did not exist. The
images of a run are served by check.py (GET /api/runs/{run_id}/{name}); that path has one more segment, so the
two never clash. A review is a person's decision on one finding, stamped with the server's time; it makes no
Gemini call, so it has a per-IP write limit and no daily cap.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request

from ..deps import NowDep, SessionId, StoreDep, enforce_rate_limit
from ..schemas import PROJECT_ID_PATTERN, RUN_ID_PATTERN, ReviewIn, ReviewOut, RunDetail, RunList
from ..summaries import run_detail, summarise_run

router = APIRouter()

RunIdPath = Annotated[str, Path(pattern=RUN_ID_PATTERN)]


def _not_found(code: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"code": code})


@router.get("/api/runs", response_model=RunList)
def list_runs(
    session_id: SessionId,
    store: StoreDep,
    project_id: Annotated[str | None, Query(pattern=PROJECT_ID_PATTERN)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> RunList:
    return RunList(runs=[summarise_run(r) for r in store.list_check_runs(session_id, project_id, limit)])


@router.get("/api/runs/{run_id}", response_model=RunDetail)
def get_run(run_id: RunIdPath, session_id: SessionId, store: StoreDep) -> RunDetail:
    run = store.get_check_run(run_id, session_id)
    if run is None:
        raise _not_found("unknown_run")
    return run_detail(run)


@router.put("/api/runs/{run_id}/review/{mark}", response_model=ReviewOut)
def review_finding(
    request: Request,
    run_id: RunIdPath,
    mark: Annotated[int, Path(ge=1, le=25)],
    body: ReviewIn,
    session_id: SessionId,
    store: StoreDep,
    now: NowDep,
) -> ReviewOut:
    run = store.get_check_run(run_id, session_id)
    if run is None:
        raise _not_found("unknown_run")
    if not any(isinstance(f, dict) and f.get("mark") == mark for f in run.result.get("findings", [])):
        raise _not_found("unknown_mark")
    enforce_rate_limit(request, "review_limiter")  # after the lookups, so a typo uses none of the allowance
    at = now()
    if not store.set_review(run_id, session_id, mark, body.decision, at):
        raise _not_found("unknown_run")  # expired since the lookup
    return ReviewOut(run_id=run_id, mark=mark, decision=body.decision, at=at if body.decision else None)
