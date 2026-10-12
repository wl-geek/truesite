"""Author the TrueSite scripted fallback model (IFC4) with ifcopenshell.api.

Room 1: outer footprint 4.0 x 3.0 m (X x Y), 2.7 m high, on storey "Level 1".
  - 4 walls, 0.1 m thick, inside the footprint (Pset_WallCommon LoadBearing + FireRating)
  - floor slab 4.0 x 3.0 x 0.15 m, top at Z = 0
  - column 0.3 x 0.3 m in the south-west inner corner (load-bearing)
  - door 0.9 x 2.1 m in the south wall (IfcOpeningElement + IfcDoor)
  - window 1.2 x 1.2 m, sill 0.9 m, in the north wall (IfcOpeningElement + IfcWindow)
  - "Sleeve S-104": IfcPipeSegment, 100 mm OD, through the east wall (with a round opening)
  - custom pset "TrueSite_Notes" with an "Install" text on several elements

Also writes a reference-cube test file: one IfcBuildingElementProxy "REF-CUBE",
1 x 1 x 1 m, min corner at (2.0, 1.0, 0.5) m in IFC coordinates (distinct values per
axis, so the IFC -> glTF axis mapping can be read off unambiguously).

All api geometry helpers that take SI (metres) are given metres; the few that take
project units (profile dims, door/window overall sizes, quantities) go through L().
GlobalIds are deterministic: uuid5(namespace, key) compressed to the IFC base64 form.

Usage (from bim/):
  python -m truesite_bim.make_demo_model --out models/room1/model.ifc [--units mm|m]
  python -m truesite_bim.make_demo_model --ref-cube --out /tmp/ref_cube.ifc [--units mm|m]
"""
from __future__ import annotations

import argparse
import uuid
from pathlib import Path

import numpy as np

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.feature
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.profile
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.style
import ifcopenshell.api.unit
import ifcopenshell.guid
import ifcopenshell.util.unit

# Fixed namespace: changing it changes every GUID (and breaks saved anchors/issues).
GUID_NAMESPACE = uuid.UUID("6f1d2a3e-7c1b-4b8e-9a51-727565736974")

ROOM_X, ROOM_Y, ROOM_H, WALL_T = 4.0, 3.0, 2.7, 0.1
REF_CUBE_MIN = (2.0, 1.0, 0.5)  # metres, IFC coordinates (Z up)
REF_CUBE_SIZE = 1.0


def det_guid(key: str) -> str:
    """Deterministic, valid 22-char IFC GlobalId for a stable key."""
    return ifcopenshell.guid.compress(uuid.uuid5(GUID_NAMESPACE, key).hex)


class Builder:
    def __init__(self, units: str, project_name: str, guid_prefix: str):
        self.f = ifcopenshell.api.project.create_file(version="IFC4")
        self.prefix = guid_prefix
        self.project = self.entity("IfcProject", "project", name=project_name)
        # Units. NB: unit.assign_unit(f) with no args defaults to MILLIMETRES for length.
        prefix = "MILLI" if units == "mm" else None
        length = ifcopenshell.api.unit.add_si_unit(self.f, unit_type="LENGTHUNIT", prefix=prefix)
        area = ifcopenshell.api.unit.add_si_unit(self.f, unit_type="AREAUNIT")
        volume = ifcopenshell.api.unit.add_si_unit(self.f, unit_type="VOLUMEUNIT")
        ifcopenshell.api.unit.assign_unit(self.f, units=[length, area, volume])
        self.scale = ifcopenshell.util.unit.calculate_unit_scale(self.f)  # project unit -> metres
        model3d = ifcopenshell.api.context.add_context(self.f, context_type="Model")
        self.body = ifcopenshell.api.context.add_context(
            self.f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model3d
        )
        self.site = self.entity("IfcSite", "site", name="TrueSite Demo Site")
        self.building = self.entity("IfcBuilding", "building", name="Demo Building")
        self.storey = self.entity("IfcBuildingStorey", "storey-L1", name="Level 1")
        self.storey.Elevation = 0.0
        ifcopenshell.api.aggregate.assign_object(self.f, products=[self.site], relating_object=self.project)
        ifcopenshell.api.aggregate.assign_object(self.f, products=[self.building], relating_object=self.site)
        ifcopenshell.api.aggregate.assign_object(self.f, products=[self.storey], relating_object=self.building)
        for p in (self.site, self.building, self.storey):
            ifcopenshell.api.geometry.edit_object_placement(self.f, product=p)
        self._materials: dict[str, ifcopenshell.entity_instance] = {}

    # --- helpers -------------------------------------------------------------
    def L(self, metres: float) -> float:
        """Metres -> project length units (for api calls that take project units)."""
        return metres / self.scale

    def entity(self, ifc_class: str, key: str, name: str | None = None, predefined_type: str | None = None):
        e = ifcopenshell.api.root.create_entity(self.f, ifc_class=ifc_class, name=name, predefined_type=predefined_type)
        e.GlobalId = det_guid(f"{self.prefix}/{key}")  # GlobalId is writable after creation
        return e

    def place(self, product, origin, x_axis=(1.0, 0.0, 0.0), z_axis=(0.0, 0.0, 1.0)):
        """Placement from origin (metres) and local X/Z axes (relative to the storey = world here)."""
        x = np.array(x_axis, float)
        z = np.array(z_axis, float)
        y = np.cross(z, x)
        m = np.identity(4)
        m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, origin
        ifcopenshell.api.geometry.edit_object_placement(self.f, product=product, matrix=m)  # is_si=True

    def contain(self, *products):
        ifcopenshell.api.spatial.assign_container(self.f, products=list(products), relating_structure=self.storey)

    def body_rep(self, product, rep):
        ifcopenshell.api.geometry.assign_representation(self.f, product=product, representation=rep)

    def material(self, name: str, category: str, rgb, transparency: float = 0.0):
        if name not in self._materials:
            mat = ifcopenshell.api.material.add_material(self.f, name=name, category=category)
            style = ifcopenshell.api.style.add_style(self.f, name=name)
            ifcopenshell.api.style.add_surface_style(
                self.f,
                style=style,
                ifc_class="IfcSurfaceStyleShading",
                attributes={
                    "SurfaceColour": {"Name": None, "Red": rgb[0], "Green": rgb[1], "Blue": rgb[2]},
                    "Transparency": transparency,
                },
            )
            ifcopenshell.api.style.assign_material_style(self.f, material=mat, style=style, context=self.body)
            self._materials[name] = mat
        return self._materials[name]

    def assign_material(self, product, name, category, rgb, transparency=0.0):
        mat = self.material(name, category, rgb, transparency)
        ifcopenshell.api.material.assign_material(self.f, products=[product], type="IfcMaterial", material=mat)

    def pset(self, product, name: str, props: dict):
        ps = ifcopenshell.api.pset.add_pset(self.f, product=product, name=name)
        ifcopenshell.api.pset.edit_pset(self.f, pset=ps, properties=props)

    def qto(self, product, name: str, props_si: dict):
        """Quantities given in SI (m, m2, m3); stored in project units as IFC requires."""
        q = ifcopenshell.api.pset.add_qto(self.f, product=product, name=name)
        # Area and volume units are assigned as m2 / m3 in both modes; only lengths convert.
        conv = {k: (v if k.endswith(("Area", "Volume")) else self.L(v)) for k, v in props_si.items()}
        ifcopenshell.api.pset.edit_qto(self.f, qto=q, properties=conv)

    def rect_profile(self, name, x_m, y_m):
        p = ifcopenshell.api.profile.add_parameterized_profile(self.f, ifc_class="IfcRectangleProfileDef")
        p.ProfileName, p.XDim, p.YDim = name, self.L(x_m), self.L(y_m)
        return p

    def write(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.f.write(str(path))


# --- the demo room ------------------------------------------------------------
def build_room(units: str = "mm") -> Builder:
    b = Builder(units, project_name="TrueSite Room 1", guid_prefix="room1")
    f, body = b.f, b.body
    geo = ifcopenshell.api.geometry

    walls = {}
    # (key, name, origin, x_axis, length, load_bearing, fire_rating, external)
    # Wall reps extrude thickness along local +Y, so each wall sits inside the 4.0 x 3.0 footprint.
    wall_specs = [
        ("wall-S", "Wall W-01 South", (0.0, 0.0, 0.0), (1, 0, 0), ROOM_X, True, "60 min", True),
        ("wall-N", "Wall W-02 North", (ROOM_X, ROOM_Y, 0.0), (-1, 0, 0), ROOM_X, True, "60 min", True),
        ("wall-W", "Partition P-01 West", (WALL_T, WALL_T, 0.0), (0, 1, 0), ROOM_Y - 2 * WALL_T, False, "30 min", False),
        ("wall-E", "Partition P-02 East", (ROOM_X - WALL_T, ROOM_Y - WALL_T, 0.0), (0, -1, 0), ROOM_Y - 2 * WALL_T, False, "30 min", False),
    ]
    for key, name, origin, x_axis, length, lb, fr, ext in wall_specs:
        w = b.entity("IfcWall", key, name=name, predefined_type="SOLIDWALL" if lb else "PARTITIONING")
        b.body_rep(w, geo.add_wall_representation(f, context=body, length=length, height=ROOM_H, thickness=WALL_T))
        b.place(w, origin, x_axis=x_axis)
        b.pset(w, "Pset_WallCommon", {"LoadBearing": lb, "FireRating": fr, "IsExternal": ext})
        b.qto(w, "Qto_WallBaseQuantities", {"Length": length, "Width": WALL_T, "Height": ROOM_H})
        if lb:
            b.assign_material(w, "Concrete C30/37", "concrete", (0.78, 0.78, 0.76))
        else:
            b.assign_material(w, "Gypsum board", "gypsum", (0.93, 0.93, 0.90))
        b.contain(w)
        walls[key] = w

    # Floor slab: 0.15 m thick, top face at Z = 0.
    slab = b.entity("IfcSlab", "slab", name="Floor Slab FS-01", predefined_type="FLOOR")
    b.body_rep(slab, geo.add_slab_representation(
        f, context=body, depth=0.15, polyline=[(0, 0), (ROOM_X, 0), (ROOM_X, ROOM_Y), (0, ROOM_Y), (0, 0)]))
    b.place(slab, (0.0, 0.0, -0.15))
    b.pset(slab, "Pset_SlabCommon", {"LoadBearing": True, "IsExternal": False})
    b.qto(slab, "Qto_SlabBaseQuantities", {"Depth": 0.15, "GrossArea": ROOM_X * ROOM_Y})
    b.assign_material(slab, "Concrete C30/37", "concrete", (0.78, 0.78, 0.76))
    b.contain(slab)

    # Column 0.3 x 0.3 m, centred at (0.25, 0.25) -> occupies X,Y 0.1..0.4 (south-west inner corner).
    col = b.entity("IfcColumn", "column-C1", name="Column C-01", predefined_type="COLUMN")
    b.body_rep(col, geo.add_profile_representation(
        f, context=body, profile=b.rect_profile("300x300", 0.3, 0.3), depth=ROOM_H))
    b.place(col, (0.25, 0.25, 0.0))
    b.pset(col, "Pset_ColumnCommon", {"LoadBearing": True, "IsExternal": False})
    b.pset(col, "TrueSite_Notes", {"Install": "Cast with walls; do not core drill without engineer approval"})
    b.qto(col, "Qto_ColumnBaseQuantities", {"Length": ROOM_H})
    b.assign_material(col, "Concrete C30/37", "concrete", (0.78, 0.78, 0.76))
    b.contain(col)

    # Door D-01: 0.9 x 2.1 m opening in the south wall, X 1.0..1.9.
    door_open = b.entity("IfcOpeningElement", "opening-D1", name="Opening D-01", predefined_type="OPENING")
    b.body_rep(door_open, geo.add_wall_representation(f, context=body, length=0.9, height=2.1, thickness=0.3))
    b.place(door_open, (1.0, -0.1, 0.0))
    ifcopenshell.api.feature.add_feature(f, feature=door_open, element=walls["wall-S"])
    door = b.entity("IfcDoor", "door-D1", name="Door D-01", predefined_type="DOOR")
    door.OverallWidth, door.OverallHeight = b.L(0.9), b.L(2.1)
    b.body_rep(door, geo.add_door_representation(  # NB: overall sizes + lining props in PROJECT units
        f, context=body, overall_width=b.L(0.9), overall_height=b.L(2.1),
        operation_type="SINGLE_SWING_LEFT", lining_properties={"LiningDepth": b.L(WALL_T)}))
    b.place(door, (1.0, 0.0, 0.0))
    ifcopenshell.api.feature.add_filling(f, opening=door_open, element=door)
    b.pset(door, "Pset_DoorCommon", {"FireRating": "30 min", "IsExternal": True})
    b.pset(door, "TrueSite_Notes", {"Install": "Hang door after floor finish; check swing clears column"})
    b.assign_material(door, "Timber (oak veneer)", "wood", (0.55, 0.38, 0.22))
    b.contain(door)

    # Window WN-01: 1.2 x 1.2 m, sill 0.9 m, in the north wall, X 2.0..3.2 (wall interior face at Y 2.9).
    win_open = b.entity("IfcOpeningElement", "opening-WN1", name="Opening WN-01", predefined_type="OPENING")
    b.body_rep(win_open, geo.add_wall_representation(f, context=body, length=1.2, height=1.2, thickness=0.3))
    b.place(win_open, (2.0, ROOM_Y - WALL_T - 0.1, 0.9))
    ifcopenshell.api.feature.add_feature(f, feature=win_open, element=walls["wall-N"])
    win = b.entity("IfcWindow", "window-WN1", name="Window WN-01", predefined_type="WINDOW")
    win.OverallWidth, win.OverallHeight = b.L(1.2), b.L(1.2)
    b.body_rep(win, geo.add_window_representation(
        f, context=body, overall_width=b.L(1.2), overall_height=b.L(1.2), partition_type="SINGLE_PANEL",
        # api defaults put the window 50 mm proud of its placement; keep it inside the 100 mm wall
        lining_properties={"LiningDepth": b.L(0.05), "LiningOffset": b.L(0.025), "LiningToPanelOffsetY": 0.0}))
    b.place(win, (2.0, ROOM_Y - WALL_T, 0.9))
    ifcopenshell.api.feature.add_filling(f, opening=win_open, element=win)
    b.pset(win, "Pset_WindowCommon", {"IsExternal": True})
    b.assign_material(win, "Aluminium frame + glass", "glass", (0.55, 0.75, 0.90), transparency=0.3)
    b.contain(win)

    # Sleeve S-104: 100 mm OD x 5 mm wall tube, 0.2 m long, through the east wall
    # (wall X 3.9..4.0) at Y 1.5, Z 0.6 -> tube X 3.85..4.05. IfcPipeSegment, not a proxy:
    # it renders like any element, and the class maps to "services" (severity medium).
    sleeve_open = b.entity("IfcOpeningElement", "opening-S104", name="Opening S-104", predefined_type="OPENING")
    hole = ifcopenshell.api.profile.add_parameterized_profile(f, ifc_class="IfcCircleProfileDef")
    hole.ProfileName, hole.Radius = "D100", b.L(0.05)
    b.body_rep(sleeve_open, geo.add_profile_representation(f, context=body, profile=hole, depth=0.3))
    b.place(sleeve_open, (ROOM_X - 0.25, 1.5, 0.6), x_axis=(0, 1, 0), z_axis=(1, 0, 0))
    ifcopenshell.api.feature.add_feature(f, feature=sleeve_open, element=walls["wall-E"])
    sleeve = b.entity("IfcPipeSegment", "sleeve-S104", name="Sleeve S-104", predefined_type="SLEEVE")
    tube = ifcopenshell.api.profile.add_parameterized_profile(f, ifc_class="IfcCircleHollowProfileDef")
    tube.ProfileName, tube.Radius, tube.WallThickness = "D100x5", b.L(0.05), b.L(0.005)
    b.body_rep(sleeve, geo.add_profile_representation(f, context=body, profile=tube, depth=0.2))
    b.place(sleeve, (ROOM_X - 0.15, 1.5, 0.6), x_axis=(0, 1, 0), z_axis=(1, 0, 0))
    ifcopenshell.api.feature.add_filling(f, opening=sleeve_open, element=sleeve)
    b.pset(sleeve, "TrueSite_Notes", {"Install": "Sleeve S-104 before boarding", "Service": "Chilled water"})
    b.qto(sleeve, "Qto_PipeSegmentBaseQuantities", {"Length": 0.2, "OuterDiameter": 0.1})
    b.assign_material(sleeve, "uPVC", "plastic", (0.95, 0.55, 0.10))
    b.contain(sleeve)
    return b


def build_ref_cube(units: str = "mm") -> Builder:
    b = Builder(units, project_name="TrueSite Reference Cube", guid_prefix="refcube")
    cube = b.entity("IfcBuildingElementProxy", "REF-CUBE", name="REF-CUBE")
    # Rectangle profile is centred on the placement (cardinal point 5); extrude +Z by 1 m.
    rep = ifcopenshell.api.geometry.add_profile_representation(
        b.f, context=b.body, profile=b.rect_profile("1000x1000", REF_CUBE_SIZE, REF_CUBE_SIZE), depth=REF_CUBE_SIZE)
    b.body_rep(cube, rep)
    x0, y0, z0 = REF_CUBE_MIN
    b.place(cube, (x0 + REF_CUBE_SIZE / 2, y0 + REF_CUBE_SIZE / 2, z0))
    b.assign_material(cube, "Reference", "test", (1.0, 0.0, 0.5))
    b.contain(cube)
    return b


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--units", choices=["mm", "m"], default="mm")  # mm like Revit/ArchiCAD exports
    ap.add_argument("--ref-cube", action="store_true", help="write the 1 m reference-cube test file instead")
    a = ap.parse_args(argv)
    b = build_ref_cube(a.units) if a.ref_cube else build_room(a.units)
    b.write(a.out)
    print(f"wrote {a.out} ({a.units}, unit scale {b.scale})")


if __name__ == "__main__":
    main()
