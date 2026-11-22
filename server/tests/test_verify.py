"""verify.py: the close-up second look (crops, which marks, how a verdict changes a mark) and make_checker's switch."""
from __future__ import annotations

import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app import verify
from app.fake_gemini import FakeGeminiClient
from app.gemini_client import CHECK_SYSTEM
from app.projects import ProjectRepo
from app.schemas import CheckContext
from app.services import make_checker

from .conftest import GUID_DOOR, GUID_WALL


def image_bytes(fmt: str, size: tuple[int, int] = (1000, 500)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (90, 120, 150)).save(out, format=fmt)
    return out.getvalue()


JPEG = image_bytes("JPEG")
PNG = image_bytes("PNG")

CTX = CheckContext.model_validate({
    "project_id": "testproj", "anchor_id": "A1", "pose_quality": "good", "distance_m": 6.0,
    "visible": [
        {"mark": 1, "guid": GUID_WALL, "ifc_class": "IfcWall", "name": "Partition P-01", "box": [0, 0, 600, 400]},
        {"mark": 2, "guid": GUID_DOOR, "ifc_class": "IfcDoor", "name": "Door D-01", "box": [100, 450, 900, 700]},
        {"mark": 3, "guid": GUID_WALL, "ifc_class": "IfcMember", "name": "Purlin P1", "box": [100, 100, 120, 600]},
        {"mark": 4, "guid": GUID_DOOR, "ifc_class": "IfcBeam", "name": "Beam far", "box": [500, 500, 530, 560]},
    ],
})


def finding(mark: int, status: str, confidence: float = 0.8) -> dict:
    return {"mark": mark, "status": status, "confidence": confidence, "evidence_box": [0, 0, 0, 0],
            "offset": {"direction": "none", "approx_cm": 0}, "explanation": "first pass"}


def test_crop_centres_on_the_box_and_scales_up_small_regions() -> None:
    crop = Image.open(io.BytesIO(verify.crop_jpeg(JPEG, [400, 400, 600, 600])))
    assert max(crop.size) == verify.CROP_LONG_SIDE
    # box 200 x 100 px, padded by 0.6 x 200 = 120 px each side: 440 x 340 px, kept in proportion
    assert abs(crop.width / crop.height - 440 / 340) < 0.02


def test_crop_stays_inside_the_frame_for_a_box_at_the_edge() -> None:
    crop = Image.open(io.BytesIO(verify.crop_jpeg(PNG, [0, 950, 50, 1000])))
    assert crop.format == "JPEG" and min(crop.size) > 0


def test_quiet_candidates_are_thin_or_small_marks_smallest_first() -> None:
    assert verify.quiet_candidates(CTX) == [4, 3]  # a far beam (0.18% of the frame), then a purlin


@pytest.mark.parametrize("first,verdict,mode,status", [
    ("missing", ("present_ok", 0.9), "both", "present_ok"),  # a false alarm removed
    ("missing", ("present_ok", 0.5), "both", "missing"),  # not sure enough to remove it
    ("missing", ("cannot_judge", 0.9), "both", "missing"),
    ("missing", ("present_ok", 0.9), "upgrade", "missing"),
    ("present_ok", ("missing", 0.9), "both", "missing"),  # a thin member the first pass missed
    ("present_ok", ("missing", 0.7), "both", "present_ok"),
    ("cannot_judge", ("missing", 0.8), "both", "missing"),
    ("present_ok", ("misplaced", 0.9), "both", "present_ok"),  # only an empty outline adds a flag
    ("present_ok", ("missing", 0.9), "downgrade", "present_ok"),
])
def test_merge(first: str, verdict: tuple[str, float], mode: str, status: str) -> None:
    changed, note = verify.merge(finding(1, first), {"status": verdict[0], "confidence": verdict[1],
                                                     "offset": {"direction": "left", "approx_cm": 30}, "explanation": "x"}, mode)
    assert (changed or finding(1, first))["status"] == status
    assert note.startswith(first)
    if changed and status == "present_ok":
        assert changed["offset"] == {"direction": "none", "approx_cm": 0}


class Scripted:
    """First pass from `first`; each verify call answers from `verdicts` by mark (an Exception is raised)."""

    vertexai = False

    def __init__(self, first: list[dict], verdicts: dict[int, object]) -> None:
        self.verify_calls: list[dict] = []

        def generate_content(*, model, contents, config):
            if config.system_instruction.startswith(CHECK_SYSTEM):
                payload = {"image_quality": "good", "findings": first, "unexpected": [], "summary": "s"}
            else:
                self.verify_calls.append({"contents": contents, "config": config})
                task = json.loads(contents[-1].text.split("\n", 1)[1])
                answer = verdicts[task["mark"]]
                if isinstance(answer, Exception):
                    raise answer
                payload = answer
            usage = SimpleNamespace(prompt_token_count=1000, candidates_token_count=100, thoughts_token_count=0,
                                    total_token_count=1100)
            return SimpleNamespace(text=json.dumps(payload), parsed=None, usage_metadata=usage, model_version="m",
                                   response_id="r", candidates=[], prompt_feedback=None)

        self.models = SimpleNamespace(generate_content=generate_content)


def verdict(status: str, confidence: float = 0.9) -> dict:
    return {"status": status, "confidence": confidence, "offset": {"direction": "none", "approx_cm": 0}, "explanation": "close look"}


def test_checker_with_verify_changes_only_what_the_second_look_is_sure_of(models: Path) -> None:
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    client = Scripted(first, {2: verdict("present_ok"), 3: verdict("missing"), 4: ValueError("boom")})
    result = make_checker(ProjectRepo(models), client, verify=True)(JPEG, PNG, CTX, JPEG)
    by_mark = {f["mark"]: f["status"] for f in result["findings"]}
    assert by_mark == {1: "present_ok", 2: "present_ok", 3: "missing", 4: "present_ok"}
    assert len(client.verify_calls) == 3  # marks 2, 4, 3
    parts = client.verify_calls[0]["contents"]
    images = [p for p in parts if getattr(p, "inline_data", None)]
    assert [p.media_resolution for p in images] == [verify.RENDER_RESOLUTION, verify.RESOLUTION, verify.RESOLUTION]
    assert result["usage"]["prompt_tokens"] == 3000  # the first pass and two answered second looks
    assert any(w.startswith("verify: mark 2") for w in result["warnings"])
    assert any("failed" in w for w in result["warnings"])


def test_checker_without_verify_makes_one_call(models: Path) -> None:
    first = [finding(m, "missing") for m in (1, 2, 3, 4)]
    client = Scripted(first, {})
    result = make_checker(ProjectRepo(models), client)(JPEG, PNG, CTX, JPEG)
    assert client.verify_calls == [] and {f["status"] for f in result["findings"]} == {"missing"}


def test_offline_fake_agrees_with_its_first_pass(models: Path) -> None:
    plain = make_checker(ProjectRepo(models), FakeGeminiClient())(JPEG, PNG, CTX, JPEG)
    second = make_checker(ProjectRepo(models), FakeGeminiClient(), verify=True)(JPEG, PNG, CTX, JPEG)
    assert [f["status"] for f in plain["findings"]] == [f["status"] for f in second["findings"]]
