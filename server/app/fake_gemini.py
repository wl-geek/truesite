"""Offline, deterministic stand-in for the google-genai client (GEMINI_MODE=fake).

It exposes the one method gemini_client.generate_json uses -- models.generate_content(model=,
contents=, config=) -- and answers from the request itself, so local dev, tests and demos
run with no credentials and no cost:
  - check: every mark present_ok, except names containing "Sleeve" (missing) and "Door"
    (misplaced, about 30 cm right);
  - ask: the element's first property;
  - issue draft: a template built from the finding.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from . import gemini_client


def _texts(contents: list[Any]) -> list[str]:
    return [t for t in (getattr(p, "text", None) for p in contents) if isinstance(t, str)]


def _json_after(text: str, header: str) -> Any:
    body = text.split(header, 1)[1]
    end = body.rfind("}")
    return json.loads(body[: end + 1])


def _check(contents: list[Any]) -> dict:
    task = _json_after(_texts(contents)[-1], "(JSON):\n")
    findings = []
    for m in task.get("marks", []):
        name = m.get("name", "")
        box = m.get("box") or [0, 0, 0, 0]
        if "Sleeve" in name:
            findings.append({"mark": m["mark"], "status": "missing", "confidence": 0.8, "evidence_box": box,
                             "offset": {"direction": "none", "approx_cm": 0},
                             "explanation": "Nothing visible where the design shows this element."})
        elif "Door" in name:
            findings.append({"mark": m["mark"], "status": "misplaced", "confidence": 0.75, "evidence_box": box,
                             "offset": {"direction": "right", "approx_cm": 30},
                             "explanation": "The opening sits to the right of the designed position."})
        else:
            findings.append({"mark": m["mark"], "status": "present_ok", "confidence": 0.9, "evidence_box": box,
                             "offset": {"direction": "none", "approx_cm": 0}, "explanation": "Matches the design."})
    deviations = sum(f["status"] != "present_ok" for f in findings)
    return {"image_quality": "good", "findings": findings, "unexpected": [],
            "summary": f"Offline check: {len(findings)} elements compared, {deviations} possible deviations."}


def _ask(contents: list[Any]) -> dict:
    texts = _texts(contents)
    data = _json_after(texts[0], "(JSON):\n")
    props = {k: v for k, v in data.items() if "." in k or k == "Material"}
    if not props:
        return {"answer": "The element data does not say.", "cited_properties": [], "confidence": 0.3}
    key, value = next(iter(props.items()))
    return {"answer": f"{key} is {value}.", "cited_properties": [key], "confidence": 0.6}


def _issue(contents: list[Any]) -> dict:
    data = _json_after(_texts(contents)[0], "(JSON):\n")
    finding, element = data.get("finding", {}), data.get("element", {})
    name = element.get("name") or finding.get("name") or "Element"
    status = str(finding.get("status", "deviation")).replace("_", " ")
    return {"title": f"{name}: {status}"[:80],
            "description": f"As-built check flagged {name} as {status}. Visual check, not a survey."[:500],
            "suggested_action": "Check on site and confirm with the design team before closing."}


def _report(contents: list[Any]) -> dict:
    checks = _json_after(_texts(contents)[0], "(JSON):\n").get("checks", [])
    devs = [(c.get("spot"), d) for c in checks for d in c.get("deviations", [])]
    line = lambda spot, d: f"{d.get('name')} at {spot}: {str(d.get('status', '')).replace('_', ' ')}."
    return {
        "title": f"Site report: {len(devs)} item{'s' if len(devs) != 1 else ''} from {len(checks)} check{'s' if len(checks) != 1 else ''}",
        "summary": f"Offline report from {len(checks)} check{'s' if len(checks) != 1 else ''}. Visual check, not a survey.",
        "safety": [line(s, d) for s, d in devs if d.get("ifc_class") == "IfcRailing"],
        "structure": [line(s, d) for s, d in devs if d.get("status") in ("misplaced", "different_from_design")],
        "progress": [line(s, d) for s, d in devs if d.get("status") == "missing" and d.get("ifc_class") != "IfcRailing"],
        "next_steps": ["Review each item on site and confirm with the design team."] if devs else [],
    }


class _Models:
    def generate_content(self, *, model: str, contents: list[Any], config: Any) -> SimpleNamespace:
        system = getattr(config, "system_instruction", "")
        if system == gemini_client.CHECK_SYSTEM:
            payload = _check(contents)
        elif system == gemini_client.ASK_SYSTEM:
            payload = _ask(contents)
        elif system == gemini_client.REPORT_SYSTEM:
            payload = _report(contents)
        else:
            payload = _issue(contents)
        usage = SimpleNamespace(prompt_token_count=0, candidates_token_count=0, thoughts_token_count=0,
                                total_token_count=0)
        return SimpleNamespace(text=json.dumps(payload), parsed=None, usage_metadata=usage, model_version="fake",
                               response_id="fake", candidates=[], prompt_feedback=None)


class FakeGeminiClient:
    vertexai = False

    def __init__(self) -> None:
        self.models = _Models()
