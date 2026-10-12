"""elements.json extraction and the one-shot pipeline (IFC -> model.glb + elements.json, GUID join)."""
import json
import re

import pytest

from truesite_bim import extract_elements, make_demo_model, pipeline
from truesite_bim.glb_reader import named_node_bounds, read_glb

GUID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")
ELEMENT_KEYS = {"guid", "ifc_class", "name", "storey", "bbox_m", "load_bearing", "props"}


def ifc_bbox_to_gltf(b):
    (x0, y0, z0), (x1, y1, z1) = b
    return (x0, z0, -y1), (x1, z1, -y0)


@pytest.fixture(scope="module")
def elements(built):
    """{(kind, units): elements.json rows} for the conftest builds."""
    return {key: extract_elements.extract(ifc) for key, (ifc, _) in built.items()}


def by_name(els):
    return {e["name"]: e for e in els}


@pytest.mark.parametrize("units", ["m", "mm"])
def test_glb_node_guids_equal_elements_json_guids(built, elements, units):
    _, glb = built[("room", units)]
    j, _ = read_glb(glb)
    assert {n["name"] for n in j["nodes"]} == {e["guid"] for e in elements[("room", units)]}
    assert len(elements[("room", units)]) == 9


def test_reference_cube_elements_json_is_ifc_metres_z_up(elements):
    for units in ("m", "mm"):
        (e,) = elements[("cube", units)]
        assert e["guid"] == make_demo_model.det_guid("refcube/REF-CUBE")
        assert e["name"] == "REF-CUBE" and e["ifc_class"] == "IfcBuildingElementProxy"
        assert e["bbox_m"] == [[2.0, 1.0, 0.5], [3.0, 2.0, 1.5]]


@pytest.mark.parametrize("units", ["m", "mm"])
def test_every_element_glb_bounds_match_elements_json_after_axis_mapping(built, elements, units):
    bounds = named_node_bounds(built[("room", units)][1])
    for e in elements[("room", units)]:
        lo, hi = ifc_bbox_to_gltf(e["bbox_m"])
        assert bounds[e["guid"]][0] == pytest.approx(lo, abs=1e-3), e["name"]
        assert bounds[e["guid"]][1] == pytest.approx(hi, abs=1e-3), e["name"]


def test_metre_and_millimetre_elements_are_identical(elements):
    assert elements[("room", "m")] == elements[("room", "mm")]


def test_room_bboxes(elements):
    e = by_name(elements[("room", "mm")])
    assert e["Wall W-01 South"]["bbox_m"] == [[0.0, 0.0, 0.0], [4.0, 0.1, 2.7]]
    assert e["Wall W-02 North"]["bbox_m"] == [[0.0, 2.9, 0.0], [4.0, 3.0, 2.7]]
    assert e["Partition P-01 West"]["bbox_m"] == [[0.0, 0.1, 0.0], [0.1, 2.9, 2.7]]
    assert e["Partition P-02 East"]["bbox_m"] == [[3.9, 0.1, 0.0], [4.0, 2.9, 2.7]]
    assert e["Floor Slab FS-01"]["bbox_m"] == [[0.0, 0.0, -0.15], [4.0, 3.0, 0.0]]
    assert e["Column C-01"]["bbox_m"] == [[0.1, 0.1, 0.0], [0.4, 0.4, 2.7]]
    (wx0, wy0, wz0), (wx1, wy1, wz1) = e["Window WN-01"]["bbox_m"]
    assert (wx0, wx1, wz0, wz1) == (2.0, 3.2, 0.9, 2.1) and 2.9 <= wy0 < wy1 <= 3.0
    (sx0, sy0, sz0), (sx1, sy1, sz1) = e["Sleeve S-104"]["bbox_m"]
    assert (sx0, sx1, sy0, sy1) == (3.85, 4.05, 1.45, 1.55)
    assert sz0 == pytest.approx(0.55, abs=0.002) and sz1 == pytest.approx(0.65, abs=0.002)  # tessellated circle


def test_elements_json_contract(elements):
    els = elements[("room", "mm")]
    for e in els:
        assert set(e) == ELEMENT_KEYS
        assert GUID_RE.match(e["guid"]) and e["storey"] == "Level 1" and isinstance(e["name"], str)
        assert e["load_bearing"] in (True, False, None)
        lo, hi = e["bbox_m"]
        assert len(lo) == len(hi) == 3 and all(a <= b for a, b in zip(lo, hi))
        json.dumps(e)  # serialisable
    e = by_name(els)
    for w in ("Wall W-01 South", "Wall W-02 North", "Partition P-01 West", "Partition P-02 East"):
        assert e[w]["ifc_class"] == "IfcWall"
        assert {"Pset_WallCommon.LoadBearing", "Pset_WallCommon.FireRating"} <= e[w]["props"].keys()
        assert e[w]["props"]["Qto_WallBaseQuantities.Width_mm"] == 100
    assert e["Wall W-01 South"]["load_bearing"] is True and e["Partition P-01 West"]["load_bearing"] is False
    assert e["Column C-01"]["load_bearing"] is True and e["Floor Slab FS-01"]["load_bearing"] is True
    assert e["Door D-01"]["load_bearing"] is None  # no pset says
    assert e["Door D-01"]["ifc_class"] == "IfcDoor" and e["Window WN-01"]["ifc_class"] == "IfcWindow"
    s = e["Sleeve S-104"]
    assert s["ifc_class"] == "IfcPipeSegment" and s["props"]["TrueSite_Notes.Install"] == "Sleeve S-104 before boarding"
    assert s["props"]["Qto_PipeSegmentBaseQuantities.OuterDiameter_mm"] == 100
    assert s["props"]["ObjectType"] == "SLEEVE"
    assert len([x for x in els if "TrueSite_Notes.Install" in x["props"]]) >= 2
    assert e["Partition P-01 West"]["props"]["Material"] == "Gypsum board"


def test_pipeline_run_writes_model_dir(built, elements, tmp_path):
    ifc, glb = built[("room", "mm")]
    out = tmp_path / "models" / "room1"
    res = pipeline.run(ifc, out)
    assert res == {"elements": 9, "glb_nodes": 9, "out": str(out)}
    assert {p.name for p in out.iterdir()} == {"model.ifc", "model.glb", "elements.json"}
    assert json.loads((out / "elements.json").read_text()) == elements[("room", "mm")]
    assert (out / "model.glb").read_bytes() == glb.read_bytes()


def test_pipeline_accepts_the_ifc_already_in_place_and_keeps_other_files(built, tmp_path):
    out = tmp_path / "room1"
    out.mkdir()
    (out / "model.ifc").write_bytes(built[("room", "mm")][0].read_bytes())
    (out / "anchors.json").write_text("[]")
    pipeline.run(out / "model.ifc", out)
    assert {p.name for p in out.iterdir()} == {"model.ifc", "model.glb", "elements.json", "anchors.json"}


def test_pipeline_refuses_a_guid_mismatch_and_writes_nothing(built, tmp_path, monkeypatch):
    real_extract = extract_elements.extract
    monkeypatch.setattr(extract_elements, "extract", lambda p: real_extract(p)[:-1])
    out = tmp_path / "room1"
    with pytest.raises(pipeline.GuidMismatch, match="only in glb"):
        pipeline.run(built[("room", "mm")][0], out)
    assert not out.exists() or list(out.iterdir()) == []


def test_pipeline_cli(built, tmp_path, capsys):
    out = tmp_path / "cli"
    pipeline.main([str(built[("cube", "mm")][0]), "--out", str(out)])
    assert json.loads(capsys.readouterr().out) == {"elements": 1, "glb_nodes": 1, "out": str(out)}
