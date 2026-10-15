"""Repair the model's as-built answer into a CheckResult (spec section 6, server rules).

Gemini's output is untrusted: anything malformed is repaired or dropped here, and every
change that affects what the user sees is recorded in `warnings`.
"""
from __future__ import annotations

import math
from typing import Any, get_args

from .schemas import CheckContext, CheckResult, Direction, Element, Finding, ImageQuality, Offset, Status, UnexpectedItem
from .severity import severity_for

CONFIDENCE_FLOOR = 0.5
MAX_UNEXPECTED = 10
EXPLANATION_MAX, DESCRIPTION_MAX, SUMMARY_MAX = 200, 150, 300
STATUSES = set(get_args(Status))
DIRECTIONS = set(get_args(Direction))
IMAGE_QUALITIES = set(get_args(ImageQuality))
LOW_CONFIDENCE = "Low confidence."


def _finite_number(value: Any) -> bool:
    # json.loads accepts NaN and 1e400 (inf); round() raises on both.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def truncate_text(value: Any, limit: int) -> str:
    s = value.strip() if isinstance(value, str) else ""
    return s if len(s) <= limit else s[: limit - 1] + "…"


def clamp_confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return min(1.0, max(0.0, float(value)))


def _box(value: Any) -> list[int] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    if not all(_finite_number(v) for v in value):
        return None
    y0, x0, y1, x1 = (min(1000, max(0, round(v))) for v in value)
    if y0 == x0 == y1 == x1 == 0:
        return None
    return [min(y0, y1), min(x0, x1), max(y0, y1), max(x0, x1)]


def _offset(value: Any) -> Offset | None:
    if not isinstance(value, dict) or value.get("direction") not in DIRECTIONS or value.get("direction") == "none":
        return None
    cm = value.get("approx_cm")
    if not _finite_number(cm):
        return None
    return Offset(direction=value["direction"], approx_cm=min(500, max(0, round(cm / 10) * 10)))


def _mark(value: Any) -> Any:
    """Marks are ints; 3.0 and "3" are read as 3. Anything else is returned unchanged (and dropped)."""
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
        return int(value.strip())
    return value


def with_project_identity(ctx: CheckContext, elements: dict[str, Element]) -> CheckContext:
    """The context with each mark's name and class taken from the project, not the client.
    Every guid must be in `elements` (POST /api/check returns 422 unknown_element first)."""
    visible = [v.model_copy(update={"name": elements[v.guid].name, "ifc_class": elements[v.guid].ifc_class})
               for v in ctx.visible]
    return ctx.model_copy(update={"visible": visible})


def _element(guid: str, ifc_class: str, name: str, elements: dict[str, Element]) -> Element:
    found = elements.get(guid)
    if found is not None:
        return found
    return Element(guid=guid, ifc_class=ifc_class, name=name, storey="", bbox_m=[[0, 0, 0], [0, 0, 0]],
                   load_bearing=None, props={})


def repair_check(raw: dict, ctx: CheckContext, elements: dict[str, Element]) -> CheckResult:
    warnings: list[str] = []
    marks = {v.mark: v for v in ctx.visible}

    image_quality = raw.get("image_quality")
    if image_quality not in IMAGE_QUALITIES:
        warnings.append(f"image_quality {image_quality!r} not recognised; treated as good")
        image_quality = "good"

    findings: dict[int, Finding] = {}
    raw_findings = raw.get("findings") if isinstance(raw.get("findings"), list) else []
    for item in raw_findings:
        if not isinstance(item, dict):
            continue
        mark = _mark(item.get("mark"))
        if isinstance(mark, bool) or not isinstance(mark, int) or mark not in marks:
            warnings.append(f"dropped a finding for unknown mark {mark}")
            continue
        if mark in findings:
            warnings.append(f"dropped a duplicate finding for mark {mark}")
            continue
        vis = marks[mark]
        status = item.get("status")
        confidence = clamp_confidence(item.get("confidence"))
        explanation = truncate_text(item.get("explanation"), EXPLANATION_MAX)
        if status not in STATUSES:
            status = "cannot_judge"
        elif confidence < CONFIDENCE_FLOOR and status != "cannot_judge":
            # Don't show the guess for the old status under "can't judge".
            warnings.append(f"mark {mark}: {status} at confidence {confidence:.2f} shown as cannot_judge")
            status, explanation = "cannot_judge", LOW_CONFIDENCE
        # Name and class come from the project; the context's copies are the client's.
        element = _element(vis.guid, vis.ifc_class, vis.name, elements)
        findings[mark] = Finding(
            mark=mark, guid=vis.guid, name=element.name, ifc_class=element.ifc_class, status=status,
            confidence=confidence, evidence_box=_box(item.get("evidence_box")),
            offset=_offset(item.get("offset")) if status == "misplaced" else None,
            explanation=explanation, severity=severity_for(element, status),
        )

    for mark, vis in marks.items():
        if mark not in findings:
            warnings.append(f"no finding for mark {mark}; marked not assessed")
            element = _element(vis.guid, vis.ifc_class, vis.name, elements)
            findings[mark] = Finding(mark=mark, guid=vis.guid, name=element.name, ifc_class=element.ifc_class,
                                     status="cannot_judge", confidence=0.0, explanation="not assessed")

    unexpected: list[UnexpectedItem] = []
    raw_unexpected = raw.get("unexpected") if isinstance(raw.get("unexpected"), list) else []
    for item in raw_unexpected:
        if len(unexpected) == MAX_UNEXPECTED:
            break
        if not isinstance(item, dict):
            continue
        description = truncate_text(item.get("description"), DESCRIPTION_MAX)
        confidence = clamp_confidence(item.get("confidence"))
        if not description or confidence < CONFIDENCE_FLOOR:
            continue
        unexpected.append(UnexpectedItem(evidence_box=_box(item.get("evidence_box")), description=description,
                                         confidence=confidence))

    return CheckResult(
        project_id=ctx.project_id, anchor_id=ctx.anchor_id, image_quality=image_quality, pose_quality=ctx.pose_quality,
        findings=[findings[m] for m in sorted(findings)], unexpected=unexpected,
        summary=truncate_text(raw.get("summary"), SUMMARY_MAX), warnings=warnings,
    )
