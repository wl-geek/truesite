"""Upload limits on a stand-in route (POST /api/check itself arrives in Part 3)."""
from __future__ import annotations

from typing import Annotated

import pytest
from fastapi import FastAPI, File, UploadFile
from fastapi.testclient import TestClient

from app.config import MiB
from app.uploads import BodySizeLimitMiddleware, read_image

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64  # magic bytes are all read_image checks
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def upload_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=9 * MiB)

    @app.post("/upload")
    async def upload(photo: Annotated[UploadFile, File()], render: Annotated[UploadFile, File()]) -> dict[str, int]:
        p = await read_image(photo, field="photo", kind="jpeg", limit=4 * MiB)
        r = await read_image(render, field="render", kind="png", limit=4 * MiB)
        return {"photo": len(p), "render": len(r)}

    return TestClient(app)


def files(photo: bytes = JPEG, render: bytes = PNG) -> dict:
    return {"photo": ("photo.jpg", photo, "image/jpeg"), "render": ("render.png", render, "image/png")}


def test_happy_path(upload_client: TestClient) -> None:
    r = upload_client.post("/upload", files=files())
    assert r.status_code == 200 and r.json() == {"photo": len(JPEG), "render": len(PNG)}


def test_photo_over_4mib_is_413(upload_client: TestClient) -> None:
    r = upload_client.post("/upload", files=files(photo=JPEG + b"\x00" * (4 * MiB)))
    assert r.status_code == 413 and "photo" in r.json()["detail"]


def test_render_over_4mib_is_413(upload_client: TestClient) -> None:
    r = upload_client.post("/upload", files=files(render=PNG + b"\x00" * (4 * MiB)))
    assert r.status_code == 413 and "render" in r.json()["detail"]


def test_exactly_4mib_is_accepted(upload_client: TestClient) -> None:
    exact = JPEG + b"\x00" * (4 * MiB - len(JPEG))
    assert upload_client.post("/upload", files=files(photo=exact)).status_code == 200


def test_whole_body_cap_rejects_on_content_length(upload_client: TestClient) -> None:
    near = b"\x00" * (4 * MiB + 600 * 1024)  # 2 x 4.6 MiB > 9 MiB body cap
    r = upload_client.post("/upload", files=files(photo=JPEG + near, render=PNG + near))
    assert r.status_code == 413 and "Request body" in r.json()["detail"]


def test_whole_body_cap_rejects_chunked_body_without_content_length(upload_client: TestClient) -> None:
    boundary = "x-boundary-123"
    payload = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"p.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode() + JPEG + b"\x00" * (10 * MiB) + f"\r\n--{boundary}--\r\n".encode()

    def chunks():
        for i in range(0, len(payload), 256 * 1024):
            yield payload[i : i + 256 * 1024]

    r = upload_client.post("/upload", content=chunks(),
                           headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 413
    assert r.request.headers.get("content-length") is None  # really was chunked


def test_invalid_content_length_is_400(upload_client: TestClient) -> None:
    r = upload_client.post("/upload", content=b"x", headers={"Content-Length": "abc"})
    assert r.status_code == 400


def test_wrong_image_type_is_415(upload_client: TestClient) -> None:
    assert upload_client.post("/upload", files=files(photo=PNG)).status_code == 415
    assert upload_client.post("/upload", files=files(render=JPEG)).status_code == 415
