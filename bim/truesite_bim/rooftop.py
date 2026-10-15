"""Rooftop demo: a 9 x 9 m two-storey concrete frame with rebar cages, at 1:1 around a floor QR code.

  python -m truesite_bim.rooftop --out models/rooftop [--base-url https://<host> --sheets-dir ../web/public/sheets]

- Grid 3 x 3 bays of 3 m (columns on 0, 3, 6, 9 m in X and Y), two storeys of 3.3 m.
- 32 columns (400 x 400), 48 beams (300 x 600, top flush with each level).
- One rebar cage element per column and per beam (IfcReinforcingBar with many bar items):
  columns 8 x T20 verticals + T10 links every 0.5 m; level-2 bars run 1.0 m above the top as
  starter bars (a frame mid-construction); beams 2 + 2 x T16 + T10 links every 0.5 m.
- Anchor R1: a 33 cm QR code flat on the roof at the centre of the middle bay (4.5, 4.5, 0),
  top edge towards +Y. Model Z 0 is the roof surface.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
from reportlab.lib.pagesizes import A2, A4, portrait

from .make_demo_model import Builder
from .pipeline import run as run_pipeline
from .qr_sheets import Sheet, render_sheet

PROJECT_ID = "rooftop"
GRID = [0.0, 3.0, 6.0, 9.0]
LEVELS = [0.0, 3.3, 6.6]
COL = 0.4
BEAM_W, BEAM_D = 0.3, 0.6
STARTER = 1.0
LINK_STEP = 0.5
ANCHOR = {"anchor_id": "R1", "project_id": PROJECT_ID, "qr_size_m": 0.33, "position_m": [4.5, 4.5, 0.0],
          "normal": [0, 0, 1], "up": [0, 1, 0], "scale": 1.0, "label": "Rooftop floor sheet A2 (1:1)"}
# Same spot, A4 with a 16 cm code: for indoor tests, or when A2 printing is not possible (readable to ~3 m).
ANCHOR_A4 = {**ANCHOR, "anchor_id": "R2", "qr_size_m": 0.16, "label": "Rooftop floor sheet A4 (1:1)"}


class Frame:
    def __init__(self) -> None:
        self.b = Builder("mm", project_name="TrueSite Rooftop Frame", guid_prefix=PROJECT_ID)
        b = self.b
        b.storey.Name = "Level 1"
        self.storeys = [b.storey, b.entity("IfcBuildingStorey", "storey-L2", name="Level 2")]
        self.storeys[1].Elevation = b.L(LEVELS[1])
        ifcopenshell.api.aggregate.assign_object(b.f, products=[self.storeys[1]], relating_object=b.building)
        ifcopenshell.api.geometry.edit_object_placement(b.f, product=self.storeys[1])
        self.f = b.f
        self.circle20 = self._circle(0.010)
        self.circle16 = self._circle(0.008)

    # --- low-level geometry: one representation holding many extrusions ---------------------
    def _point(self, x: float, y: float, z: float):
        return self.f.createIfcCartesianPoint((self.b.L(x), self.b.L(y), self.b.L(z)))

    def _circle(self, r: float):
        return self.f.createIfcCircleProfileDef("AREA", None, None, self.b.L(r))

    def _ring(self, x: float, y: float, t: float = 0.01):
        return self.f.createIfcRectangleHollowProfileDef("AREA", None, None, self.b.L(x), self.b.L(y), self.b.L(t), None, None)

    def _extrusion(self, profile, x: float, y: float, z: float, depth: float):
        return self.f.createIfcExtrudedAreaSolid(profile, self.f.createIfcAxis2Placement3D(self._point(x, y, z), None, None),
                                                 self.f.createIfcDirection((0.0, 0.0, 1.0)), self.b.L(depth))

    def _rep(self, items):
        return self.f.createIfcShapeRepresentation(self.b.body, "Body", "SweptSolid", items)

    # --- elements --------------------------------------------------------------------------
    def column(self, gx: int, gy: int, level: int) -> None:
        b = self.b
        x, y, z0 = GRID[gx], GRID[gy], LEVELS[level]
        h = LEVELS[level + 1] - z0
        tag = f"{'ABCD'[gx]}{gy + 1}"
        col = b.entity("IfcColumn", f"column-{tag}-L{level + 1}", name=f"Column {tag} L{level + 1}", predefined_type="COLUMN")
        b.body_rep(col, ifcopenshell.api.geometry.add_profile_representation(
            self.f, context=b.body, profile=b.rect_profile("400x400", COL, COL), depth=h))
        b.place(col, (x, y, z0))
        b.pset(col, "Pset_ColumnCommon", {"LoadBearing": True, "IsExternal": False})
        b.pset(col, "TrueSite_Notes", {"Install": "C40/50 concrete; 8T20 verticals, T10 links @ 500; 40 mm cover",
                                       "Grid": tag, "Level": f"L{level + 1}"})
        b.qto(col, "Qto_ColumnBaseQuantities", {"Length": h})
        b.assign_material(col, "Concrete C40/50", "concrete", (0.72, 0.72, 0.70), transparency=0.4)
        ifcopenshell.api.spatial.assign_container(self.f, products=[col], relating_structure=self.storeys[level])

        # Rebar cage: verticals (level 2 runs on as starter bars) and links, in the column's local frame.
        length = h + (STARTER if level == len(LEVELS) - 2 else 0.6)  # lap into the level above
        c = COL / 2 - 0.05
        items = [self._extrusion(self.circle20, dx, dy, 0.05, length)
                 for dx in (-c, 0.0, c) for dy in (-c, 0.0, c) if (dx, dy) != (0.0, 0.0)]
        ring = self._ring(COL - 0.08, COL - 0.08)
        z = 0.1
        while z < h - 0.05:
            items.append(self._extrusion(ring, 0.0, 0.0, z, 0.01))
            z += LINK_STEP
        cage = b.entity("IfcReinforcingBar", f"rebar-{tag}-L{level + 1}", name=f"Rebar cage {tag} L{level + 1}", predefined_type="MAIN")
        b.body_rep(cage, self._rep(items))
        b.place(cage, (x, y, z0))
        b.pset(cage, "TrueSite_Notes", {"Install": "8T20 + T10 @ 500. Inspect cover and lap length before closing the formwork.",
                                        "Grid": tag})
        b.assign_material(cage, "Rebar B500B", "steel", (0.75, 0.18, 0.10))
        ifcopenshell.api.spatial.assign_container(self.f, products=[cage], relating_structure=self.storeys[level])

    def beam(self, axis: str, line: int, span: int, level: int) -> None:
        """axis "x": along X on grid line Y=GRID[line], between X GRID[span] and GRID[span+1]; "y" likewise."""
        b = self.b
        z_top = LEVELS[level + 1]
        a, b_ = GRID[span] + COL / 2, GRID[span + 1] - COL / 2
        length = b_ - a
        if axis == "x":
            origin, x_axis, z_axis = (a, GRID[line], z_top - BEAM_D / 2), (0, 1, 0), (1, 0, 0)
            tag = f"{'ABCD'[span]}{'ABCD'[span + 1]}{line + 1}"
        else:
            origin, x_axis, z_axis = (GRID[line], a, z_top - BEAM_D / 2), (1, 0, 0), (0, 1, 0)
            tag = f"{'ABCD'[line]}{span + 1}{span + 2}"
        key = f"beam-{axis}-{line}-{span}-L{level + 1}"
        beam = b.entity("IfcBeam", key, name=f"Beam {tag} @ {z_top:.1f} m", predefined_type="BEAM")
        b.body_rep(beam, ifcopenshell.api.geometry.add_profile_representation(
            self.f, context=b.body, profile=b.rect_profile("300x600", BEAM_W, BEAM_D), depth=length))
        b.place(beam, origin, x_axis=x_axis, z_axis=z_axis)
        b.pset(beam, "Pset_BeamCommon", {"LoadBearing": True, "IsExternal": False})
        b.pset(beam, "TrueSite_Notes", {"Install": "C40/50 concrete; 2T16 top, 2T16 bottom, T10 links @ 500", "Grid": tag})
        b.qto(beam, "Qto_BeamBaseQuantities", {"Length": length})
        b.assign_material(beam, "Concrete C40/50", "concrete", (0.72, 0.72, 0.70), transparency=0.4)
        ifcopenshell.api.spatial.assign_container(self.f, products=[beam], relating_structure=self.storeys[level])

        # Profile local x = across the beam (300), local y = up (600); bars run along local z.
        cx, cy = BEAM_W / 2 - 0.05, BEAM_D / 2 - 0.05
        items = [self._extrusion(self.circle16, dx, dy, 0.0, length) for dx in (-cx, cx) for dy in (-cy, cy)]
        ring = self._ring(BEAM_W - 0.08, BEAM_D - 0.08)
        z = 0.1
        while z < length - 0.05:
            items.append(self._extrusion(ring, 0.0, 0.0, z, 0.01))
            z += LINK_STEP
        cage = b.entity("IfcReinforcingBar", f"rebar-{key}", name=f"Rebar cage beam {tag} @ {z_top:.1f} m", predefined_type="MAIN")
        b.body_rep(cage, self._rep(items))
        b.place(cage, origin, x_axis=x_axis, z_axis=z_axis)
        b.pset(cage, "TrueSite_Notes", {"Install": "2T16 + 2T16, T10 @ 500. Check bar spacing before the pour.", "Grid": tag})
        b.assign_material(cage, "Rebar B500B", "steel", (0.75, 0.18, 0.10))
        ifcopenshell.api.spatial.assign_container(self.f, products=[cage], relating_structure=self.storeys[level])

    def build(self) -> Builder:
        for level in range(len(LEVELS) - 1):
            for gx in range(len(GRID)):
                for gy in range(len(GRID)):
                    self.column(gx, gy, level)
            for line in range(len(GRID)):
                for span in range(len(GRID) - 1):
                    self.beam("x", line, span, level)
                    self.beam("y", line, span, level)
        return self.b


def r1_sheet() -> Sheet:
    page = portrait(A2)  # 420 x 594 mm
    return Sheet(
        "R1", "floor", ANCHOR["label"], "TrueSite rooftop anchor R1 - life size 1:1", page, 330.0, (210.0, 380.0),
        check_bar_mm=(160.0, 150.0), text_box_mm=(25.0, 120.0),
        position_m=ANCHOR["position_m"], normal=ANCHOR["normal"], up=ANCHOR["up"], scale=1.0,
        instructions=[
            "Print at 100% on matte paper. Tape all four edges flat to the roof.",
            "Lay it at the centre of the clear area, top edge to 'north' (+Y).",
            "Scan, Start camera, start within 1 m, then step back and look around.",
            "A 9 x 9 m two-storey concrete frame with rebar rises around you.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def r2_sheet() -> Sheet:
    return Sheet(
        "R2", "floor", ANCHOR_A4["label"], "TrueSite rooftop anchor R2 (A4) - life size 1:1", portrait(A4), 160.0,
        (105.0, 180.0), check_bar_mm=(55.0, 40.0), text_box_mm=(15.0, 80.0),
        position_m=ANCHOR_A4["position_m"], normal=ANCHOR_A4["normal"], up=ANCHOR_A4["up"], scale=1.0,
        instructions=[
            "Print at 100%. Lay it flat on the floor, top edge to 'north' (+Y).",
            "Scan, Start camera, start within 1 m, then step back and look around.",
            "The rooftop frame (9 x 9 m, two storeys) appears around the sheet.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=Path("models") / PROJECT_ID)
    ap.add_argument("--base-url", help="render the R1 sheet with links to this host")
    ap.add_argument("--sheets-dir", type=Path, default=Path("sheets"))
    a = ap.parse_args(argv)
    a.out.mkdir(parents=True, exist_ok=True)
    ifc = a.out / "model.ifc"
    Frame().build().write(ifc)
    report = run_pipeline(ifc, a.out)
    lf = {"encoding": "utf-8", "newline": "\n"}  # LF on every OS, so Windows runs don't dirty the committed files
    (a.out / "anchors.json").write_text(json.dumps([ANCHOR, ANCHOR_A4], indent=2) + "\n", **lf)
    (a.out / "project.json").write_text(json.dumps({"project_id": PROJECT_ID, "name": "Rooftop frame (2 storeys, 1:1)"}) + "\n", **lf)
    if a.base_url:
        base = a.base_url.rstrip("/")
        info = [render_sheet(sh, f"{base}/a/{PROJECT_ID}/{sh.anchor_id}", a.sheets_dir / f"{PROJECT_ID}-{sh.anchor_id}.pdf")
                for sh in (r1_sheet(), r2_sheet())]
        report = {"pipeline": report, "sheets": info}
    print(json.dumps(report, indent=2, default=str)[:1500])


if __name__ == "__main__":
    main()
