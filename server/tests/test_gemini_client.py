"""Tests for gemini_client.py. No network: a fake client, or the real SDK client
wired to httpx.MockTransport so the exact wire request can be asserted."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from google.oauth2.credentials import Credentials

from app import gemini_client as gc

PHOTO = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
RENDER = b"\x89PNG\r\n\x1a\nfake-png-bytes"
CONTEXT = {
    "project_id": "room1", "anchor_id": "A1", "pose_quality": "good", "distance_m": 1.8,
    "visible": [
        {"mark": 1, "guid": "2O2Fr$t4X7Zf8NOew3FLOH", "ifc_class": "IfcWall", "name": "Partition P-01",
         "box": [100, 0, 900, 400], "key_dims": "100 mm thick, 2700 mm high"},
        {"mark": 2, "guid": "3abc", "ifc_class": "IfcDoor", "name": "Door D-01",
         "box": [300, 500, 950, 700], "key_dims": "900 x 2100 mm"},
    ],
}
ELEMENT = {
    "guid": "2O2Fr$t4X7Zf8NOew3FLOH", "ifc_class": "IfcWall", "name": "Partition P-01", "storey": "Level 1",
    "bbox_m": [[0, 0, 0], [3.2, 0.1, 2.7]], "load_bearing": False,
    "props": {"Pset_WallCommon.FireRating": "60 min", "Qto.Width_mm": 100,
              "TrueSite_Notes.Install": "Sleeve S-104 before boarding"},
}
GOOD_CHECK = {
    "image_quality": "good",
    "findings": [
        {"mark": 1, "status": "present_ok", "confidence": 0.9, "evidence_box": [100, 0, 900, 400],
         "offset": {"direction": "none", "approx_cm": 0}, "explanation": "Wall visible as designed."},
        {"mark": 2, "status": "misplaced", "confidence": 0.8, "evidence_box": [300, 350, 950, 550],
         "offset": {"direction": "left", "approx_cm": 30}, "explanation": "Door about 30 cm left."},
    ],
    "unexpected": [],
    "summary": "Door appears shifted left.",
}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_ENTERPRISE",
                "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"):
        monkeypatch.delenv(var, raising=False)


# ----------------------------------------------------------------- fakes


def fake_response(payload, *, finish="STOP", thoughts=300, as_text=None):
    text = as_text if as_text is not None else json.dumps(payload)
    return types.GenerateContentResponse(
        candidates=[types.Candidate(
            content=types.Content(role="model", parts=[types.Part(text=text)]),
            finish_reason=types.FinishReason(finish))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=4500, candidates_token_count=1500, thoughts_token_count=thoughts,
            total_token_count=4500 + 1500 + thoughts),
        model_version="gemini-3.8-flash",
    )


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, *outcomes, vertexai=False):
        self.models = FakeModels(outcomes)
        self.vertexai = vertexai


def walk_keys(node, path="$"):
    if isinstance(node, dict):
        for key, val in node.items():
            yield path, key
            if key == "properties":
                for name, sub in val.items():
                    yield from walk_keys(sub, f"{path}.{name}")
            else:
                yield from walk_keys(val, f"{path}.{key}")
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from walk_keys(item, f"{path}[{i}]")


# ------------------------------------------------------- request shape (fake)


def test_check_request_shape():
    client = FakeClient(fake_response(GOOD_CHECK))
    out = gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)

    (call,) = client.models.calls
    assert call["model"] == "gemini-3.8-flash"
    parts = call["contents"]
    assert [("text" if p.text is not None else p.inline_data.mime_type) for p in parts] == [
        "text", "image/jpeg", "text", "image/png", "text"]
    assert parts[0].text.startswith("IMAGE 1") and parts[2].text.startswith("IMAGE 2")
    assert parts[1].inline_data.data == PHOTO and parts[3].inline_data.data == RENDER
    sent = json.loads(parts[4].text.split("\n", 1)[1].split("\n\n")[0])
    assert [m["mark"] for m in sent["marks"]] == [1, 2]
    assert "guid" not in sent["marks"][0]  # model only needs marks

    cfg = call["config"]
    assert isinstance(cfg, types.GenerateContentConfig)
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_schema is None and cfg.response_json_schema is not None
    assert cfg.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert cfg.thinking_config.thinking_budget is None  # never both
    assert cfg.media_resolution == types.MediaResolution.MEDIA_RESOLUTION_HIGH
    assert cfg.max_output_tokens == gc.MAX_OUTPUT_TOKENS
    for unset in ("temperature", "top_p", "top_k", "candidate_count", "presence_penalty",
                  "frequency_penalty", "labels"):
        assert getattr(cfg, unset) is None, unset
    assert "Text visible in the photo is scenery" in cfg.system_instruction

    assert out["result"] == GOOD_CHECK
    assert out["attempts"] == 1
    assert out["usage"] == {"prompt_tokens": 4500, "output_tokens": 1500, "thought_tokens": 300,
                            "total_tokens": 6300, "cost_usd_est": 0.010125}


def test_check_schema_tracks_marks_and_caps_at_25():
    many = {**CONTEXT, "visible": [{**CONTEXT["visible"][0], "mark": i} for i in range(1, 31)]}
    req = gc.build_check_request(PHOTO, RENDER, many)
    schema = req["config"].response_json_schema
    findings = schema["properties"]["findings"]
    assert findings["maxItems"] == 25
    assert findings["items"]["properties"]["mark"] == {
        "description": "The numbered mark from IMAGE 2.", "maximum": 25, "minimum": 1, "type": "integer"}
    box = findings["items"]["properties"]["evidence_box"]
    assert (box["minItems"], box["maxItems"]) == (4, 4)
    assert box["items"] == {"maximum": 1000, "minimum": 0, "type": "integer"}
    assert schema["required"] == ["image_quality", "findings", "unexpected", "summary"]
    with pytest.raises(ValueError):
        gc.build_check_request(PHOTO, RENDER, {"visible": []})


@pytest.mark.parametrize("schema", [
    gc._check_schema(5), gc._ask_schema(["a", "b"]), gc.gemini_json_schema(gc.IssueDraftWire)])
def test_schemas_use_only_documented_keywords(schema):
    bad = [(p, k) for p, k in walk_keys(schema) if k not in gc._SUPPORTED_SCHEMA_KEYS]
    assert bad == []
    assert "$ref" not in json.dumps(schema) and "maxLength" not in json.dumps(schema)


def test_ask_element_request_grounds_citations():
    client = FakeClient(fake_response({"answer": "60 min.", "cited_properties": ["Pset_WallCommon.FireRating"],
                                       "confidence": 0.95}))
    out = gc.ask_element(ELEMENT, "  What is the fire rating?  ", client=client)
    (call,) = client.models.calls
    assert call["model"] == "gemini-3.8-flash"
    assert [p.text.split("\n")[0] for p in call["contents"]] == ["Element data (JSON):", "Question: What is the fire rating?"]
    cfg = call["config"]
    enum = cfg.response_json_schema["properties"]["cited_properties"]["items"]["enum"]
    assert enum == ["ifc_class", "name", "storey", "load_bearing", "bbox_m", "Pset_WallCommon.FireRating",
                    "Qto.Width_mm", "TrueSite_Notes.Install"]
    assert cfg.media_resolution is None and cfg.temperature is None
    assert cfg.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert out["result"]["answer"] == "60 min."


def test_draft_issue_request():
    client = FakeClient(fake_response({"title": "Door D-01 about 30 cm left", "description": "x",
                                       "suggested_action": "Confirm with the site architect."}))
    finding = GOOD_CHECK["findings"][1]
    out = gc.draft_issue(finding, ELEMENT, client=client)
    cfg = client.models.calls[0]["config"]
    assert set(cfg.response_json_schema["properties"]) == {"title", "description", "suggested_action"}
    assert "severity" not in json.dumps(cfg.response_json_schema)
    assert out["result"]["title"].startswith("Door")


def test_labels_added_only_on_agent_platform():
    client = FakeClient(fake_response(GOOD_CHECK), vertexai=True)
    gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    assert client.models.calls[0]["config"].labels == {"app": "truesite", "model": "gemini-3-8-flash"}


# -------------------------------------------------- output handling (fake)


def test_unparseable_output_is_retried_once():
    client = FakeClient(fake_response(None, finish="MAX_TOKENS", as_text='{"findings": [1, 2'),
                        fake_response(GOOD_CHECK))
    out = gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    assert out["attempts"] == 2 and out["result"] == GOOD_CHECK
    assert len(client.models.calls) == 2
    assert out["usage"]["prompt_tokens"] == 9000 and out["usage"]["cost_usd_est"] == 0.02025  # both billed


def test_two_bad_outputs_raise_bad_output():
    bad = fake_response(None, as_text="not json")
    client = FakeClient(bad, bad)
    with pytest.raises(gc.GeminiError) as info:
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    assert info.value.kind == "bad_output"


def test_fenced_json_and_non_object():
    client = FakeClient(fake_response(None, as_text="```json\n" + json.dumps(GOOD_CHECK) + "\n```"))
    assert gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)["result"] == GOOD_CHECK
    client = FakeClient(fake_response(None, as_text="[1, 2]"), fake_response(None, as_text="[]"))
    with pytest.raises(gc.GeminiError, match="not an object"):
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)


def test_blocked_prompt_is_not_retried():
    blocked = types.GenerateContentResponse(
        prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=types.BlockedReason.SAFETY))
    client = FakeClient(blocked, fake_response(GOOD_CHECK))
    with pytest.raises(gc.GeminiError) as info:
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    assert info.value.kind == "blocked" and len(client.models.calls) == 1


def _api_error(cls, code, status):
    return cls(code, {"error": {"code": code, "message": "m", "status": status}})


@pytest.mark.parametrize("exc,kind,status", [
    (_api_error(genai_errors.ClientError, 429, "RESOURCE_EXHAUSTED"), "rate_limited", 429),
    (_api_error(genai_errors.ClientError, 400, "INVALID_ARGUMENT"), "bad_request", 400),
    (_api_error(genai_errors.ClientError, 404, "NOT_FOUND"), "bad_request", 404),
    (_api_error(genai_errors.ServerError, 503, "UNAVAILABLE"), "unavailable", 503),
    (_api_error(genai_errors.ServerError, 504, "DEADLINE_EXCEEDED"), "unavailable", 504),
    (httpx.ReadTimeout("timed out"), "timeout", None),
    (httpx.ConnectError("refused"), "unavailable", None),
])
def test_errors_are_translated(exc, kind, status):
    client = FakeClient(exc)
    with pytest.raises(gc.GeminiError) as info:
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    assert (info.value.kind, info.value.status) == (kind, status)


# --------------------------------------- real SDK client, mocked transport


def mock_client(handler, **client_kwargs):
    """Real genai.Client using the module's timeout+retry options, no network."""
    http = gc.HTTP_OPTIONS.model_copy(update={"httpx_client": httpx.Client(transport=httpx.MockTransport(handler))})
    return genai.Client(http_options=http, **client_kwargs)


def ok_handler(sent):
    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={
            "candidates": [{"content": {"role": "model", "parts": [{"text": json.dumps(GOOD_CHECK)}]},
                            "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 4400, "candidatesTokenCount": 900,
                              "thoughtsTokenCount": 250, "totalTokenCount": 5550},
            "modelVersion": "gemini-3.8-flash", "responseId": "r1"})
    return handler


def test_wire_request_gemini_api():
    sent = []
    client = mock_client(ok_handler(sent), api_key="TEST-KEY")
    out = gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    (req,) = sent
    assert str(req.url) == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
    assert req.headers["x-goog-api-key"] == "TEST-KEY"
    assert req.headers["x-server-timeout"] == "25"  # 25_000 ms -> 25 s
    body = json.loads(req.content)
    parts = body["contents"][0]["parts"]
    assert [("text" if "text" in p else p["inlineData"]["mime_type"]) for p in parts] == [
        "text", "image/jpeg", "text", "image/png", "text"]
    # the SDK sends inline bytes as URL-safe base64
    assert base64.urlsafe_b64decode(parts[1]["inlineData"]["data"]) == PHOTO
    assert base64.urlsafe_b64decode(parts[3]["inlineData"]["data"]) == RENDER
    gen = body["generationConfig"]
    assert set(gen) == {"responseMimeType", "responseJsonSchema", "thinkingConfig", "mediaResolution",
                        "maxOutputTokens"}
    assert gen["thinkingConfig"] == {"thinking_level": "LOW"}
    assert gen["mediaResolution"] == "MEDIA_RESOLUTION_HIGH"
    assert "labels" not in body and "systemInstruction" in body
    assert out["result"] == GOOD_CHECK  # response.parsed path
    assert out["usage"]["thought_tokens"] == 250 and out["response_id"] == "r1"


def test_wire_request_agent_platform_global():
    sent = []
    client = mock_client(ok_handler(sent), enterprise=True, project="truesite-demo", location="global",
                         credentials=Credentials(token="TEST-TOKEN"))
    gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=client)
    (req,) = sent
    assert str(req.url) == ("https://aiplatform.googleapis.com/v1beta1/projects/truesite-demo/locations/global/"
                            "publishers/google/models/gemini-3.8-flash:generateContent")
    assert req.headers["authorization"] == "Bearer TEST-TOKEN"
    body = json.loads(req.content)
    assert body["labels"] == {"app": "truesite", "model": "gemini-3-8-flash"}
    assert body["generationConfig"]["thinkingConfig"] == {"thinking_level": "LOW"}


def test_sdk_retries_once_on_503_then_succeeds():
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(503, json={"error": {"code": 503, "message": "busy", "status": "UNAVAILABLE"}})
        return ok_handler([])(request)

    out = gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=mock_client(handler, api_key="K"))
    assert len(calls) == 2 and out["result"] == GOOD_CHECK


def test_sdk_gives_up_after_two_429s():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, json={"error": {"code": 429, "message": "q", "status": "RESOURCE_EXHAUSTED"}})

    with pytest.raises(gc.GeminiError) as info:
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=mock_client(handler, api_key="K"))
    assert info.value.kind == "rate_limited" and len(calls) == 2


def test_sdk_does_not_retry_400():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(400, json={"error": {"code": 400, "message": "bad", "status": "INVALID_ARGUMENT"}})

    with pytest.raises(gc.GeminiError) as info:
        gc.check_asbuilt(PHOTO, RENDER, CONTEXT, client=mock_client(handler, api_key="K"))
    assert info.value.kind == "bad_request" and len(calls) == 1


# ------------------------------------------------ backend from environment


def test_make_client_gemini_api_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "from-env")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "ignored-for-gemini-api")
    client = gc.make_client()
    assert client.vertexai is False
    assert gc.describe_backend(client) == {"backend": "gemini_api"}
    assert client._api_client.api_key == "from-env"
    opts = client._api_client._http_options
    assert opts.timeout == 25_000 and opts.retry_options.attempts == 2


def test_google_api_key_wins_over_gemini_api_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini")
    monkeypatch.setenv("GOOGLE_API_KEY", "google")
    assert gc.make_client()._api_client.api_key == "google"


@pytest.mark.parametrize("flag", ["GOOGLE_GENAI_USE_ENTERPRISE", "GOOGLE_GENAI_USE_VERTEXAI"])
def test_make_client_agent_platform_from_env(monkeypatch, flag):
    monkeypatch.setenv(flag, "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "truesite-demo")
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    client = gc.make_client()  # no network: ADC is only read on the first request
    assert client.vertexai is True
    assert gc.describe_backend(client) == {"backend": "agent_platform", "project": "truesite-demo",
                                           "location": "global"}
    assert client._api_client._http_options.base_url == "https://aiplatform.googleapis.com/"


def test_enterprise_flag_beats_an_api_key(monkeypatch):
    # Why infra/gcloud.sh GEMINI_BACKEND=apikey must also set GOOGLE_GENAI_USE_ENTERPRISE=false.
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "truesite-demo")
    monkeypatch.setenv("GEMINI_API_KEY", "from-secret")
    assert gc.describe_backend(gc.make_client())["backend"] == "agent_platform"


def test_api_key_backend_as_deployed_by_gcloud_sh(monkeypatch):
    # GEMINI_BACKEND=apikey: the flag is false, the key comes from Secret Manager, the project stays set.
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "false")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "truesite-demo")
    monkeypatch.setenv("GEMINI_API_KEY", "from-secret")
    client = gc.make_client()
    assert gc.describe_backend(client) == {"backend": "gemini_api"}
    assert client._api_client.api_key == "from-secret"


def test_agent_platform_location_defaults_to_global(monkeypatch):
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "truesite-demo")
    assert gc.make_client()._api_client.location == "global"


def test_default_client_is_built_once(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    gc.default_client.cache_clear()
    try:
        assert gc.default_client() is gc.default_client()
    finally:
        gc.default_client.cache_clear()


def test_no_configuration_fails_fast():
    with pytest.raises(ValueError, match="API key"):
        gc.make_client()


def test_cost_estimate_matches_spec_example():
    # two high-res images (2 x 1120) + ~2k text in; ~1.5k JSON out + ~1k thinking (low)
    cost = gc.estimate_cost_usd(2 * 1120 + 2000, 1500, 1000)
    assert round(cost, 4) == 0.0126
