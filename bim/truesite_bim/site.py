"""Site demo: a single-storey steel frame, 18 x 12 m with about 6 m eaves, at 1:1 around a floor QR code.

  python -m truesite_bim.site --out models/site    # rebuild the committed model files
  python -m truesite_bim.site --sheets-only --base-url https://<host> --sheets-dir ../web/public/sheets

Made for walking through it in an open car park with an iPad (AR Quick Look) or Android (Start AR).
- Grid: X lines A-D at 0, 6, 12, 18 m; Y lines 1-2 at 0 and 12 m. Steel I-section columns on the two long sides only.
- 4 duo-pitch roof trusses T1-T4 (one per X line) spanning 12 m on the column caps at 6.0 m: bottom chord, two top
  chords (0.6 m deep at the eaves, 1.5 m rise to the ridge), verticals and diagonals at 1.5 m panels, all IfcMember.
- Purlins along X at the top-chord panel points (one per bay), edge beams along X at the column tops, and
  X-bracing in the two end bays (both long walls and both roof slopes).
- At ground level: pad footings with their top flush with the ground (only the top 20 mm is modelled: the body is
  below ground and left out), rebar starter bars 1 m up around each column, and tie-beam rebar cages between the
  columns along the long sides (not cast yet: the "steel bars").
- Nothing below Z 0, so the model sits on the ground in AR, and nothing within 2.5 m of the code below 4 m, so
  the viewer can stand on the code. Anchor S1: a code flat on the ground at the middle of the floor (9, 6, 0),
  top edge towards +Y.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import ifcopenshell.api.geometry
import ifcopenshell.api.spatial
from reportlab.lib.pagesizes import A3, A4, landscape, portrait

from .make_demo_model import Builder
from .pipeline import run as run_pipeline
from .qr_sheets import ANDROID_STEP, Sheet, https_base_url, render_sheet, warn_thin_quiet_zone
from .rooftop import qr_mm

PROJECT_ID = "site"
GRID_X = [0.0, 6.0, 12.0, 18.0]  # lines A-D
GRID_Y = [0.0, 12.0]  # lines 1-2, the long sides
EAVES = 6.0  # top of the columns = underside of the trusses
COL_W, COL_D, COL_TW, COL_TF = 0.305, 0.31, 0.014, 0.022  # about UC 305 x 305 x 118, depth across the span
EDGE_W, EDGE_D, EDGE_TW, EDGE_TF = 0.165, 0.305, 0.007, 0.011  # about UB 305 x 165 x 40
FOOT, FOOT_T = 1.6, 0.02  # pad footing plan size; modelled thickness (top only)
STARTER, STARTER_OFFSET = 1.0, 0.3
CAGE_W, CAGE_H, LINK_STEP = 0.3, 0.45, 0.2
CHORD, WEB = 0.15, 0.09  # SHS chords and web members
EAVES_DEPTH, RISE, PANEL = 0.6, 1.5, 1.5
PURLIN_D, PURLIN_W = 0.2, 0.075
ROD_R = 0.03  # CHS 60 bracing
SPAN = GRID_Y[1] - GRID_Y[0]
CODE_XY = (9.0, 6.0)

STEEL = ("Steel S355", "steel", (0.42, 0.47, 0.53))
CONCRETE = ("Concrete C30/37", "concrete", (0.72, 0.72, 0.70))
REBAR = ("Rebar B500B", "steel", (0.75, 0.18, 0.10))

# S1: A3 with a 23 cm code (the brief's "about 25 cm"; like qr_sheets' A1, 23 cm keeps the full 4-module quiet
# zone on A3 for the Cloud Run URL). S2: the same spot on A4 with a 16 cm code, when A3 printing is not possible.
ANCHOR = {"anchor_id": "S1", "project_id": PROJECT_ID, "qr_size_m": 0.23, "position_m": [CODE_XY[0], CODE_XY[1], 0.0],
          "normal": [0, 0, 1], "up": [0, 1, 0], "scale": 1.0, "label": "Steel frame floor sheet A3 (1:1)"}
ANCHOR_A4 = {**ANCHOR, "anchor_id": "S2", "qr_size_m": 0.16, "label": "Steel frame floor sheet A4 (1:1)"}
# S3: the same model from an UPRIGHT A3 sheet (on a stand, taped to a pole or car, or held still), code centre
# 1.3 m above the ground at (9, 4), facing north towards the viewer standing at the middle of the floor.
ANCHOR_UPRIGHT = {**ANCHOR, "anchor_id": "S3", "position_m": [CODE_XY[0], CODE_XY[1] - 2.0, 1.3], "normal": [0, 1, 0],
                  "up": [0, 0, 1], "label": "Steel frame upright sheet A3 (1:1), code at 1.3 m"}
# D1: judges' desk sheet, A4 landscape: the frame at 1:100 beside a 70 mm code. Page coordinates (mm, origin
# bottom-left): model (0, 0) at (15, 45), so the 18 x 12 m footprint covers x 15..195, y 45..165; code centre (250, 105).
DESK_SCALE_SITE = 0.01
DESK_ORIGIN_MM = (15.0, 45.0)
DESK_QR_MM = (250.0, 105.0)
ANCHOR_DESK = {"anchor_id": "D1", "project_id": PROJECT_ID, "qr_size_m": 0.07,
               "position_m": [round((DESK_QR_MM[0] - DESK_ORIGIN_MM[0]) / 1000 / DESK_SCALE_SITE, 4),
                              round((DESK_QR_MM[1] - DESK_ORIGIN_MM[1]) / 1000 / DESK_SCALE_SITE, 4), 0.0],
               "normal": [0, 0, 1], "up": [0, 1, 0], "scale": DESK_SCALE_SITE, "label": "Steel frame desk sheet A4 (1:100)"}
ANCHORS = [ANCHOR, ANCHOR_A4, ANCHOR_UPRIGHT, ANCHOR_DESK]
PROJECT = {"project_id": PROJECT_ID, "name": "Steel frame (1:1)"}

WALK_STEP = "iPad/iPhone: scan, stand on the code, point at the ground a step ahead, tap Walk inside."


def top_chord_z(y: float) -> float:
    """Centreline height of the top chord at Y (duo-pitch, ridge at mid-span)."""
    bottom = EAVES + CHORD / 2
    return bottom + EAVES_DEPTH + RISE * (1 - abs(y - SPAN / 2) / (SPAN / 2))


class SteelFrame:
    def __init__(self) -> None:
        self.b = Builder("mm", project_name="TrueSite Steel Frame", guid_prefix=PROJECT_ID)
        self.b.storey.Name = "Ground"
        self.f = self.b.f
        L, f = self.b.L, self.f
        self.col_profile = f.createIfcIShapeProfileDef("AREA", "UC 305x305x118", None, L(COL_W), L(COL_D), L(COL_TW), L(COL_TF),
                                                       None, None, None)
        self.edge_profile = f.createIfcIShapeProfileDef("AREA", "UB 305x165x40", None, L(EDGE_W), L(EDGE_D), L(EDGE_TW), L(EDGE_TF),
                                                        None, None, None)
        self.chord_profile = f.createIfcRectangleHollowProfileDef("AREA", "SHS 150x150x8", None, L(CHORD), L(CHORD), L(0.008), None, None)
        self.web_profile = f.createIfcRectangleHollowProfileDef("AREA", "SHS 90x90x5", None, L(WEB), L(WEB), L(0.005), None, None)
        self.purlin_profile = f.createIfcCShapeProfileDef("AREA", "C200x75x2.5", None, L(PURLIN_D), L(PURLIN_W), L(0.0025), L(0.02), None)
        self.rod_profile = f.createIfcCircleProfileDef("AREA", "CHS 60", None, L(ROD_R))
        self.pad_profile = self.b.rect_profile("1600x1600", FOOT, FOOT)
        self.bar20 = f.createIfcCircleProfileDef("AREA", None, None, L(0.010))
        self.bar16 = f.createIfcCircleProfileDef("AREA", None, None, L(0.008))

    # --- low-level geometry (as in rooftop.py: one representation can hold many extrusions) ---------
    def _point(self, x: float, y: float, z: float):
        return self.f.createIfcCartesianPoint((self.b.L(x), self.b.L(y), self.b.L(z)))

    def _ring(self, x: float, y: float, t: float = 0.01):
        return self.f.createIfcRectangleHollowProfileDef("AREA", None, None, self.b.L(x), self.b.L(y), self.b.L(t), None, None)

    def _extrusion(self, profile, x: float, y: float, z: float, depth: float):
        return self.f.createIfcExtrudedAreaSolid(profile, self.f.createIfcAxis2Placement3D(self._point(x, y, z), None, None),
                                                 self.f.createIfcDirection((0.0, 0.0, 1.0)), self.b.L(depth))

    def _rep(self, items):
        return self.f.createIfcShapeRepresentation(self.b.body, "Body", "SweptSolid", items)

    def _finish(self, e, material, notes: dict | None = None):
        if notes:
            self.b.pset(e, "TrueSite_Notes", notes)
        self.b.assign_material(e, *material, transparency=0.4 if material is CONCRETE else 0.0)
        ifcopenshell.api.spatial.assign_container(self.f, products=[e], relating_structure=self.b.storey)

    def linear(self, ifc_class: str, key: str, name: str, ptype: str, profile, p0, p1, notes: dict | None = None):
        """A straight steel member from p0 to p1 (metres): the profile is extruded along the member axis, with the
        profile's local Y (section depth) vertical for horizontal members and in the truss plane for truss members."""
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = p1 - p0
        length = float(np.linalg.norm(d))
        z = d / length
        x = np.cross((0.0, 0.0, 1.0), z)
        x = np.array((1.0, 0.0, 0.0)) if np.linalg.norm(x) < 1e-9 else x / np.linalg.norm(x)
        e = self.b.entity(ifc_class, key, name=name, predefined_type=ptype)
        self.b.body_rep(e, ifcopenshell.api.geometry.add_profile_representation(self.f, context=self.b.body, profile=profile, depth=length))
        self.b.place(e, tuple(p0), x_axis=tuple(x), z_axis=tuple(z))
        common = {"IfcColumn": "Pset_ColumnCommon", "IfcBeam": "Pset_BeamCommon", "IfcMember": "Pset_MemberCommon"}[ifc_class]
        self.b.pset(e, common, {"LoadBearing": True, "IsExternal": False})
        qto = {"IfcColumn": "Qto_ColumnBaseQuantities", "IfcBeam": "Qto_BeamBaseQuantities", "IfcMember": "Qto_MemberBaseQuantities"}[ifc_class]
        self.b.qto(e, qto, {"Length": length})
        self._finish(e, STEEL, notes)
        return e

    # --- ground level ----------------------------------------------------------------------------
    def column_base(self, gx: int, gy: int) -> None:
        b = self.b
        x, y, tag = GRID_X[gx], GRID_Y[gy], f"{'ABCD'[gx]}{gy + 1}"
        pad = b.entity("IfcFooting", f"footing-{tag}", name=f"Pad footing {tag}", predefined_type="PAD_FOOTING")
        b.body_rep(pad, ifcopenshell.api.geometry.add_profile_representation(self.f, context=b.body, profile=self.pad_profile, depth=FOOT_T))
        b.place(pad, (x, y, 0.0))
        b.pset(pad, "Pset_FootingCommon", {"LoadBearing": True})
        self._finish(pad, CONCRETE, {
            "Install": "Pad 1.6 x 1.6 x 0.6 m, C30/37, top flush with the ground. Only the top is modelled: the body is below ground.",
            "Grid": tag})

        # Starter bars: 8 T20 around the column, 1 m up (for the concrete encasement), with two links.
        o = STARTER_OFFSET
        items = [self._extrusion(self.bar20, dx, dy, 0.0, STARTER) for dx in (-o, 0.0, o) for dy in (-o, 0.0, o) if (dx, dy) != (0.0, 0.0)]
        ring = self._ring(2 * o + 0.04, 2 * o + 0.04)
        items += [self._extrusion(ring, 0.0, 0.0, z, 0.01) for z in (0.35, 0.75)]
        bars = b.entity("IfcReinforcingBar", f"starter-{tag}", name=f"Starter bars {tag}", predefined_type="ANCHORING")
        b.body_rep(bars, self._rep(items))
        b.place(bars, (x, y, 0.0))
        self._finish(bars, REBAR, {"Install": "8 T20 starter bars, 1.0 m above the pad, T10 links. Cap the bar ends until the encasement is cast.",
                                   "Grid": tag})

    def tie_cage(self, gy: int, bay: int) -> None:
        """Rebar cage of the tie beam between two pads along a long side, sitting on the ground (not cast yet)."""
        b = self.b
        a, c = GRID_X[bay] + FOOT / 2, GRID_X[bay + 1] - FOOT / 2
        length, y = c - a, GRID_Y[gy]
        tag = f"{'ABCD'[bay]}{gy + 1}-{'ABCD'[bay + 1]}{gy + 1}"
        # Local frame: x across the beam, y up, z along it (as rooftop's beam cages). Links span Z 0 to CAGE_H.
        cx, cy = CAGE_W / 2 - 0.02, CAGE_H / 2 - 0.025
        items = [self._extrusion(self.bar16, dx, dy, 0.0, length) for dx in (-cx, cx) for dy in (-cy, cy)]
        ring = self._ring(CAGE_W, CAGE_H)
        z = 0.1
        while z < length - 0.05:
            items.append(self._extrusion(ring, 0.0, 0.0, z, 0.01))
            z += LINK_STEP
        cage = b.entity("IfcReinforcingBar", f"tie-cage-{tag}", name=f"Tie beam cage {tag}", predefined_type="MAIN")
        b.body_rep(cage, self._rep(items))
        b.place(cage, (a, y, CAGE_H / 2), x_axis=(0, 1, 0), z_axis=(1, 0, 0))
        self._finish(cage, REBAR, {"Install": "Tie beam 300 x 450, 4 T16 + T10 links @ 200. Not cast yet: check cover and laps before the pour.",
                                   "Grid": tag})

    # --- steel ------------------------------------------------------------------------------------
    def column(self, gx: int, gy: int) -> None:
        x, y, tag = GRID_X[gx], GRID_Y[gy], f"{'ABCD'[gx]}{gy + 1}"
        self.linear("IfcColumn", f"column-{tag}", f"Column {tag}", "COLUMN", self.col_profile, (x, y, FOOT_T), (x, y, EAVES), {
            "Install": "UC 305 x 305 x 118, S355. Base plate on 4 M24 holding-down bolts, 30 mm grout. Plumb before tightening the bracing.",
            "Grid": tag})

    def edge_beam(self, gy: int, bay: int) -> None:
        y = GRID_Y[gy]
        a, c = GRID_X[bay] + COL_W / 2, GRID_X[bay + 1] - COL_W / 2
        tag = f"{'ABCD'[bay]}{gy + 1}-{'ABCD'[bay + 1]}{gy + 1}"
        z = EAVES - EDGE_D / 2  # top flush with the column caps
        self.linear("IfcBeam", f"edge-{tag}", f"Edge beam {tag}", "BEAM", self.edge_profile, (a, y, z), (c, y, z),
                    {"Install": "UB 305 x 165 x 40, S355, bolted to the column caps.", "Grid": tag})

    def truss(self, gx: int) -> None:
        x, t = GRID_X[gx], f"T{gx + 1}"
        zb = EAVES + CHORD / 2
        ys = [i * PANEL for i in range(int(SPAN / PANEL) + 1)]
        bottom = [(x, y, zb) for y in ys]
        top = [(x, y, top_chord_z(y)) for y in ys]
        mid = len(ys) // 2
        notes = {"Install": "Shop-welded truss: SHS 150 chords, SHS 90 web members, bolted to the column caps.", "Truss": t}
        self.linear("IfcMember", f"{t}-bottom", f"Truss {t} bottom chord", "CHORD", self.chord_profile, bottom[0], bottom[-1], notes)
        self.linear("IfcMember", f"{t}-top-s", f"Truss {t} top chord south", "CHORD", self.chord_profile, top[0], top[mid])
        self.linear("IfcMember", f"{t}-top-n", f"Truss {t} top chord north", "CHORD", self.chord_profile, top[mid], top[-1])
        for i in range(len(ys)):
            self.linear("IfcMember", f"{t}-vert-{i}", f"Truss {t} vertical {i + 1}", "MEMBER", self.web_profile, bottom[i], top[i])
        for i in range(len(ys) - 1):  # diagonals slope down towards mid-span
            p0, p1 = (top[i], bottom[i + 1]) if i < mid else (bottom[i], top[i + 1])
            self.linear("IfcMember", f"{t}-diag-{i}", f"Truss {t} diagonal {i + 1}", "MEMBER", self.web_profile, p0, p1)

    def purlins(self) -> None:
        lines = [j * PANEL for j in range(1, int(SPAN / PANEL))]  # every top-chord panel point between the eaves
        for j, y in enumerate(lines, start=1):
            z = top_chord_z(y) + CHORD / 2 + PURLIN_D / 2
            for bay in range(len(GRID_X) - 1):
                tag = f"{'ABCD'[bay]}-{'ABCD'[bay + 1]}"
                notes = {"Install": "Cold-formed C200 x 75 x 2.5 at 1.5 m centres, lapped over the trusses."} if j == 4 else None
                self.linear("IfcMember", f"purlin-{j}-{bay}", f"Purlin P{j} {tag}", "PURLIN", self.purlin_profile,
                            (GRID_X[bay], y, z), (GRID_X[bay + 1], y, z), notes)

    def bracing(self) -> None:
        notes = {"Install": "CHS 60 tension bracing. Tighten after the frame is plumbed."}
        for bay in (0, len(GRID_X) - 2):  # the two end bays
            a, c = GRID_X[bay], GRID_X[bay + 1]
            tag = f"{'ABCD'[bay]}-{'ABCD'[bay + 1]}"
            for gy, side in enumerate(("south", "north")):
                y = GRID_Y[gy]
                self.linear("IfcMember", f"brace-wall-{side}-{bay}-1", f"Brace wall {side} {tag} (1)", "BRACE", self.rod_profile,
                            (a, y, 0.4), (c, y, EAVES - 0.4), notes)
                self.linear("IfcMember", f"brace-wall-{side}-{bay}-2", f"Brace wall {side} {tag} (2)", "BRACE", self.rod_profile,
                            (c, y, 0.4), (a, y, EAVES - 0.4))
                ye, yr = y, SPAN / 2  # eaves and ridge of this roof slope
                self.linear("IfcMember", f"brace-roof-{side}-{bay}-1", f"Brace roof {side} {tag} (1)", "BRACE", self.rod_profile,
                            (a, ye, top_chord_z(ye)), (c, yr, top_chord_z(yr)))
                self.linear("IfcMember", f"brace-roof-{side}-{bay}-2", f"Brace roof {side} {tag} (2)", "BRACE", self.rod_profile,
                            (c, ye, top_chord_z(ye)), (a, yr, top_chord_z(yr)))

    def build(self) -> Builder:
        for gx in range(len(GRID_X)):
            for gy in range(len(GRID_Y)):
                self.column_base(gx, gy)
                self.column(gx, gy)
        for gy in range(len(GRID_Y)):
            for bay in range(len(GRID_X) - 1):
                self.tie_cage(gy, bay)
                self.edge_beam(gy, bay)
        for gx in range(len(GRID_X)):
            self.truss(gx)
        self.purlins()
        self.bracing()
        return self.b


def s1_sheet() -> Sheet:
    return Sheet(
        "S1", "floor", ANCHOR["label"], "TrueSite steel frame anchor S1 - life size 1:1", portrait(A3), qr_mm(ANCHOR), (148.5, 265.0),
        check_bar_mm=(98.5, 98.0), text_box_mm=(20.0, 80.0),
        position_m=ANCHOR["position_m"], normal=ANCHOR["normal"], up=ANCHOR["up"], scale=1.0,
        instructions=[
            "Print at 100% on matte paper. Tape it flat on open ground, top edge to 'north' (+Y).",
            "Clear area: about 20 x 14 m around the sheet (the frame is 18 x 12 m, the sheet at its middle).",
            WALK_STEP,
            ANDROID_STEP,
            "A single-storey steel frame (6 m eaves) stands around you at 1:1. Walk through it.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def s2_sheet() -> Sheet:
    return Sheet(
        "S2", "floor", ANCHOR_A4["label"], "TrueSite steel frame anchor S2 (A4) - life size 1:1", portrait(A4),
        qr_mm(ANCHOR_A4), (105.0, 180.0), check_bar_mm=(55.0, 18.0), text_box_mm=(15.0, 80.0),
        position_m=ANCHOR_A4["position_m"], normal=ANCHOR_A4["normal"], up=ANCHOR_A4["up"], scale=1.0,
        instructions=[
            "Print at 100%. Lay it flat on open ground, top edge to 'north' (+Y).",
            WALK_STEP,
            ANDROID_STEP,
            "The steel frame (18 x 12 m, 6 m eaves) appears around the sheet.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def s3_sheet() -> Sheet:
    return Sheet(
        "S3", "wall", ANCHOR_UPRIGHT["label"], "TrueSite steel frame anchor S3 - upright, life size 1:1", portrait(A3),
        qr_mm(ANCHOR_UPRIGHT), (148.5, 265.0), check_bar_mm=(98.5, 40.0), text_box_mm=(20.0, 120.0),
        position_m=ANCHOR_UPRIGHT["position_m"], normal=ANCHOR_UPRIGHT["normal"], up=ANCHOR_UPRIGHT["up"], scale=1.0,
        instructions=[
            "Keep the sheet UPRIGHT and still, code centre 1.3 m above the ground (a stand or pole is best).",
            "Stand about 2 m in front of it. Android: Start AR, fill the ring, then walk around freely.",
            "iPad: Camera overlay, keep the code in view to lock, then turn on the spot (don't walk).",
            "The steel frame (18 x 12 m) stands around you; the sheet sits 2 m south of its centre.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def d1_sheet() -> Sheet:
    return Sheet(
        "D1", "desk", ANCHOR_DESK["label"], "TrueSite steel frame desk sheet D1 - scale model 1:100", landscape(A4),
        70.0, DESK_QR_MM, check_bar_mm=(200.0, 18.0), text_box_mm=(15.0, 200.0),
        position_m=ANCHOR_DESK["position_m"], normal=ANCHOR_DESK["normal"], up=ANCHOR_DESK["up"], scale=DESK_SCALE_SITE,
        model_origin_mm=DESK_ORIGIN_MM,
        instructions=[
            "Print at 100% and lay it flat on a table in good light. Scan the code, tap Camera overlay.",
            "The 18 x 12 m steel frame appears at 1:100 on the left half of the page.",
        ],
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=Path("models") / PROJECT_ID)
    ap.add_argument("--base-url", type=https_base_url, help="render the S1 and S2 sheets with links to this host")
    ap.add_argument("--sheets-dir", type=Path, default=Path("sheets"))
    ap.add_argument("--sheets-only", action="store_true",
                    help="render the sheets only and leave the model files in --out untouched (needs --base-url)")
    a = ap.parse_args(argv)
    if a.sheets_only and a.base_url is None:
        ap.error("--sheets-only needs --base-url")
    report = None
    if not a.sheets_only:
        a.out.mkdir(parents=True, exist_ok=True)
        ifc = a.out / "model.ifc"
        SteelFrame().build().write(ifc)
        report = run_pipeline(ifc, a.out)
        lf = {"encoding": "utf-8", "newline": "\n"}  # LF on every OS, so Windows runs don't dirty the committed files
        (a.out / "anchors.json").write_text(json.dumps(ANCHORS, indent=2) + "\n", **lf)
        (a.out / "project.json").write_text(json.dumps(PROJECT) + "\n", **lf)
    if a.base_url:
        info = [render_sheet(sh, f"{a.base_url}/a/{PROJECT_ID}/{sh.anchor_id}", a.sheets_dir / f"{PROJECT_ID}-{sh.anchor_id}.pdf")
                for sh in (s1_sheet(), s2_sheet(), s3_sheet(), d1_sheet())]
        for sheet_info in info:
            warn_thin_quiet_zone(sheet_info)
        report = {"pipeline": report, "sheets": info}
    print(json.dumps(report, indent=2, default=str)[:1500])


if __name__ == "__main__":
    main()
