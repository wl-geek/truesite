"""Property tests for request bodies: whatever JSON a client posts, the API answers in strict JSON and never 5xx.

json.loads reads NaN, Infinity and -Infinity, which strict JSON (and the browser's JSON.parse) has no words for;
FastAPI's default 422 echoed them back and answered 500 instead (C-12).
"""
from __future__ import annotations

import json
import math
from typing import Any

from fastapi.testclient import TestClient
from hypothesis import HealthCheck, example, given, settings, strategies as st

from .conftest import GUID_WALL, new_session
from .test_check_route import context, post as post_check
from .test_main import strict_json

PROPS = settings(max_examples=150, deadline=None,
                 suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow])

non_finite = st.sampled_from([math.nan, math.inf, -math.inf])  # st.floats() alone draws them too rarely
scalars = st.none() | st.booleans() | st.integers() | st.floats() | non_finite | st.text(max_size=8)
json_values = st.recursive(
    scalars, lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(max_size=5), inner, max_size=3),
    max_leaves=6)
BODIES = {
    "/api/ask": {"project_id": "testproj", "guid": GUID_WALL, "question": "How thick is it?"},
    "/api/report": {"run_ids": ["a" * 22]},
    "/api/issues/draft": {"run_id": "a" * 22, "mark": 1},
    "/api/issues": {"project_id": "testproj", "guid": GUID_WALL, "title": "Partition looks thicker than designed"},
    "/api/check": json.loads(context()),  # sent as the multipart `context` field
}


@PROPS
@given(st.sampled_from(sorted(BODIES)), st.integers(0, 7), json_values)
@example("/api/ask", 2, math.nan)  # the audit's probe (C-12)
@example("/api/check", 3, {"m": [math.inf]})
def test_any_json_in_any_field_gets_a_strict_json_answer_below_500(client: TestClient, path: str, which: int,
                                                                    value: Any) -> None:
    body = dict(BODIES[path])
    keys = [*body, "extra"]  # each field of a valid body, or one the model does not have
    body[keys[which % len(keys)]] = value
    text = json.dumps(body)  # allow_nan: NaN, Infinity and -Infinity go out as a client could send them
    if path == "/api/check":
        r = post_check(client, ctx=text)
    else:
        r = client.post(path, content=text, headers={"X-Session-Id": new_session(), "Content-Type": "application/json"})
    assert r.status_code < 500, r.text
    strict_json(r.text)
