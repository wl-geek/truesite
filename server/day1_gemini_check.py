"""Day-1 Gemini access check for TrueSite (spec section 5: choose the access path).

Uses the same environment configuration as the server (see gemini_client.py):

  Agent Platform:  GOOGLE_GENAI_USE_ENTERPRISE=true GOOGLE_CLOUD_PROJECT=<id> GOOGLE_CLOUD_LOCATION=global
                   (after `gcloud auth application-default login` locally, or on Cloud Run)
  Gemini API:      GEMINI_API_KEY=<key>

  python day1_gemini_check.py                      # count tokens (free) + one tiny call (~$0.0001)
  python day1_gemini_check.py --photo p.jpg --render r.png --context ctx.json   # + one real check (~1-2 cents)
  python day1_gemini_check.py --mock               # offline dry run with canned responses

Exit code 0 means this backend can serve gemini-3.8-flash from this location.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx
from google import genai
from google.genai import types

import gemini_client as gc


def _mock_transport() -> httpx.MockTransport:
    check = {"image_quality": "good", "findings": [], "unexpected": [], "summary": "mock"}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(":countTokens"):
            return httpx.Response(200, json={"totalTokens": 1131})
        body = json.loads(request.content)
        text = json.dumps(check) if "responseJsonSchema" in body.get("generationConfig", {}) else "OK"
        return httpx.Response(200, json={
            "candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 1, "thoughtsTokenCount": 20,
                              "totalTokenCount": 33},
            "modelVersion": gc.MODEL_ID})
    return httpx.MockTransport(handler)


def build_client(mock: bool) -> genai.Client:
    if not mock:
        return gc.make_client()
    http = gc.HTTP_OPTIONS.model_copy(update={"httpx_client": httpx.Client(transport=_mock_transport())})
    kwargs = {}
    if _env_is_agent_platform():
        from google.oauth2.credentials import Credentials
        kwargs["credentials"] = Credentials(token="mock-token")  # no ADC needed offline
    return genai.Client(http_options=http, **kwargs)


def _env_is_agent_platform() -> bool:
    import os
    flag = os.environ.get("GOOGLE_GENAI_USE_ENTERPRISE", os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", ""))
    return flag.lower() in ("true", "1")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--photo", type=Path)
    ap.add_argument("--render", type=Path)
    ap.add_argument("--context", type=Path)
    ap.add_argument("--mock", action="store_true", help="offline dry run, no network")
    args = ap.parse_args(argv)

    client = build_client(args.mock)
    print("google-genai", genai.__version__, "| model", gc.MODEL_ID, "|", json.dumps(gc.describe_backend(client)))

    # 1. Free call: proves credentials, model id and location resolve.
    try:
        contents: list = ["ping"]
        if args.photo:
            contents.append(types.Part.from_bytes(data=args.photo.read_bytes(), mime_type="image/jpeg"))
        tokens = client.models.count_tokens(model=gc.MODEL_ID, contents=contents)
        print("count_tokens OK:", tokens.total_tokens, "tokens (text" + (" + photo" if args.photo else "") + ")")
    except Exception as exc:  # noqa: BLE001
        print("count_tokens FAILED:", type(exc).__name__, exc)
        print("  404 NOT_FOUND -> model not served here: check GOOGLE_CLOUD_LOCATION=global, else use the Gemini API key path")
        print("  403 PERMISSION_DENIED -> enable aiplatform.googleapis.com and grant the caller roles/aiplatform.user")
        return 1

    # 2. Tiny generation with the production thinking level.
    try:
        resp = client.models.generate_content(
            model=gc.MODEL_ID, contents="Reply with the single word OK.",
            config=types.GenerateContentConfig(thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.LOW), max_output_tokens=256))
        print("generate_content OK:", repr(resp.text), "| model_version", resp.model_version,
              "| usage", json.dumps(gc.usage_dict(resp)))
    except Exception as exc:  # noqa: BLE001
        print("generate_content FAILED:", type(exc).__name__, exc)
        return 1

    # 3. Optional real as-built check on a sample pair.
    if args.photo and args.render and args.context:
        out = gc.check_asbuilt(args.photo.read_bytes(), args.render.read_bytes(),
                               json.loads(args.context.read_text()), client=client)
        print("check_asbuilt OK in", out["latency_ms"], "ms, attempts", out["attempts"])
        print("usage", json.dumps(out["usage"]))
        print(json.dumps(out["result"], indent=1)[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
