"""Repair the model's as-built answer into a CheckResult (spec section 6, server rules).

Gemini's output is untrusted: anything malformed is repaired or dropped here, and every
change that affects what the user sees is recorded in `warnings`.
"""
from __future__ import annotations

from typing import Any, get_args

from .schemas import CheckContext, CheckResult, Direction, Element, Finding, ImageQuality, Offset, Status, UnexpectedItem
from .severity import severity_for

CONFIDENCE_FLOOR = 0.5
MAX_UNEXPECTED = 10
EXPLANATION_MAX, DESCRIPTION_MAX, SUMMARY_MAX = 200, 150, 300
STATUSES = set(get_args(Status))
DIRECTIONS = set(get_args(Direction))
IMAGE_QUALITIES = set(get_args(ImageQuality))


def _text(value: Any, limit: int) -> str:
    s = value.strip() if isinstance(value, str) else ""
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return min(1.0, max(0.0, float(value)))


def _box(value: Any) -> list[int] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value):
        return None
    y0, x0, y1, x1 = (min(1000, max(0, round(v))) for v in value)
    if y0 == x0 == y1 == x1 == 0:
        return None
    return [min(y0, y1), min(x0, x1), max(y0, y1), max(x0, x1)]


def _offset(value: Any) -> Offset | None:
    if not isinstance(value, dict) or value.get("direction") not in DIRECTIONS or value.get("direction") == "none":
        return None
    cm = value.get("approx_cm")
    if isinstance(cm, bool) or not isinstance(cm, (int, float)):
        return None
    return Offset(direction=value["direction"], approx_cm=min(500, max(0, round(cm / 10) * 10)))


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
        mark = item.get("mark")
        if isinstance(mark, bool) or not isinstance(mark, int) or mark not in marks:
            warnings.append(f"dropped a finding for unknown mark {mark}")
            continue
        if mark in findings:
            warnings.append(f"dropped a duplicate finding for mark {mark}")
            continue
        vis = marks[mark]
        status = item.get("status")
        confidence = _confidence(item.get("confidence"))
        if status not in STATUSES or confidence < CONFIDENCE_FLOOR:
            status = "cannot_judge"
        element = _element(vis.guid, vis.ifc_class, vis.name, elements)
        findings[mark] = Finding(
            mark=mark, guid=vis.guid, name=vis.name, ifc_class=vis.ifc_class, status=status, confidence=confidence,
            evidence_box=_box(item.get("evidence_box")),
            offset=_offset(item.get("offset")) if status == "misplaced" else None,
            explanation=_text(item.get("explanation"), EXPLANATION_MAX),
            severity=severity_for(element, status),
        )

    for mark, vis in marks.items():
        if mark not in findings:
            warnings.append(f"no finding for mark {mark}; marked not assessed")
            findings[mark] = Finding(mark=mark, guid=vis.guid, name=vis.name, ifc_class=vis.ifc_class,
                                     status="cannot_judge", confidence=0.0, explanation="not assessed")

    unexpected: list[UnexpectedItem] = []
    raw_unexpected = raw.get("unexpected") if isinstance(raw.get("unexpected"), list) else []
    for item in raw_unexpected:
        if len(unexpected) == MAX_UNEXPECTED:
            break
        if not isinstance(item, dict):
            continue
        description = _text(item.get("description"), DESCRIPTION_MAX)
        confidence = _confidence(item.get("confidence"))
        if not description or confidence < CONFIDENCE_FLOOR:
            continue
        unexpected.append(UnexpectedItem(evidence_box=_box(item.get("evidence_box")), description=description,
                                         confidence=confidence))

    return CheckResult(
        project_id=ctx.project_id, anchor_id=ctx.anchor_id, image_quality=image_quality, pose_quality=ctx.pose_quality,
        findings=[findings[m] for m in sorted(findings)], unexpected=unexpected,
        summary=_text(raw.get("summary"), SUMMARY_MAX), warnings=warnings,
    )
