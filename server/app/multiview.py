"""What the same session's checks from OTHER viewpoints said about each element of one check.

An element keeps its IFC GlobalId (guid) whichever printed code it is seen from, so its findings can be put side by
side. This makes no Gemini call: it only reads stored checks. One photo cannot show depth, so a shift along the line
of sight shows up only from a second viewpoint; and in our logged sweeps no false alarm was ever flagged from two
viewpoints (FINAL-GAME-PLAN/eval-runs/multiview-2026-11-28.md).

Only the newest check per other viewpoint counts, and only within WINDOW of this check: a site changes from day to
day, so an old view says nothing about today's.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta
from typing import Any

from .schemas import CheckRun, MarkViews, OtherView

WINDOW = timedelta(hours=12)
DEVIATIONS = frozenset({"missing", "misplaced", "different_from_design"})
_STATUSES = DEVIATIONS | {"present_ok", "cannot_judge"}


def _findings(run: CheckRun) -> list[dict[str, Any]]:
    found = run.result.get("findings", [])
    return [f for f in found if isinstance(f, dict)] if isinstance(found, list) else []


def verdict(status: str, others: Iterable[str]) -> str | None:
    """How this view's status and the other views' statuses fit together; None when the others add nothing.

    confirmed          this view flags it, and every other view that could judge it flags it too
    disputed           this view flags it, and another view sees it as built: a person should take a closer look
    flagged_elsewhere  this view sees it as built or cannot judge it, and another view flags it
    seen_ok_elsewhere  this view cannot judge it, and another view sees it as built
    """
    judged = [s for s in others if s != "cannot_judge"]
    flags = [s for s in judged if s in DEVIATIONS]
    if status in DEVIATIONS:
        if not judged:
            return None
        return "confirmed" if len(flags) == len(judged) else "disputed"
    if flags:
        return "flagged_elsewhere"
    if status == "cannot_judge" and judged:
        return "seen_ok_elsewhere"
    return None


def other_views(run: CheckRun, session_runs: Iterable[CheckRun]) -> dict[str, MarkViews]:
    """str(mark) -> the other viewpoints' findings on that element, for the marks where they add something."""
    newest: dict[str, CheckRun] = {}
    for other in session_runs:
        if (other.run_id == run.run_id or other.project_id != run.project_id or other.anchor_id == run.anchor_id
                or abs(other.created_at - run.created_at) > WINDOW):
            continue
        seen = newest.get(other.anchor_id)
        if seen is None or other.created_at > seen.created_at:
            newest[other.anchor_id] = other
    by_guid: dict[str, list[OtherView]] = {}
    for anchor_id in sorted(newest):
        other = newest[anchor_id]
        for f in _findings(other):
            guid, status = f.get("guid"), f.get("status")
            if not isinstance(guid, str) or status not in _STATUSES:
                continue
            confidence = f.get("confidence")
            by_guid.setdefault(guid, []).append(OtherView(
                anchor_id=anchor_id, run_id=other.run_id, mark=f.get("mark") if isinstance(f.get("mark"), int) else None,
                status=status, confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
                created_at=other.created_at))
    out: dict[str, MarkViews] = {}
    for f in _findings(run):
        views = by_guid.get(f.get("guid") or "")
        mark, status = f.get("mark"), f.get("status")
        if not views or not isinstance(mark, int) or status not in _STATUSES:
            continue
        v = verdict(status, [o.status for o in views])
        if v is not None:
            out[str(mark)] = MarkViews(verdict=v, views=views)
    return out
