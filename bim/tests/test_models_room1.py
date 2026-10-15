"""The committed demo project bim/models/room1: in sync, GUID-joined, and in the contract's shapes.

These tests fail on purpose when the model is replaced (e.g. by Aung Nyein Chan's IFC) and
demo_issues.json still points at the old GUIDs. See "Rebuilding room1" in the plan.
"""
import json
import math
import re
from pathlib import Path

import pytest

from truesite_bim import convert, qr_sheets
from truesite_bim.glb_reader import positions, read_glb

ROOM1 = Path(__file__).resolve().parents[1] / "models" / "room1"
GUID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")
ISSUE_IN_FIELDS = {"project_id", "guid", "finding_ref", "run_id", "title", "description", "suggested_action",
                   "severity", "crop_box"}


def load(name):
    return json.loads((ROOM1 / name).read_text(encoding="utf-8"))


def test_all_project_files_exist():
    names = {p.name for p in ROOM1.iterdir()}
    assert {"model.ifc", "model.glb", "elements.json", "anchors.json", "project.json", "demo_issues.json"} <= names


def _primitive_surfaces(j, b):
    """(vertex positions, surface area) per primitive. Equal for the same mesh even when the
    tessellator picks different diagonals, as IfcOpenShell does on Windows vs macOS."""
    out = []
    for mesh in j["meshes"]:
        for prim in mesh["primitives"]:
            pos = positions(j, b, prim["attributes"]["POSITION"])
            idx = [i for (i,) in positions(j, b, prim["indices"])]
            area = 0.0
            for k in range(0, len(idx), 3):
                p, q, r = (pos[i] for i in idx[k : k + 3])
                u = [q[a] - p[a] for a in range(3)]
                v = [r[a] - p[a] for a in range(3)]
                area += math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
            out.append((pos, area))
    return out


def test_committed_glb_is_a_fresh_conversion_of_the_committed_ifc(tmp_path):
    fresh = convert.convert(ROOM1 / "model.ifc", tmp_path / "model.glb")
    if fresh.read_bytes() == (ROOM1 / "model.glb").read_bytes():
        return  # byte-identical on the platform that built it
    jf, bf = read_glb(fresh)
    jc, bc = read_glb(ROOM1 / "model.glb")
    assert jf == jc, "re-run the pipeline (see the plan)"
    for (pf, af), (pc, ac) in zip(_primitive_surfaces(jf, bf), _primitive_surfaces(jc, bc), strict=True):
        assert pf == pc, "re-run the pipeline (see the plan)"
        assert math.isclose(af, ac, rel_tol=1e-9), "re-run the pipeline (see the plan)"


def test_glb_guids_equal_elements_guids():
    j, _ = read_glb(ROOM1 / "model.glb")
    elements = load("elements.json")
    assert sorted(n["name"] for n in j["nodes"]) == sorted(e["guid"] for e in elements)


def test_elements_json_shape():
    elements = load("elements.json")
    assert isinstance(elements, list) and elements
    for e in elements:
        assert set(e) == {"guid", "ifc_class", "name", "storey", "bbox_m", "load_bearing", "props"}
        assert GUID_RE.match(e["guid"]) and e["ifc_class"].startswith("Ifc")
        assert isinstance(e["name"], str) and isinstance(e["storey"], str)
        lo, hi = e["bbox_m"]
        assert len(lo) == len(hi) == 3 and all(a <= b for a, b in zip(lo, hi))
        assert e["load_bearing"] in (True, False, None)
        assert isinstance(e["props"], dict)


def test_anchors_json_matches_the_sheets_and_is_orthonormal():
    anchors = load("anchors.json")
    assert anchors == [qr_sheets.anchor_entry(sh, "room1") for sh in qr_sheets.make_sheets()]
    for a in anchors:
        n, u = a["normal"], a["up"]
        assert math.isclose(math.hypot(*n), 1.0) and math.isclose(math.hypot(*u), 1.0)
        assert abs(sum(x * y for x, y in zip(n, u))) < 1e-9
        assert a["qr_size_m"] > 0 and a["scale"] > 0 and len(a["position_m"]) == 3


def test_project_json():
    assert load("project.json") == {"project_id": "room1", "name": "Demo room"}


def test_demo_issues_reference_real_elements():
    guids = {e["guid"] for e in load("elements.json")}
    issues = load("demo_issues.json")
    assert len(issues) == 2
    for issue in issues:
        assert set(issue) <= ISSUE_IN_FIELDS and {"project_id", "guid", "title"} <= set(issue)
        assert issue["project_id"] == "room1"
        assert issue["guid"] in guids, f"demo issue {issue['title']!r} points at a GUID not in elements.json"
        assert 1 <= len(issue["title"]) <= 120 and len(issue["description"]) <= 2000
        assert len(issue["suggested_action"]) <= 600
        assert issue["severity"] in ("high", "medium", "low", None)


@pytest.mark.parametrize("name", ["elements.json", "anchors.json", "project.json", "demo_issues.json"])
def test_json_files_end_with_a_newline(name):
    assert (ROOM1 / name).read_text(encoding="utf-8").endswith("\n")
