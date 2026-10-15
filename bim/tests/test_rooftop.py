"""The rooftop frame: element counts, GUID join, geometry on the grid, and the R1 anchor."""
import json
from collections import Counter
from pathlib import Path

import pytest

from truesite_bim import rooftop
from truesite_bim.glb_reader import named_node_bounds


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
    assert anchors == [rooftop.ANCHOR, rooftop.ANCHOR_A4]
    assert anchors[1]["anchor_id"] == "R2" and anchors[1]["qr_size_m"] == 0.16
    assert anchors[0]["position_m"] == [4.5, 4.5, 0.0] and anchors[0]["scale"] == 1.0
    assert json.loads((built / "project.json").read_text())["project_id"] == "rooftop"


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json"])
def test_json_outputs_use_lf_line_endings(built, name):
    # Text-mode writes turn "\n" into "\r\n" on Windows, which would dirty the committed files.
    assert b"\r\n" not in (built / name).read_bytes()
