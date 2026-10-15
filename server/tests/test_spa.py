from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import InMemoryStore

from .conftest import APP_JS, INDEX_HTML, JPEG


@pytest.mark.parametrize("path", ["/", "/a/room1/A1", "/a/desk-a4/D1", "/viewer", "/some/deep/client/route"])
def test_client_routes_fall_back_to_index(client: TestClient, path: str) -> None:
    r = client.get(path)
    assert r.status_code == 200
    assert r.text == INDEX_HTML
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"


def test_head_on_client_route(client: TestClient) -> None:
    r = client.head("/a/room1/A1")
    assert r.status_code == 200
    assert r.content == b""


def test_assets_are_static_and_immutable(client: TestClient) -> None:
    r = client.get("/assets/index-abc123.js")
    assert r.status_code == 200
    assert r.text == APP_JS
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_assets_revalidate_with_etag(client: TestClient) -> None:
    etag = client.get("/assets/index-abc123.js").headers["etag"]
    r = client.get("/assets/index-abc123.js", headers={"If-None-Match": etag})
    assert r.status_code == 304


def test_missing_asset_is_404_not_index(client: TestClient) -> None:
    r = client.get("/assets/index-deadbeef.js")
    assert r.status_code == 404
    assert r.text != INDEX_HTML


def test_other_real_files_are_served(client: TestClient) -> None:
    assert client.get("/favicon.svg").text == "<svg/>"
    r = client.get("/samples/room1-01.jpg")
    assert r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "no-cache"


def test_model_files_get_gltf_mime_type_and_gzip(client: TestClient) -> None:
    r = client.get("/models/room1/model.glb", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "model/gltf-binary"
    assert r.headers.get("content-encoding") == "gzip"
    assert r.content.startswith(b"glTF")


def test_gzip_for_text_assets(client: TestClient) -> None:
    r = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.text == APP_JS  # client decodes transparently


def test_api_routes_win(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "DELETE"])
@pytest.mark.parametrize("path", ["/api", "/api/", "/api/nope", "/api/projects/room1/extra/deep",
                                  "/api/projects/..%2f..%2fetc"])
def test_unknown_api_paths_never_fall_back(client: TestClient, method: str, path: str) -> None:
    r = client.request(method, path)
    assert r.status_code == 404
    assert r.headers["content-type"] == "application/json"
    assert r.json() == {"detail": "Not Found"}


def test_wrong_method_on_known_api_path_is_json_404(client: TestClient) -> None:
    # The SPA mount fully matches every path, so it beats the router's 405.
    r = client.get("/api/check")
    assert r.status_code == 404
    assert r.headers["content-type"] == "application/json"


def test_non_get_on_client_route_is_405(client: TestClient) -> None:
    assert client.post("/a/room1/A1").status_code == 405


@pytest.mark.parametrize(
    "raw_path",
    ["/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt"],
)
def test_no_path_traversal(client: TestClient, raw_path: str) -> None:
    r = client.get(raw_path)
    assert "outside dist" not in r.text


def test_api_only_when_no_static_dir(tmp_path: Path, models: Path) -> None:
    app = create_app(Settings(static_dir=tmp_path / "missing", models_dir=models), store=InMemoryStore())
    c = TestClient(app)
    assert c.get("/api/health").status_code == 200
    assert c.get("/").status_code == 404


def test_usdz_is_served_with_the_ar_quick_look_type(client, dist) -> None:
    (dist / "models").mkdir(exist_ok=True)
    (dist / "models" / "rooftop.usdz").write_bytes(b"PK\x03\x04usdz")
    r = client.get("/models/rooftop.usdz")
    assert r.status_code == 200 and r.headers["content-type"].startswith("model/vnd.usdz+zip")
