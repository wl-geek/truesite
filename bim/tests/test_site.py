"""The site building: element counts, GUID join, storey heights, ground level, clear standing spots, and the P anchors."""
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
        "IfcColumn": 20, "IfcFooting": 12, "IfcBeam": 23, "IfcMember": 117, "IfcReinforcingBar": 13, "IfcRailing": 4, "IfcSlab": 2}
    members = Counter(e["props"]["PredefinedType"] for e in els if e["ifc_class"] == "IfcMember")
    assert members == {"CHORD": 12, "MEMBER": 68, "PURLIN": 21, "BRACE": 16}
    assert len(els) < 250
    assert set(named_node_bounds(built / "model.glb")) == {e["guid"] for e in els}


def test_names_follow_the_grid(els):
    names = {e["name"] for e in els}
    assert {"RC column A1", "RC column B2", "Column cage B2", "Steel column D3", "Pad footing A1", "Beam A1-B1", "Beam A1-A2",
            "Slab L1 A-B", "Slab L1 B-C", "Slab mat L1 C-D", "Edge protection south", "Edge beam A1-B1",
            "Truss T2 bottom chord", "Truss T2 diagonal 3", "Purlin P4 B-C"} <= names
    assert len(names) == len(els)  # every name is unique, so Ask and the findings can name an element
    assert sum("TrueSite_Notes.Install" in e["props"] for e in els) >= 8


def test_spacious_for_a_six_foot_person(els):
    by = {e["name"]: e for e in els}
    six_ft = 1.83
    soffit = min(e["bbox_m"][0][2] for e in els if e["ifc_class"] in ("IfcBeam", "IfcSlab") and e["bbox_m"][0][2] < site.EAVES - 1)
    assert soffit == pytest.approx(3.9, abs=0.01) and soffit > 2 * six_ft  # ground storey: over twice head height
    assert by["Slab L1 A-B"]["bbox_m"][1][2] == pytest.approx(site.L1)
    assert by["Steel column A1"]["bbox_m"][0][2] == pytest.approx(site.L1) and by["Steel column A1"]["bbox_m"][1][2] == pytest.approx(site.EAVES)
    assert 10.0 < max(e["bbox_m"][1][2] for e in els) < 11.0  # ridge purlins
    rc = sorted((round((e["bbox_m"][0][0] + e["bbox_m"][1][0]) / 2, 2), round((e["bbox_m"][0][1] + e["bbox_m"][1][1]) / 2, 2))
                for e in els if e["name"].startswith("RC column"))
    assert rc == sorted((x, y) for x in site.GRID_X for y in site.GRID_Y)  # 6 m bays both ways


def test_open_bay_is_not_cast(els):
    slabs = [e for e in els if e["ifc_class"] == "IfcSlab"]
    assert max(e["bbox_m"][1][0] for e in slabs) == pytest.approx(site.CAST_TO_X)
    mat = next(e for e in els if e["name"] == "Slab mat L1 C-D")
    assert mat["bbox_m"][0][0] == pytest.approx(site.CAST_TO_X, abs=0.02) and mat["bbox_m"][1][0] == pytest.approx(18.0, abs=0.02)


def test_nothing_below_the_ground(built, els):
    # The AR modes put model Z 0 on the real ground: nothing may sink into it.
    assert min(e["bbox_m"][0][2] for e in els) == 0.0
    glb_min_up = min(lo[1] for lo, _ in named_node_bounds(built / "model.glb").values())  # glTF Y = IFC Z
    assert glb_min_up == pytest.approx(0.0, abs=1e-4)
    for e in els:
        if e["ifc_class"] == "IfcFooting":
            assert e["bbox_m"][0][2] == 0.0 and e["bbox_m"][1][2] <= 0.03  # pad top flush with the ground


@pytest.mark.parametrize("vid", ["P1", "P2", "P3", "P4"])
def test_standing_spots_and_codes_are_clear(els, vid):
    _, stand, _, _ = next(v for v in site.VIEWPOINTS if v[0] == vid)
    code = next(a for a in site.ANCHORS if a["anchor_id"] == vid)["position_m"]
    for e in els:
        if e["bbox_m"][0][2] < 3.5:  # anything at head height or below
            assert footprint_distance(e["bbox_m"], *stand) > 2.5, (vid, e["name"])
            assert footprint_distance(e["bbox_m"], code[0], code[1]) > 1.5, (vid, e["name"])


def test_bounding_box(els):
    lo = [min(e["bbox_m"][0][i] for e in els) for i in range(3)]
    hi = [max(e["bbox_m"][1][i] for e in els) for i in range(3)]
    assert lo[0] == pytest.approx(-0.9, abs=0.01) and hi[0] == pytest.approx(18.9, abs=0.01)  # pad footings
    assert lo[1] == pytest.approx(-0.9, abs=0.01) and hi[1] == pytest.approx(12.9, abs=0.01)


def test_anchors_and_project(built):
    anchors = json.loads((built / "anchors.json").read_text(encoding="utf-8"))
    assert anchors == site.ANCHORS
    assert [a["anchor_id"] for a in anchors] == ["P1", "P2", "P3", "P4", "D1"]
    for a in anchors:
        n, u = a["normal"], a["up"]
        assert math.isclose(math.hypot(*n), 1.0) and math.isclose(math.hypot(*u), 1.0)
        assert sum(p * q for p, q in zip(n, u)) == 0
    for (vid, stand, look, _), a in zip(site.VIEWPOINTS, anchors):
        x, y, z = a["position_m"]
        assert a["anchor_id"] == vid and a["qr_size_m"] == 0.23 and a["scale"] == 1.0
        assert z == 1.4 and a["up"] == [0, 0, 1] and a["normal"][2] == 0  # upright, code centre at chest height
        # the printed face looks at the standing spot, 1.5 m in front of it
        assert [x + 1.5 * a["normal"][0], y + 1.5 * a["normal"][1]] == pytest.approx(list(stand))
    assert anchors[0]["position_m"] == [9.0, -2.5, 1.4] and anchors[0]["normal"] == [0, -1, 0]
    desk = anchors[4]
    assert desk["scale"] == 0.01 and desk["position_m"] == [23.5, 6.0, 0.0] and desk["qr_size_m"] == 0.07
    assert json.loads((built / "project.json").read_text(encoding="utf-8")) == {
        "project_id": "site", "name": "Building under construction (1:1)", "check_note": site.CHECK_NOTE}


def test_tape_distances():
    d = {(p, q): v for p, q, v in site.tape_distances()}
    assert len(d) == 6
    assert d[("P1", "P2")] == pytest.approx(math.hypot(4.5, 5.5), abs=0.01)
    assert d[("P3", "P4")] == pytest.approx(math.hypot(7.0, 3.0), abs=0.01)


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
    assert [anchor_entry(sh, site.PROJECT_ID) for sh in site.sheets()] == site.ANCHORS


def test_sheets_only_renders_the_sheets_and_leaves_the_model_alone(tmp_path, capsys):
    out, sheets = tmp_path / "model", tmp_path / "sheets"
    out.mkdir()
    site.main(["--out", str(out), "--base-url", BASE, "--sheets-dir", str(sheets), "--sheets-only"])
    assert list(out.iterdir()) == []
    assert sorted(p.name for p in sheets.iterdir()) == [
        "site-D1.pdf", "site-P1.pdf", "site-P2.pdf", "site-P3.pdf", "site-P4.pdf", "site-layout.pdf"]
    assert "WARNING" not in capsys.readouterr().err  # the A3 code keeps the full quiet zone for the Cloud Run URL


def test_sheets_only_needs_a_base_url(tmp_path):
    with pytest.raises(SystemExit):
        site.main(["--out", str(tmp_path / "model"), "--sheets-only"])
    assert not (tmp_path / "model").exists()
