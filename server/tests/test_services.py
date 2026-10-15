"""services.py: the Gemini error mapping (contract section 6)."""
from __future__ import annotations

import pytest

from app.gemini_client import GeminiError
from app.services import http_error_for


@pytest.mark.parametrize("kind,status,code", [
    ("timeout", 503, "model_unavailable"),
    ("unavailable", 503, "model_unavailable"),
    ("rate_limited", 503, "model_unavailable"),
    ("bad_output", 502, "model_bad_output"),
    ("blocked", 422, "model_blocked"),
    ("bad_request", 500, "model_bad_request"),
    ("something_new", 503, "model_unavailable"),
])
def test_http_error_for(kind: str, status: int, code: str) -> None:
    exc = http_error_for(GeminiError(kind, "x"))
    assert (exc.status_code, exc.detail) == (status, {"code": code})
    assert (exc.headers or {}).get("Retry-After") == ("5" if status == 503 else None)
