"""Property tests for the crew-language request bodies and the site report repair (POST /api/report).

Gemini drafts in one of eight JAPAC crew languages; anything else is a 422 before any model call. The
report Gemini writes is a draft: whatever it returns, the server hands back a SiteReport within its
limits, and the summary carries the copy-rule label (spec section 4.4).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from hypothesis import HealthCheck, example, given, settings, strategies as st
from pydantic import ValidationError

from app import services
from app.schemas import CheckRun, IssueDraftRequest, ReportRequest, SiteReport
from app.validate import truncate_text

LANGUAGES = ["en", "th", "my", "id", "ms", "vi", "zh", "ja"]
RUN = "a" * 22
LABEL = "Visual check, not a survey."
PROPS = settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])

languages = st.sampled_from(LANGUAGES) | st.sampled_from(["EN", " en", "en-US", "zh-Hans", "jp", "kr", ""]) | st.text(max_size=6)


@PROPS
@given(languages)
def test_only_the_eight_crew_languages_are_accepted(language):
    bodies = [(ReportRequest, {"run_ids": [RUN], "language": language}),
              (IssueDraftRequest, {"run_id": RUN, "mark": 1, "language": language})]
    for model, body in bodies:
        if language in LANGUAGES:
            assert model.model_validate(body).language == language
        else:
            with pytest.raises(ValidationError):
                model.model_validate(body)


def test_the_language_defaults_to_english():
    assert ReportRequest.model_validate({"run_ids": [RUN]}).language == "en"
    assert IssueDraftRequest.model_validate({"run_id": RUN, "mark": 1}).language == "en"


@PROPS
@given(st.lists(st.from_regex(r"[A-Za-z0-9_-]{16,32}", fullmatch=True), max_size=10))
def test_a_report_takes_one_to_eight_run_ids(run_ids):
    if 1 <= len(run_ids) <= 8:
        assert ReportRequest.model_validate({"run_ids": run_ids}).run_ids == run_ids
    else:
        with pytest.raises(ValidationError):
            ReportRequest.model_validate({"run_ids": run_ids})


@PROPS
@given(st.text(max_size=40) | st.from_regex(r"[A-Za-z0-9_-]{16,32}\n?", fullmatch=True))
def test_run_ids_must_look_like_server_run_ids(run_id):
    valid = re.fullmatch(r"[A-Za-z0-9_-]{16,32}", run_id) is not None  # no trailing newline, no "/"
    for model, body in ((ReportRequest, {"run_ids": [run_id]}), (IssueDraftRequest, {"run_id": run_id, "mark": 1})):
        if valid:
            model.model_validate(body)
        else:
            with pytest.raises(ValidationError):
                model.model_validate(body)


# ---- the report Gemini drafts --------------------------------------------------------------------------
scalars = st.none() | st.booleans() | st.integers(-1000, 1000) | st.floats() | st.text(max_size=20)
texts = st.text(max_size=900) | st.sampled_from([LABEL, "All clear. visual check, not a survey", "   "]) | scalars
# List fields can come back as a lone string (one item), a number, a boolean or an object (no items): C-38.
lists = (st.none() | st.lists(st.text(max_size=260) | scalars, max_size=14) | scalars
         | st.dictionaries(st.text(max_size=8), scalars, max_size=3))
answers = st.fixed_dictionaries({}, optional={"title": texts, "summary": texts, "safety": lists, "structure": lists,
                                              "progress": lists, "next_steps": lists})


def stored_run(i: int) -> CheckRun:
    return CheckRun(run_id=f"{RUN[:-2]}{i:02d}", session_id="s", project_id="site", anchor_id=f"P{i}",
                    created_at=datetime(2026, 10, 17, 9, i, tzinfo=timezone.utc), context={},
                    result={"findings": [{"mark": 1, "status": "missing", "name": "Column C1", "severity": "high"}]},
                    photo_key="p", render_key="r")


def given_items(value) -> list[str]:
    """The items a report list field holds: a list's non-blank strings, or a lone non-blank string."""
    values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    return [x for x in values if isinstance(x, str) and x.strip()]


@PROPS
@given(answers, st.integers(1, 8), st.sampled_from(LANGUAGES))
@example({"safety": "Fall hazard at the east edge", "structure": 1, "progress": 2.5, "next_steps": True}, 1, "en")
def test_any_report_answer_becomes_a_report_within_its_limits_with_the_label(raw, n_runs, language):
    with patch.object(services.gemini_client, "write_report", return_value={"result": raw}) as write:
        report = services.make_reporter(None)([stored_run(i) for i in range(n_runs)], language)
    assert write.call_args.kwargs["language"] == language
    SiteReport.model_validate(report.model_dump())
    assert report.checks == n_runs
    assert 0 < len(report.title) <= 100 and len(report.summary) <= 700
    assert "visual check, not a survey" in report.summary.lower()  # copy rule: a draft, not a survey
    for key, cap in (("safety", 10), ("structure", 10), ("progress", 10), ("next_steps", 8)):
        items, given = getattr(report, key), given_items(raw.get(key))
        assert len(items) == min(cap, len(given))
        assert all(item.strip() and len(item) <= 200 for item in items)
        assert items == [truncate_text(x, 200) for x in given[:cap]]  # whole items, never letters
