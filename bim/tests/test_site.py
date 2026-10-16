"""The site steel frame: element counts, GUID join, ground level, clearance around the code, and the S anchors."""
import json
import math
from collections import Counter
from pathlib import Path

import pytest

from truesite_bim import site
from truesite_bim.glb_reader import named_node_bounds
from truesite_bim.qr_sheets import anchor_entry

BASE = "https://truesite-7x2k3m4n5q-as.a.run.app"
COMMITTED = Path(__file__).resolve().parents[1] / "models" / site.PROJECT_ID


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("site")
    site.main(["--out", str(out)])
    return out


@pytest.fixture(scope="module")
def els(built) -> list[dict]:
    return json.loads((built / "elements.json").read_text(encoding="utf-8"))


def footprint_distance(bbox, x: float, y: float) -> float:
    """Horizontal distance from (x, y) to an element's plan footprint (0 when the point is inside it)."""
    (x0, y0, _), (x1, y1, _) = bbox
    return math.hypot(max(x0 - x, 0.0, x - x1), max(y0 - y, 0.0, y - y1))


def test_counts_and_guid_join(built, els):
    assert Counter(e["ifc_class"] for e in els) == {
        "IfcColumn": 8, "IfcFooting": 8, "IfcBeam": 6, "IfcMember": 117, "IfcReinforcingBar": 14}
    members = Counter(e["props"]["PredefinedType"] for e in els if e["ifc_class"] == "IfcMember")
    assert members == {"CHORD": 12, "MEMBER": 68, "PURLIN": 21, "BRACE": 16}
    assert len(els) < 250
    assert set(named_node_bounds(built / "model.glb")) == {e["guid"] for e in els}


def test_names_follow_the_grid(els):
    names = {e["name"] for e in els}
    assert {"Column A1", "Column D2", "Pad footing A1", "Starter bars A1", "Edge beam A1-B1",
            "Truss T2 bottom chord", "Truss T2 diagonal 3", "Purlin P4 B-C", "Tie beam cage A1-B1"} <= names
    assert len(names) == len(els)  # every name is unique, so Ask and the findings can name an element
    assert sum("TrueSite_Notes.Install" in e["props"] for e in els) >= 5


def test_columns_only_on_the_long_sides(els):
    centres = sorted((round((e["bbox_m"][0][0] + e["bbox_m"][1][0]) / 2, 2), round((e["bbox_m"][0][1] + e["bbox_m"][1][1]) / 2, 2))
                     for e in els if e["ifc_class"] == "IfcColumn")
    assert centres == sorted((x, y) for x in (0.0, 6.0, 12.0, 18.0) for y in (0.0, 12.0))
    col = next(e for e in els if e["name"] == "Column B1")
    assert col["bbox_m"][1][2] == pytest.approx(site.EAVES)  # column tops carry the trusses at the eaves height


def test_nothing_below_the_ground(built, els):
    # Quick Look and the AR modes put model Z 0 on the real ground: nothing may sink into it.
    assert min(e["bbox_m"][0][2] for e in els) == 0.0
    glb_min_up = min(lo[1] for lo, _ in named_node_bounds(built / "model.glb").values())  # glTF Y = IFC Z
    assert glb_min_up == pytest.approx(0.0, abs=1e-4)
    for e in els:
        if e["ifc_class"] == "IfcFooting":
            assert e["bbox_m"][0][2] == 0.0 and e["bbox_m"][1][2] <= 0.03  # pad top flush with the ground


def test_starter_bars_stick_up_about_a_metre(els):
    starters = [e for e in els if e["name"].startswith("Starter bars")]
    assert len(starters) == 8
    assert all(e["bbox_m"][1][2] == pytest.approx(1.0, abs=0.02) for e in starters)
    cages = [e for e in els if e["name"].startswith("Tie beam cage")]
    assert len(cages) == 6 and all(e["bbox_m"][0][2] >= 0.0 for e in cages)


def test_nothing_close_to_the_code_below_head_height(els):
    # The viewer stands on the code at the floor centre: keep 2.5 m clear around it up to 4 m.
    x, y = site.ANCHOR["position_m"][:2]
    for e in els:
        if e["bbox_m"][0][2] < 4.0:
            assert footprint_distance(e["bbox_m"], x, y) > 2.5, e["name"]


def test_bounding_box(els):
    lo = [min(e["bbox_m"][0][i] for e in els) for i in range(3)]
    hi = [max(e["bbox_m"][1][i] for e in els) for i in range(3)]
    assert lo[0] == pytest.approx(-0.8, abs=0.01) and hi[0] == pytest.approx(18.8, abs=0.01)  # pad footings
    assert lo[1] == pytest.approx(-0.8, abs=0.01) and hi[1] == pytest.approx(12.8, abs=0.01)
    assert 7.5 < hi[2] < 9.0  # ridge purlins


def test_anchors_and_project(built):
    anchors = json.loads((built / "anchors.json").read_text(encoding="utf-8"))
    assert anchors == site.ANCHORS
    assert [a["anchor_id"] for a in anchors] == ["S1", "S2", "S3", "D1"]
    for a in anchors:
        n, u = a["normal"], a["up"]
        assert math.isclose(math.hypot(*n), 1.0) and math.isclose(math.hypot(*u), 1.0)
        assert sum(p * q for p, q in zip(n, u)) == 0
    floor, upright, desk = anchors[0], anchors[2], anchors[3]
    assert floor["position_m"] == [9.0, 6.0, 0.0] and floor["normal"] == [0, 0, 1] and floor["scale"] == 1.0
    assert anchors[0]["qr_size_m"] == 0.23 and anchors[1]["qr_size_m"] == 0.16
    # S3: upright, code at 1.3 m, 2 m south of the centre, facing north to the viewer
    assert upright["position_m"] == [9.0, 4.0, 1.3] and upright["normal"] == [0, 1, 0] and upright["up"] == [0, 0, 1]
    # D1: 1:100 desk sheet; model (0, 0) sits 235 mm left and 60 mm below the code centre on the page
    assert desk["scale"] == 0.01 and desk["position_m"] == [23.5, 6.0, 0.0] and desk["qr_size_m"] == 0.07
    assert json.loads((built / "project.json").read_text(encoding="utf-8")) == {"project_id": "site", "name": "Steel frame (1:1)"}


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json"])
def test_json_outputs_use_lf_line_endings(built, name):
    assert b"\r\n" not in (built / name).read_bytes()


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json"])
def test_committed_files_match_a_fresh_build(built, name):
    # The server serves bim/models/site: a change to site.py must be rebuilt and committed with it.
    assert (COMMITTED / name).read_bytes() == (built / name).read_bytes()


def test_committed_glb_has_the_fresh_build_guids(built):
    assert set(named_node_bounds(COMMITTED / "model.glb")) == set(named_node_bounds(built / "model.glb"))


def test_sheets_match_the_anchors():
    assert [anchor_entry(sh, site.PROJECT_ID) for sh in (site.s1_sheet(), site.s2_sheet())] == [site.ANCHOR, site.ANCHOR_A4]


def test_sheets_only_renders_the_sheets_and_leaves_the_model_alone(tmp_path, capsys):
    out, sheets = tmp_path / "model", tmp_path / "sheets"
    out.mkdir()
    site.main(["--out", str(out), "--base-url", BASE, "--sheets-dir", str(sheets), "--sheets-only"])
    assert list(out.iterdir()) == []
    assert sorted(p.name for p in sheets.iterdir()) == ["site-D1.pdf", "site-S1.pdf", "site-S2.pdf", "site-S3.pdf"]
    assert "WARNING" not in capsys.readouterr().err  # the A3 code keeps the full quiet zone for the Cloud Run URL


def test_sheets_only_needs_a_base_url(tmp_path):
    with pytest.raises(SystemExit):
        site.main(["--out", str(tmp_path / "model"), "--sheets-only"])
    assert not (tmp_path / "model").exists()
