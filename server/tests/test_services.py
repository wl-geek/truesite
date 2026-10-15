"""services.py: the Gemini error mapping (contract section 6) and what make_checker sends."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.fake_gemini import FakeGeminiClient
from app.gemini_client import GeminiError
from app.projects import ProjectRepo
from app.schemas import CheckContext
from app.services import http_error_for, make_checker

from .conftest import GUID_DOOR, GUID_WALL, JPEG, PNG


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


class Recorder:
    """The offline fake, plus a record of every request."""

    vertexai = False

    def __init__(self) -> None:
        self.calls: list[dict] = []
        fake = FakeGeminiClient()

        def generate_content(**kwargs):
            self.calls.append(kwargs)
            return fake.models.generate_content(**kwargs)

        self.models = SimpleNamespace(generate_content=generate_content)


CTX = CheckContext.model_validate({
    "project_id": "testproj", "anchor_id": "A1", "pose_quality": "good", "distance_m": 1.5,
    "visible": [{"mark": 1, "guid": GUID_WALL, "ifc_class": "IfcWall", "name": "Partition P-01", "box": [0, 0, 600, 400]},
                {"mark": 2, "guid": GUID_DOOR, "ifc_class": "IfcDoor", "name": "Door D-01", "box": [100, 450, 900, 700]}],
})


def sent_task(client: Recorder) -> dict:
    text = client.calls[0]["contents"][-1].text
    return json.loads(text.split("\n", 1)[1].split("\n\n")[0])


def test_checker_sends_the_projects_check_note(models: Path) -> None:
    (models / "testproj" / "project.json").write_text(
        json.dumps({"project_id": "testproj", "name": "Test project", "check_note": "Setting-out check."}))
    client = Recorder()
    result = make_checker(ProjectRepo(models), client)(JPEG, PNG, CTX)
    assert sent_task(client)["project_note"] == "Setting-out check."
    assert [f["mark"] for f in result["findings"]] == [1, 2]


def test_checker_sends_no_note_when_the_project_has_none(models: Path) -> None:
    client = Recorder()
    make_checker(ProjectRepo(models), client)(JPEG, PNG, CTX)
    assert "project_note" not in sent_task(client)
