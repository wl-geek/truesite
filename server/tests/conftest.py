from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import InMemoryStore

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64  # magic bytes are all read_image checks
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
INDEX_HTML = "<!doctype html><title>TrueSite</title><div id=root></div>"
APP_JS = "console.log('app');\n" * 200  # > 1 KiB so gzip kicks in
GLB = b"glTF" + b"\x02\x00\x00\x00" + b"\x00" * 2048

GUID_WALL = "2O2Fr$t4X7Zf8NOew3FLOH"
GUID_DOOR = "0K7w7JN$X5TfX$gBMMqb5_"
ELEMENTS = [
    {"guid": GUID_WALL, "ifc_class": "IfcWall", "name": "Partition P-01", "storey": "Level 1",
     "bbox_m": [[0, 0, 0], [3.2, 0.1, 2.7]], "load_bearing": False,
     "props": {"Pset_WallCommon.FireRating": "60 min", "Qto_WallBaseQuantities.Width_mm": 100}},
    {"guid": GUID_DOOR, "ifc_class": "IfcDoor", "name": "Door D-01", "storey": "Level 1",
     "bbox_m": [[1, 0, 0], [1.9, 0.1, 2.1]], "load_bearing": None, "props": {}},
]
ANCHORS = [
    {"anchor_id": "A1", "project_id": "testproj", "qr_size_m": 0.23, "position_m": [2.4, 0.0, 1.2],
     "normal": [0, -1, 0], "up": [0, 0, 1], "scale": 1.0, "label": "Wall"},
    {"anchor_id": "D1", "project_id": "testproj", "qr_size_m": 0.12, "position_m": [2.0, -1.6, -0.15],
     "normal": [0, 0, 1], "up": [0, 1, 0], "scale": 0.05},
]
DEMO_ISSUES = [
    {"project_id": "testproj", "guid": GUID_DOOR, "title": "Door D-01 about 30 cm left of design",
     "description": "Visual check, not a survey.", "suggested_action": "Check on site.", "severity": "medium"},
    {"project_id": "testproj", "guid": GUID_WALL, "title": "Partition P-01 looks thicker than designed"},
]


def write_project(models: Path, project_id: str = "testproj", demo_issues: list | None = DEMO_ISSUES) -> Path:
    d = models / project_id
    d.mkdir(parents=True)
    (d / "project.json").write_text(json.dumps({"project_id": project_id, "name": "Test project"}))
    (d / "elements.json").write_text(json.dumps(ELEMENTS))
    (d / "anchors.json").write_text(json.dumps([{**a, "project_id": project_id} for a in ANCHORS]))
    (d / "model.glb").write_bytes(GLB)
    if demo_issues is not None:
        (d / "demo_issues.json").write_text(json.dumps(demo_issues))
    return d


@pytest.fixture
def models(tmp_path: Path) -> Path:
    m = tmp_path / "models"
    write_project(m)
    return m


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text(INDEX_HTML)
    (d / "assets" / "index-abc123.js").write_bytes(APP_JS.encode())  # bytes: no CRLF on Windows
    (d / "favicon.svg").write_text("<svg/>")
    (d / "samples").mkdir()
    (d / "samples" / "site-01.jpg").write_bytes(JPEG)
    (d / "models" / "site").mkdir(parents=True)
    (d / "models" / "site" / "model.glb").write_bytes(GLB)
    (tmp_path / "secret.txt").write_text("outside dist")
    return d


class Clock:
    def __init__(self) -> None:
        self.mono = 1000.0
        self.wall = datetime(2026, 10, 15, 23, 59, tzinfo=timezone.utc)

    def monotonic(self) -> float:
        return self.mono

    def now(self) -> datetime:
        return self.wall


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore()


@pytest.fixture
def make_client(dist: Path, models: Path, store: InMemoryStore, clock: Clock) -> Callable[..., TestClient]:
    def _make(peer: str = "198.51.100.7", **overrides) -> TestClient:
        settings = replace(Settings(static_dir=dist, models_dir=models), **overrides)
        app = create_app(settings, store=store, now=clock.now, limiter_clock=clock.monotonic)
        return TestClient(app, client=(peer, 50000))

    return _make


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def new_session() -> str:
    return str(uuid.uuid4())
