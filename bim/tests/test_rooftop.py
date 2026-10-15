"""The rooftop frame: element counts, GUID join, geometry on the grid, and the R1 anchor."""
import json
from collections import Counter
from pathlib import Path

import pytest

from truesite_bim import rooftop
from truesite_bim.glb_reader import named_node_bounds
from truesite_bim.qr_sheets import anchor_entry

BASE = "https://truesite-7x2k3m4n5q-as.a.run.app"
COMMITTED = Path(__file__).resolve().parents[1] / "models" / rooftop.PROJECT_ID


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("rooftop")
    rooftop.main(["--out", str(out)])
    return out


def test_counts_and_guid_join(built):
    els = json.loads((built / "elements.json").read_text())
    assert Counter(e["ifc_class"] for e in els) == {"IfcColumn": 32, "IfcBeam": 48, "IfcReinforcingBar": 80}
    assert set(named_node_bounds(built / "model.glb")) == {e["guid"] for e in els}


def test_frame_geometry(built):
    els = {e["name"]: e for e in json.loads((built / "elements.json").read_text())}
    assert els["Column B2 L2"]["bbox_m"] == [[2.8, 2.8, 3.3], [3.2, 3.2, 6.6]]
    top = max(e["bbox_m"][1][2] for e in els.values())
    assert top == pytest.approx(6.6 + 1.0 + 0.05, abs=0.02)  # level-2 starter bars stick out 1 m
    assert els["Column A1 L1"]["load_bearing"] is True


def test_anchor_and_project(built):
    anchors = json.loads((built / "anchors.json").read_text())
    assert anchors == [rooftop.ANCHOR, rooftop.ANCHOR_A4, *rooftop.VIEW_ANCHORS]
    assert [a["anchor_id"] for a in anchors] == ["R1", "R2", "V1", "V2", "V3"]
    assert anchors[1]["anchor_id"] == "R2" and anchors[1]["qr_size_m"] == 0.16
    assert anchors[0]["position_m"] == [4.5, 4.5, 0.0] and anchors[0]["scale"] == 1.0
    project = json.loads((built / "project.json").read_text())
    assert project["project_id"] == "rooftop"
    # The server adds this note to every check prompt for the project (setting-out demo, audit A-27).
    assert project["check_note"] == rooftop.CHECK_NOTE and "Setting-out check" in rooftop.CHECK_NOTE
    committed = Path(__file__).resolve().parents[1] / "models" / "rooftop" / "project.json"
    assert json.loads(committed.read_text(encoding="utf-8")) == project


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json"])
def test_json_outputs_use_lf_line_endings(built, name):
    # Text-mode writes turn "\n" into "\r\n" on Windows, which would dirty the committed files.
    assert b"\r\n" not in (built / name).read_bytes()


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json"])
def test_committed_files_match_a_fresh_build(built, name):
    # The server serves bim/models/rooftop: a change to rooftop.py must be rebuilt and committed with it.
    assert (COMMITTED / name).read_bytes() == (built / name).read_bytes()


def test_committed_glb_has_the_fresh_build_guids(built):
    assert set(named_node_bounds(COMMITTED / "model.glb")) == set(named_node_bounds(built / "model.glb"))


def test_sheets_match_the_anchors(monkeypatch):
    sheets = [rooftop.r1_sheet(), rooftop.r2_sheet(), *rooftop.view_sheets()]
    assert [anchor_entry(sh, rooftop.PROJECT_ID) for sh in sheets] == [rooftop.ANCHOR, rooftop.ANCHOR_A4, *rooftop.VIEW_ANCHORS]
    # The printed code size follows the anchor row instead of a second hard-coded number.
    monkeypatch.setitem(rooftop.ANCHOR, "qr_size_m", 0.3)
    assert rooftop.r1_sheet().qr_mm == 300.0


def test_sheets_only_renders_the_sheets_and_leaves_the_model_alone(tmp_path):
    out, sheets = tmp_path / "model", tmp_path / "sheets"
    out.mkdir()
    (out / "anchors.json").write_bytes(b"committed\n")
    rooftop.main(["--out", str(out), "--base-url", BASE, "--sheets-dir", str(sheets), "--sheets-only"])
    assert [p.name for p in out.iterdir()] == ["anchors.json"]
    assert (out / "anchors.json").read_bytes() == b"committed\n"
    assert sorted(p.name for p in sheets.iterdir()) == [f"rooftop-{a}.pdf" for a in ("R1", "R2", "V1", "V2", "V3")]


def test_sheets_only_needs_a_base_url(tmp_path):
    with pytest.raises(SystemExit):
        rooftop.main(["--out", str(tmp_path / "model"), "--sheets-only"])
    assert not (tmp_path / "model").exists()


def test_quiet_zone_warning_goes_to_stderr(tmp_path, capsys):
    # A LAN URL gives a version-3 code: R1's 33 cm code then has only about 3.95 modules of paper around it.
    rooftop.main(["--base-url", "https://192.168.1.23:5173", "--sheets-dir", str(tmp_path), "--sheets-only"])
    out, err = capsys.readouterr()
    assert "WARNING R1" in err and "WARNING" not in out


def test_base_url_must_be_https(tmp_path):
    with pytest.raises(SystemExit):
        rooftop.main(["--out", str(tmp_path / "model"), "--base-url", "http://192.168.1.23:5173",
                      "--sheets-dir", str(tmp_path / "sheets")])
    assert not (tmp_path / "model").exists() and not (tmp_path / "sheets").exists()
