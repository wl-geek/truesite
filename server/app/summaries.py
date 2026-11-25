"""What the Checks page shows of a stored check: one row per run (RunSummary) and the whole run (RunDetail).

"Flagged" findings are the deviations: missing, misplaced or different from the design, the findings that carry a
severity (set by code, severity.py). Only they need a person's decision; a decision stored on any other mark is
kept but not counted. The stored result is read defensively: a run saved by an older version still summarises.
"""
from __future__ import annotations

from typing import Any, get_args

from .schemas import CheckRun, CheckSource, RunDetail, RunImages, RunSummary, SeverityCounts, Status, StatusCounts

SOURCES = set(get_args(CheckSource))
STATUSES = set(get_args(Status))
SEVERITIES = ("high", "medium", "low")


def image_path(run_id: str, name: str) -> str:
    """The session-scoped image route (check.py: GET /api/runs/{run_id}/{name})."""
    return f"/api/runs/{run_id}/{name}"


def run_source(run: CheckRun) -> CheckSource | None:
    """Where the check came from: the provenance when stored, else the context (runs saved before provenance)."""
    if run.provenance is not None and run.provenance.source is not None:
        return run.provenance.source
    source = run.context.get("source")
    return source if source in SOURCES else None


def _findings(result: dict[str, Any]) -> list[dict[str, Any]]:
    rows = result.get("findings")
    return [f for f in rows if isinstance(f, dict)] if isinstance(rows, list) else []


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def summarise_run(run: CheckRun) -> RunSummary:
    findings = _findings(run.result)
    by_status = StatusCounts()
    by_severity = SeverityCounts()
    lowest: float | None = None
    needs_review = confirmed = dismissed = high_open = 0
    for f in findings:
        status = f.get("status")
        if status in STATUSES:
            setattr(by_status, status, getattr(by_status, status) + 1)
        severity = f.get("severity")
        if severity not in SEVERITIES:
            continue
        setattr(by_severity, severity, getattr(by_severity, severity) + 1)
        confidence = _number(f.get("confidence"))
        if confidence is not None:
            lowest = confidence if lowest is None else min(lowest, confidence)
        decision = run.review.get(str(f.get("mark")))
        if decision is None:
            needs_review += 1
        elif decision.decision == "confirmed":
            confirmed += 1
        else:
            dismissed += 1
        if severity == "high" and (decision is None or decision.decision != "dismissed"):
            high_open += 1

    usage = run.result.get("usage")
    unexpected = run.result.get("unexpected")
    model_version = run.result.get("model_version")
    summary = run.result.get("summary")
    image_quality = run.result.get("image_quality")
    return RunSummary(
        run_id=run.run_id, created_at=run.created_at, project_id=run.project_id, anchor_id=run.anchor_id,
        source=run_source(run), image_quality=image_quality if isinstance(image_quality, str) else None,
        by_status=by_status, by_severity=by_severity,
        unexpected=len(unexpected) if isinstance(unexpected, list) else 0,
        lowest_confidence=lowest, needs_review=needs_review, confirmed=confirmed, dismissed=dismissed,
        reviewed=confirmed + dismissed, high_open=high_open,
        model_version=model_version if isinstance(model_version, str) else None,
        cost_usd_est=_number(usage.get("cost_usd_est")) if isinstance(usage, dict) else None,
        duration_ms=run.duration_ms, summary=summary if isinstance(summary, str) else "",
    )


def run_detail(run: CheckRun) -> RunDetail:
    return RunDetail(
        run_id=run.run_id, created_at=run.created_at, project_id=run.project_id, anchor_id=run.anchor_id,
        source=run_source(run), context=run.context, result=run.result, review=run.review, provenance=run.provenance,
        duration_ms=run.duration_ms,
        images=RunImages(photo=image_path(run.run_id, "photo.jpg"), render=image_path(run.run_id, "render.png"),
                         overlay=image_path(run.run_id, "overlay.jpg") if run.overlay_key else None),
    )
