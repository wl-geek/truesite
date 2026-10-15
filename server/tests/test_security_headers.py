"""Security response headers (audit A-25): every response, SPA and API alike."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import new_session

PATHS = ["/", "/a/testproj/A1", "/api/health", "/api/issues", "/api/projects/testproj/model.glb", "/api/nope"]


def get(client: TestClient, path: str):
    return client.get(path, headers={"X-Session-Id": new_session()})


@pytest.mark.parametrize("path", PATHS)
def test_every_response_gets_the_security_headers(client: TestClient, path: str) -> None:
    h = get(client, path).headers
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert h["X-Frame-Options"] == "DENY"
    # No cross-origin isolation headers: the app needs none (A-25).
    assert "Cross-Origin-Embedder-Policy" not in h and "Cross-Origin-Opener-Policy" not in h


def test_permissions_policy_keeps_camera_motion_and_xr_for_this_origin(client: TestClient) -> None:
    policy = {p.split("=", 1)[0].strip(): p.split("=", 1)[1].strip()
              for p in client.get("/").headers["Permissions-Policy"].split(",")}
    for feature in ("camera", "gyroscope", "accelerometer", "magnetometer", "xr-spatial-tracking"):
        assert policy[feature] == "(self)", feature
    assert policy["microphone"] == "()" and policy["geolocation"] == "()"


def test_csp_is_report_only_and_allows_what_the_app_uses(client: TestClient) -> None:
    h = client.get("/").headers
    assert "Content-Security-Policy" not in h  # observe first, enforce in a later change
    csp = {d.split()[0]: d.split()[1:] for d in h["Content-Security-Policy-Report-Only"].split(";") if d.strip()}
    assert csp["default-src"] == ["'self'"]
    assert "'wasm-unsafe-eval'" in csp["script-src"]  # zxing-wasm in the QR worker
    assert set(csp["worker-src"]) >= {"'self'", "blob:"}
    assert set(csp["img-src"]) >= {"'self'", "blob:", "data:"}  # URL.createObjectURL photos, glb textures
    assert csp["frame-ancestors"] == ["'none'"] and csp["object-src"] == ["'none'"]


@pytest.mark.parametrize("path", ["/api/health", "/api/issues", "/api/projects/testproj", "/api/nope"])
def test_api_json_is_not_stored(client: TestClient, path: str) -> None:
    assert get(client, path).headers["Cache-Control"] == "no-store"


def test_routes_and_static_files_keep_their_own_cache_headers(client: TestClient) -> None:
    assert get(client, "/api/projects/testproj/model.glb").headers["Cache-Control"] == "no-cache"
    assert client.get("/").headers["Cache-Control"] == "no-cache"
    assert client.get("/assets/index-abc123.js").headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_early_413_from_the_body_limit_gets_them_too(make_client) -> None:
    r = make_client(max_body_bytes=10).post("/api/issues", content=b"x" * 100,
                                            headers={"X-Session-Id": new_session(), "Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.headers["X-Frame-Options"] == "DENY" and r.headers["Cache-Control"] == "no-store"
