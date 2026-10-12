"""IFC authoring -> glb: GUID node names, metres, Y-up.

The fixed IFC -> glTF mapping these tests pin:   glTF (x, y, z) = IFC (X, Z, -Y)
(a -90 degree rotation about X; three.js: new Matrix4().makeRotationX(-Math.PI / 2)).
"""
import re

import ifcopenshell
import pytest

from truesite_bim import convert, make_demo_model
from truesite_bim.glb_reader import named_node_bounds, node_world_matrices, positions, read_glb

GUID_RE = re.compile(r"^[0-9A-Za-z_$]{22}$")
TOL = 1e-4
ROOM_KEYS = ["wall-S", "wall-N", "wall-W", "wall-E", "slab", "column-C1", "door-D1", "window-WN1", "sleeve-S104"]


def ifc_to_gltf(p):
    X, Y, Z = p
    return (X, Z, -Y)


@pytest.mark.parametrize("units", ["m", "mm"])
def test_glb_node_names_are_the_element_guids(built, units):
    _, glb = built[("room", units)]
    j, _ = read_glb(glb)
    names = [n["name"] for n in j["nodes"]]
    assert len(names) == len(set(names)) == 9  # 4 walls, slab, column, door, window, sleeve
    assert all(GUID_RE.match(n) for n in names)
    assert set(names) == {make_demo_model.det_guid(f"room1/{k}") for k in ROOM_KEYS}


def test_glb_is_flat_and_guid_is_on_the_mesh_node(built):
    _, glb = built[("room", "mm")]
    j, _ = read_glb(glb)
    assert j["scenes"][j.get("scene", 0)]["nodes"] == list(range(len(j["nodes"])))  # all roots
    for n in j["nodes"]:
        assert "mesh" in n and "children" not in n


def test_guids_are_deterministic():
    def guids(f):
        return sorted(e.GlobalId for e in f.by_type("IfcRoot") if e.is_a("IfcProduct") or e.is_a("IfcProject"))

    assert guids(make_demo_model.build_room("m").f) == guids(make_demo_model.build_room("mm").f)
    cube = make_demo_model.build_ref_cube("mm").f.by_type("IfcBuildingElementProxy")[0]
    assert cube.GlobalId == make_demo_model.det_guid("refcube/REF-CUBE")
    assert make_demo_model.det_guid("room1/door-D1") == make_demo_model.det_guid("room1/door-D1")
    assert make_demo_model.det_guid("room1/door-D1") != make_demo_model.det_guid("room1/door-D2")


def test_build_room_defaults_to_millimetres():
    assert make_demo_model.build_room().scale == pytest.approx(0.001)


@pytest.mark.parametrize("units", ["m", "mm"])
def test_reference_cube_is_one_metre_and_y_up(built, units):
    _, glb = built[("cube", units)]
    lo, hi = named_node_bounds(glb)[make_demo_model.det_guid("refcube/REF-CUBE")]
    assert [round(h - l, 6) for l, h in zip(lo, hi)] == [1.0, 1.0, 1.0]
    # IFC min corner (2.0, 1.0, 0.5), max (3.0, 2.0, 1.5)  ->  glTF x 2..3, y 0.5..1.5 (up), z -2..-1
    assert lo == pytest.approx((2.0, 0.5, -2.0), abs=TOL)
    assert hi == pytest.approx((3.0, 1.5, -1.0), abs=TOL)


def test_axis_mapping_matrix_is_rotation_minus_90_about_x(built):
    _, glb = built[("cube", "mm")]
    j, _ = read_glb(glb)
    (m,) = node_world_matrices(j).values()
    rot = [v for row in m[:3] for v in row[:3]]
    assert rot == pytest.approx([1, 0, 0, 0, 0, 1, 0, -1, 0], abs=1e-12)  # rows: x=X, y=Z, z=-Y
    # the cube's placement (centre of its base) is IFC (2.5, 1.5, 0.5)
    assert [m[i][3] for i in range(3)] == pytest.approx(list(ifc_to_gltf((2.5, 1.5, 0.5))))


@pytest.mark.parametrize("kind", ["room", "cube"])
def test_metre_and_millimetre_projects_give_identical_glbs(built, kind):
    m_glb, mm_glb = built[(kind, "m")][1], built[(kind, "mm")][1]
    bm, bmm = named_node_bounds(m_glb), named_node_bounds(mm_glb)
    assert bm.keys() == bmm.keys()
    for k in bm:
        assert bm[k][0] == pytest.approx(bmm[k][0], abs=1e-6)
        assert bm[k][1] == pytest.approx(bmm[k][1], abs=1e-6)


def mesh_volume(glb, guid):
    """Volume of the closed triangle mesh on a node, world space (divergence theorem)."""
    j, b = read_glb(glb)
    world = node_world_matrices(j)
    (i,) = [k for k, n in enumerate(j["nodes"]) if n["name"] == guid]
    m, vol = world[i], 0.0
    for prim in j["meshes"][j["nodes"][i]["mesh"]]["primitives"]:
        pts = [tuple(sum(m[r][c] * p[c] for c in range(3)) + m[r][3] for r in range(3))
               for p in positions(j, b, prim["attributes"]["POSITION"])]
        idx = [t[0] for t in positions(j, b, prim["indices"])]
        for a, c, d in zip(idx[0::3], idx[1::3], idx[2::3]):
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = pts[a], pts[c], pts[d]
            vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    return abs(vol)


def test_openings_are_cut_in_the_glb(built):
    _, glb = built[("room", "mm")]
    g = make_demo_model.det_guid
    assert mesh_volume(glb, g("room1/wall-S")) == pytest.approx(4 * 0.1 * 2.7 - 0.9 * 0.1 * 2.1, abs=1e-4)
    assert mesh_volume(glb, g("room1/wall-N")) == pytest.approx(4 * 0.1 * 2.7 - 1.2 * 0.1 * 1.2, abs=1e-4)
    assert mesh_volume(glb, g("room1/column-C1")) == pytest.approx(0.3 * 0.3 * 2.7, abs=1e-6)


def test_openings_and_spaces_are_excluded(built):
    ifc, glb = built[("room", "mm")]
    openings = {o.GlobalId for o in ifcopenshell.open(str(ifc)).by_type("IfcOpeningElement")}
    assert len(openings) == 3
    j, _ = read_glb(glb)
    assert not openings & {n["name"] for n in j["nodes"]}


def test_glb_is_byte_deterministic(built, tmp_path):
    ifc, glb = built[("room", "mm")]
    again = convert.convert(ifc, tmp_path / "again.glb")  # single-threaded iterator: stable element order
    assert again == tmp_path / "again.glb"
    assert again.read_bytes() == glb.read_bytes()


def test_convert_cli(built, tmp_path, capsys):
    ifc, glb = built[("cube", "mm")]
    convert.main([str(ifc), str(tmp_path / "cli.glb")])
    assert (tmp_path / "cli.glb").read_bytes() == glb.read_bytes()
    assert "1 elements" in capsys.readouterr().out
