"""POST /api/ask with the offline FakeGeminiClient: grounding, limits and errors."""
import json
import logging
from types import SimpleNamespace

import httpx

from app import services

from .conftest import GUID_DOOR, GUID_WALL, new_session


def ask(client, guid=GUID_WALL, question="What's the fire rating?", project="testproj", session=None):
    return client.post("/api/ask", json={"project_id": project, "guid": guid, "question": question},
                       headers={"X-Session-Id": session or new_session()})


class CannedClient:
    vertexai = False

    def __init__(self, payload):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        self.models = SimpleNamespace(generate_content=lambda **_k: SimpleNamespace(
            text=text, parsed=None, usage_metadata=None, candidates=[], prompt_feedback=None))


def raising_client(exc):
    def generate_content(**_k):
        raise exc
    return SimpleNamespace(vertexai=False, models=SimpleNamespace(generate_content=generate_content))


def no_credentials(_settings):
    raise ValueError("No API key was provided.")


def test_answer_cites_real_properties(client):
    r = ask(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cited_properties"] == ["Pset_WallCommon.FireRating"] and "60 min" in body["answer"]


def test_element_without_properties_says_so(client):
    assert ask(client, guid=GUID_DOOR).json()["answer"] == "The element data does not say."


def test_invented_citations_are_dropped_and_text_truncated(client):
    client.app.state.client = CannedClient({"answer": "x" * 900, "confidence": 3,
                                            "cited_properties": ["Pset_WallCommon.FireRating", "Pset_Made.Up", "name", "name"]})
    body = ask(client).json()
    assert body["cited_properties"] == ["Pset_WallCommon.FireRating", "name"]
    assert len(body["answer"]) == 600 and body["confidence"] == 1.0


def test_unknown_element_and_project(client):
    assert ask(client, guid="0" * 22).json()["detail"]["code"] == "unknown_element"
    assert ask(client, project="nope").json()["detail"]["code"] == "unknown_project"


def test_validation_and_session(client):
    assert ask(client, question="").status_code == 422
    assert ask(client, question="q" * 301).status_code == 422
    r = client.post("/api/ask", json={"project_id": "testproj", "guid": GUID_WALL, "question": "hi"})
    assert r.status_code == 422


def test_ask_has_its_own_limits(make_client):
    client = make_client(asks_per_ip_per_hour=1)
    assert ask(client).status_code == 200
    assert ask(client).json()["detail"]["code"] == "rate_limited"
    capped = make_client(peer="198.51.100.9", daily_ask_cap=0)
    assert ask(capped).json()["detail"]["code"] == "daily_cap"


def test_model_junk_is_502(client):
    client.app.state.client = CannedClient("not json")
    r = ask(client)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "model_bad_output"


def test_gemini_failure_is_logged(client, caplog):
    client.app.state.client = raising_client(httpx.ReadTimeout("slow"))
    with caplog.at_level(logging.WARNING, logger="truesite"):
        r = ask(client)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "model_unavailable"
    assert any(m.startswith("ask failed") and "timeout" in m for m in caplog.messages)


def test_client_setup_error_is_a_json_500_and_uses_no_quota(make_client, monkeypatch, caplog):
    client = make_client(daily_ask_cap=1)
    build = services.build_client
    monkeypatch.setattr(services, "build_client", no_credentials)
    with caplog.at_level(logging.WARNING, logger="truesite"):
        r = ask(client)
    assert r.status_code == 500 and r.json()["detail"]["code"] == "model_bad_request"
    assert any(m.startswith("ask failed") and "API key" in m for m in caplog.messages)
    monkeypatch.setattr(services, "build_client", build)
    assert ask(client).status_code == 200  # the failed setup did not use up the one allowed ask


def test_ask_usage_is_logged(client, caplog):
    with caplog.at_level(logging.INFO, logger="truesite"):
        assert ask(client).status_code == 200
    assert any(m.startswith("ask usage") and "cost_usd_est" in m for m in caplog.messages)
