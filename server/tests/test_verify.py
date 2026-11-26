"""verify.py: the close-up second look (crops, which marks, how a verdict changes a mark) and make_checker's switch."""
from __future__ import annotations

import io
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app import verify
from app.config import VerifySettings
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
    ("missing", ("misplaced", 0.9), "both", "cannot_judge"),  # the looks disagree on what is wrong
    ("misplaced", ("misplaced", 0.9), "both", "misplaced"),
    ("different_from_design", ("missing", 0.9), "both", "different_from_design"),
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
    if changed and status in ("present_ok", "cannot_judge"):
        assert changed["offset"] == {"direction": "none", "approx_cm": 0}


class Scripted:
    """First pass from `first`; each verify call answers from `verdicts` by mark (an Exception is raised), after
    `delay_s`; `most_at_once` is the most verify calls that were running at the same time."""

    vertexai = False

    def __init__(self, first: list[dict], verdicts: dict[int, object], *, delay_s: float = 0.0) -> None:
        self.verify_calls: list[dict] = []
        self.at_once = self.most_at_once = 0
        lock = threading.Lock()

        def generate_content(*, model, contents, config):
            if config.system_instruction.startswith(CHECK_SYSTEM):
                payload = {"image_quality": "good", "findings": first, "unexpected": [], "summary": "s"}
            else:
                with lock:
                    self.verify_calls.append({"model": model, "contents": contents, "config": config})
                    self.at_once += 1
                    self.most_at_once = max(self.most_at_once, self.at_once)
                time.sleep(delay_s)
                with lock:
                    self.at_once -= 1
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


def test_decode_reads_only_jpeg_and_png() -> None:
    assert verify.decode(JPEG).mode == verify.decode(PNG).mode == "RGB"
    with pytest.raises(Exception):  # a GIF (or anything else) is never decoded, whatever its size claims
        verify.decode(image_bytes("GIF"))


def test_each_image_is_decoded_once_per_check_however_many_close_ups(models: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Each close-up used to decode the photo, render and outline image again, in up to 24 threads at once: about
    # 440 MB for one check of 4 MP images. Now the three images are decoded once and every crop is cut from them.
    opened: list[int] = []
    real = Image.open

    def counting_open(*args, **kwargs):
        opened.append(1)
        return real(*args, **kwargs)
    monkeypatch.setattr(verify.Image, "open", counting_open)
    first = [finding(m, "missing") for m in (1, 2, 3, 4)]
    client = Scripted(first, {m: verdict("missing") for m in (1, 2, 3, 4)})
    make_checker(ProjectRepo(models), client, verify=True)(JPEG, PNG, CTX, JPEG)
    assert len(client.verify_calls) == 4
    assert len(opened) == 3


def test_close_ups_at_once_never_exceed_the_workers(models: Path) -> None:
    first = [finding(m, "missing") for m in (1, 2, 3, 4)]
    client = Scripted(first, {m: verdict("missing") for m in (1, 2, 3, 4)}, delay_s=0.05)
    verify.checked(lambda: first_pass(client), JPEG, PNG, JPEG, CTX, client=client, settings=VerifySettings(workers=2))
    assert len(client.verify_calls) == 4 and client.most_at_once == 2


def first_pass(client: "Scripted") -> dict:
    from app import gemini_client
    return gemini_client.check_asbuilt(JPEG, PNG, CTX.model_dump(mode="json"), overlay_jpeg=JPEG, client=client)


def test_settings_choose_the_close_up_model_timeout_and_photo_resolution() -> None:
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    verdicts = {2: verdict("misplaced"), 3: verdict("present_ok"), 4: verdict("present_ok")}
    client = Scripted(first, verdicts)
    verify.checked(lambda: first_pass(client), JPEG, PNG, JPEG, CTX, client=client,
                   settings=VerifySettings(model="gemini-3.6-flash", photo_resolution="medium", timeout_ms=9000))
    assert {c["model"] for c in client.verify_calls} == {"gemini-3.6-flash"}
    assert {c["config"].http_options.timeout for c in client.verify_calls} == {9000}
    images = [p for p in client.verify_calls[0]["contents"] if getattr(p, "inline_data", None)]
    assert [p.media_resolution for p in images] == [verify.RENDER_RESOLUTION] * 3
    client = Scripted(first, verdicts)
    verify.checked(lambda: first_pass(client), JPEG, PNG, JPEG, CTX, client=client, settings=VerifySettings())
    assert {c["model"] for c in client.verify_calls} == {verify.gemini_client.MODEL_ID}


def test_the_last_note_says_where_the_time_went(models: Path) -> None:
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    client = Scripted(first, {2: verdict("present_ok"), 3: verdict("missing"), 4: ValueError("boom")})
    result = make_checker(ProjectRepo(models), client, verify=True)(JPEG, PNG, CTX, JPEG)
    note = result["warnings"][-1]
    assert note.startswith("verify: timing ")
    timing = json.loads(note.removeprefix("verify: timing "))
    assert (timing["quiet"], timing["late"], timing["failed"], timing["unfinished"]) == (2, 1, 1, 0)
    assert {"model", "first_pass_s", "tail_s", "slowest_call_s", "crop_cpu_s", "cpu_s", "total_s"} <= set(timing)


def test_once_the_first_pass_answers_the_second_look_waits_only_its_grace(models: Path) -> None:
    # One close-up in seven ran into Gemini's own deadline (about 11 s) and held the whole check for it. Now a close-up
    # not back within the grace leaves its mark as the first pass said, and the check answers.
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    client = Scripted(first, {2: verdict("present_ok"), 3: verdict("present_ok"), 4: verdict("present_ok")})
    real = client.models.generate_content

    def mark_2_hangs(*, model, contents, config):
        if not config.system_instruction.startswith(CHECK_SYSTEM) and '"mark": 2' in contents[-1].text:
            time.sleep(1.0)
        return real(model=model, contents=contents, config=config)
    client.models.generate_content = mark_2_hangs
    started = time.monotonic()
    out, _usage, notes = verify.checked(lambda: first_pass(client), JPEG, PNG, JPEG, CTX, client=client,
                                        settings=VerifySettings(grace_ms=200))
    assert time.monotonic() - started < 0.8
    assert {f["mark"]: f["status"] for f in out["result"]["findings"]}[2] == "misplaced"  # as the first pass said
    assert "verify: mark 2 ran out of time" in notes
    assert json.loads(notes[-1].removeprefix("verify: timing "))["unfinished"] == 1


def test_verify_settings_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    names = ("VERIFY_MODEL", "VERIFY_TIMEOUT_MS", "VERIFY_GRACE_MS", "VERIFY_MAX_QUIET", "VERIFY_MAX_LATE", "VERIFY_WORKERS",
             "VERIFY_PHOTO_RESOLUTION")
    for name in names:
        monkeypatch.delenv(name, raising=False)
    assert VerifySettings.from_env() == VerifySettings()
    for name, value in zip(names, ("gemini-3.6-flash", "9000", "-1", "8", "6", "0", "medium")):
        monkeypatch.setenv(name, value)
    assert VerifySettings.from_env() == VerifySettings(model="gemini-3.6-flash", timeout_ms=9000, grace_ms=0, max_quiet=8,
                                                       max_late=6, workers=1, photo_resolution="medium")
    monkeypatch.setenv("VERIFY_PHOTO_RESOLUTION", "ultra")
    with pytest.raises(ValueError):
        VerifySettings.from_env()


def test_an_image_that_cannot_be_decoded_skips_the_second_look(models: Path) -> None:
    # A truncated JPEG passes upload validation (its header still gives a size), then fails to decode here.
    truncated = image_bytes("JPEG", (400, 300))
    truncated = truncated[: len(truncated) // 2]
    with pytest.raises(Exception):
        verify.decode(truncated)
    stub = {"result": {"findings": [finding(1, "misplaced")]}, "usage": {"total_tokens": 7}}
    out, usage, notes = verify.checked(lambda: stub, truncated, PNG, JPEG, CTX, client=None)
    assert out is stub
    assert usage == {"prompt_tokens": 0, "output_tokens": 0, "thought_tokens": 0, "total_tokens": 0, "cost_usd_est": 0.0}
    assert notes == ["verify: skipped, an image could not be decoded"]


def test_the_first_look_is_handed_over_while_the_close_ups_settle(models: Path) -> None:
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    client = Scripted(first, {2: verdict("present_ok"), 3: verdict("missing"), 4: verdict("present_ok")})
    looks: list[tuple[dict, list[int]]] = []
    result = make_checker(ProjectRepo(models), client, verify=True)(JPEG, PNG, CTX, JPEG,
                                                                    on_first_look=lambda r, p: looks.append((r, p)))
    assert len(looks) == 1
    look, pending = looks[0]
    assert pending == [2, 3, 4]  # the thin and small marks, then the flagged one
    assert {f["mark"]: f["status"] for f in look["findings"]}[2] == "misplaced"  # as the first pass said, repaired
    assert {f["mark"]: f["severity"] for f in look["findings"]}[2] is not None
    assert not any(w.startswith("verify:") for w in look["warnings"])
    assert {f["mark"]: f["status"] for f in result["findings"]}[2] == "present_ok"  # the final answer still settles it


def test_a_failing_first_look_handover_does_not_cost_the_check(models: Path) -> None:
    first = [finding(1, "present_ok"), finding(2, "misplaced"), finding(3, "present_ok"), finding(4, "present_ok")]
    client = Scripted(first, {2: verdict("present_ok"), 3: verdict("present_ok"), 4: verdict("present_ok")})

    def boom(_result: dict, _pending: list[int]) -> None:
        raise RuntimeError("the page went away")
    result = make_checker(ProjectRepo(models), client, verify=True)(JPEG, PNG, CTX, JPEG, on_first_look=boom)
    assert {f["mark"]: f["status"] for f in result["findings"]}[2] == "present_ok"


def test_without_the_second_look_there_is_no_early_first_look(models: Path) -> None:
    client = Scripted([finding(m, "missing") for m in (1, 2, 3, 4)], {})
    looks: list[object] = []
    make_checker(ProjectRepo(models), client)(JPEG, PNG, CTX, JPEG, on_first_look=lambda r, p: looks.append(r))
    assert looks == []
