"""Site demo: a two-storey building under construction, 18 x 12 m, at 1:1 around four upright QR viewpoints.

  python -m truesite_bim.site --out models/site    # rebuild the committed model files
  python -m truesite_bim.site --sheets-only --base-url https://<host> --sheets-dir ../web/public/sheets

Sized for people about 1.8 m (6 ft) tall: 6 m bays and a ground storey with 3.9 m clear under the beams.
- Grid: X lines A-D at 0, 6, 12, 18 m; Y lines 1-3 at 0, 6 and 12 m.
- Ground storey, reinforced concrete: 450 x 450 columns on every grid point (their rebar cages show through the
  see-through concrete), 400 x 600 beams on every grid line with their tops at level 1 (4.5 m), and the level 1
  slab cast over bays A-C. Bay C-D is not cast yet: only its bottom rebar mat is in. Edge protection around level 1.
- Upper storey, steel: UC columns on lines 1 and 3 from level 1 to the eaves (8.5 m), edge beams, four duo-pitch
  trusses T1-T4 spanning 12 m (ridge about 10.4 m), purlins, and X-bracing in the end bays.
- Pad footings with only their top 20 mm modelled, so nothing is below Z 0 and the model sits on the ground in AR.
- Anchors P1-P4: upright A3 sheets, code centre 1.4 m above the ground (an iPad held upright at chest height by a
  1.70 m adult), each facing a standing spot 1.5 m in front of it. Scan from the spot, then turn on the spot.
  D1: the whole building at 1:100 on an A4 desk sheet. The layout plan (site-layout.pdf) gives the tape
  measurements for setting the four sheets out on a car park.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

import ifcopenshell.api.geometry
import ifcopenshell.api.spatial
from reportlab.lib.pagesizes import A3, A4, landscape, portrait
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from .make_demo_model import Builder
from .pipeline import run as run_pipeline
from .qr_sheets import Sheet, https_base_url, render_sheet, warn_thin_quiet_zone
from .rooftop import qr_mm

PROJECT_ID = "site"
GRID_X = [0.0, 6.0, 12.0, 18.0]  # lines A-D
GRID_Y = [0.0, 6.0, 12.0]  # lines 1-3
L1 = 4.5  # top of the level 1 slab
EAVES = 8.5  # top of the steel columns = underside of the trusses
RC_COL = 0.45  # concrete column, square
BEAM_W, BEAM_D = 0.4, 0.6  # concrete beams, tops flush with the slab top: soffit at 3.9 m
SLAB_T = 0.2
CAST_TO_X = 12.0  # the level 1 slab is cast over bays A-C; bay C-D has its bottom mat only
COL_W, COL_D, COL_TW, COL_TF = 0.305, 0.31, 0.014, 0.022  # about UC 305 x 305 x 118, depth across the span
EDGE_W, EDGE_D, EDGE_TW, EDGE_TF = 0.165, 0.305, 0.007, 0.011  # about UB 305 x 165 x 40
FOOT, FOOT_T = 1.8, 0.02  # pad footing plan size; modelled thickness (top only)
COVER, LINK_STEP = 0.05, 0.3
MAT_STEP = 0.4
RAIL_H, RAIL_IN, POST_STEP = 1.1, 0.35, 2.0  # edge protection height, inset from the slab edge, post spacing
CHORD, WEB = 0.15, 0.09  # SHS chords and web members
EAVES_DEPTH, RISE, PANEL = 0.6, 1.2, 1.5
PURLIN_D, PURLIN_W = 0.2, 0.075
ROD_R = 0.03  # CHS 60 bracing
SPAN = GRID_Y[-1] - GRID_Y[0]

STEEL = ("Steel S355", "steel", (0.42, 0.47, 0.53))
CONCRETE = ("Concrete C30/37", "concrete", (0.72, 0.72, 0.70))
REBAR = ("Rebar B500B", "steel", (0.75, 0.18, 0.10))
RAIL = ("Scaffold tube", "steel", (0.85, 0.65, 0.1))

# --- viewpoints --------------------------------------------------------------------------------------------
CODE_Z = 1.4  # code centre above the ground: camera height of an iPad held upright at chest height (1.70 m adult)
STAND_OFF = 1.5  # the standing spot is this far in front of the code
QR_M = 0.23  # A3 portrait keeps the full 4-module quiet zone for the Cloud Run URL at 23 cm
VIEWPOINTS = [  # id, standing spot (x, y), looking direction (unit, along a grid axis), name
    ("P1", (9.0, -4.0), (0, 1), "South approach"),
    ("P2", (3.0, 3.0), (1, 0), "Inside, under the cast slab"),
    ("P3", (15.0, 9.0), (-1, 0), "Inside, under the open bay"),
    ("P4", (22.0, 6.0), (-1, 0), "East gable"),
]
COMPASS = {(0, 1): "north", (0, -1): "south", (1, 0): "east", (-1, 0): "west"}


def viewpoint_anchor(vid: str, stand: tuple[float, float], look: tuple[int, int], name: str) -> dict:
    code = [stand[0] + STAND_OFF * look[0], stand[1] + STAND_OFF * look[1], CODE_Z]
    return {"anchor_id": vid, "project_id": PROJECT_ID, "qr_size_m": QR_M, "position_m": code,
            "normal": [-look[0], -look[1], 0], "up": [0, 0, 1], "scale": 1.0,
            "label": f"{vid} {name}: upright A3, code at {CODE_Z} m"}


VIEW_ANCHORS = [viewpoint_anchor(*v) for v in VIEWPOINTS]
# D1: judges' desk sheet, A4 landscape: the building at 1:100 beside a 70 mm code. Page coordinates (mm, origin
# bottom-left): model (0, 0) at (15, 45), so the 18 x 12 m footprint covers x 15..195, y 45..165; code centre (250, 105).
DESK_SCALE_SITE = 0.01
DESK_ORIGIN_MM = (15.0, 45.0)
DESK_QR_MM = (250.0, 105.0)
ANCHOR_DESK = {"anchor_id": "D1", "project_id": PROJECT_ID, "qr_size_m": 0.07,
               "position_m": [round((DESK_QR_MM[0] - DESK_ORIGIN_MM[0]) / 1000 / DESK_SCALE_SITE, 4),
                              round((DESK_QR_MM[1] - DESK_ORIGIN_MM[1]) / 1000 / DESK_SCALE_SITE, 4), 0.0],
               "normal": [0, 0, 1], "up": [0, 1, 0], "scale": DESK_SCALE_SITE, "label": "Building desk sheet A4 (1:100)"}
ANCHORS = [*VIEW_ANCHORS, ANCHOR_DESK]
PROJECT = {"project_id": PROJECT_ID, "name": "Building under construction (1:1)"}


def top_chord_z(y: float) -> float:
    """Centreline height of the top chord at Y (duo-pitch, ridge at mid-span)."""
    bottom = EAVES + CHORD / 2
    return bottom + EAVES_DEPTH + RISE * (1 - abs(y - SPAN / 2) / (SPAN / 2))


def tag(gx: int, gy: int) -> str:
    return f"{'ABCD'[gx]}{gy + 1}"


class SiteBuilding:
    def __init__(self) -> None:
        self.b = Builder("mm", project_name="TrueSite Building Site", guid_prefix=PROJECT_ID)
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
        self.rc_col_profile = self.b.rect_profile("450x450", RC_COL, RC_COL)
        self.rc_beam_profile = self.b.rect_profile("400x600", BEAM_W, BEAM_D)
        self.pad_profile = self.b.rect_profile("1800x1800", FOOT, FOOT)
        self.bar20 = f.createIfcCircleProfileDef("AREA", None, None, L(0.010))
        self.bar16 = f.createIfcCircleProfileDef("AREA", None, None, L(0.008))
        self.tube = f.createIfcCircleProfileDef("AREA", "CHS 48", None, L(0.024))
        self.post = f.createIfcRectangleHollowProfileDef("AREA", "SHS 50", None, L(0.05), L(0.05), L(0.004), None, None)

    # --- low-level geometry (as in rooftop.py: one representation can hold many extrusions) ---------
    def _point(self, x: float, y: float, z: float):
        return self.f.createIfcCartesianPoint((self.b.L(x), self.b.L(y), self.b.L(z)))

    def _ring(self, x: float, y: float, t: float = 0.01):
        return self.f.createIfcRectangleHollowProfileDef("AREA", None, None, self.b.L(x), self.b.L(y), self.b.L(t), None, None)

    def _extrusion(self, profile, x: float, y: float, z: float, depth: float, axis=(0.0, 0.0, 1.0)):
        """Profile extruded `depth` along `axis` from (x, y, z) in the element's local frame."""
        ref = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 0.0, 1.0)
        place = self.f.createIfcAxis2Placement3D(self._point(x, y, z), self.f.createIfcDirection(tuple(map(float, axis))),
                                                 self.f.createIfcDirection(ref))
        return self.f.createIfcExtrudedAreaSolid(profile, place, self.f.createIfcDirection((0.0, 0.0, 1.0)), self.b.L(depth))

    def _rep(self, items):
        return self.f.createIfcShapeRepresentation(self.b.body, "Body", "SweptSolid", items)

    def _finish(self, e, material, notes: dict | None = None):
        if notes:
            self.b.pset(e, "TrueSite_Notes", notes)
        self.b.assign_material(e, *material, transparency=0.4 if material is CONCRETE else 0.0)
        ifcopenshell.api.spatial.assign_container(self.f, products=[e], relating_structure=self.b.storey)

    def _group(self, ifc_class: str, key: str, name: str, ptype: str, items, material, notes: dict | None = None):
        """An element made of many extrusions given in world coordinates (rebar cages and mats, edge protection)."""
        e = self.b.entity(ifc_class, key, name=name, predefined_type=ptype)
        self.b.body_rep(e, self._rep(items))
        self.b.place(e, (0.0, 0.0, 0.0))
        self._finish(e, material, notes)
        return e

    def linear(self, ifc_class: str, key: str, name: str, ptype: str, profile, p0, p1, notes: dict | None = None,
               material=STEEL):
        """A straight member from p0 to p1 (metres): the profile is extruded along the member axis, with the
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
        self._finish(e, material, notes)
        return e

    # --- ground storey: concrete ------------------------------------------------------------------
    def footing(self, gx: int, gy: int) -> None:
        b, t = self.b, tag(gx, gy)
        pad = b.entity("IfcFooting", f"footing-{t}", name=f"Pad footing {t}", predefined_type="PAD_FOOTING")
        b.body_rep(pad, ifcopenshell.api.geometry.add_profile_representation(self.f, context=b.body, profile=self.pad_profile, depth=FOOT_T))
        b.place(pad, (GRID_X[gx], GRID_Y[gy], 0.0))
        b.pset(pad, "Pset_FootingCommon", {"LoadBearing": True})
        self._finish(pad, CONCRETE, {"Install": "Pad 1.8 x 1.8 x 0.7 m, C30/37, top flush with the ground. Only the top is modelled.",
                                     "Grid": t} if (gx, gy) == (0, 0) else {"Grid": t})

    def rc_column(self, gx: int, gy: int) -> None:
        x, y, t = GRID_X[gx], GRID_Y[gy], tag(gx, gy)
        self.linear("IfcColumn", f"rc-column-{t}", f"RC column {t}", "COLUMN", self.rc_col_profile, (x, y, 0.0), (x, y, L1), {
            "Install": "450 x 450, C30/37, cast to the level 1 slab top. 8 T20 + T10 links @ 300, 50 mm cover.",
            "Grid": t}, material=CONCRETE)
        o = RC_COL / 2 - COVER
        items = [self._extrusion(self.bar20, x + dx, y + dy, 0.05, L1 - 0.1)
                 for dx in (-o, 0.0, o) for dy in (-o, 0.0, o) if (dx, dy) != (0.0, 0.0)]
        ring = self._ring(2 * o + 0.02, 2 * o + 0.02)
        z = 0.15
        while z < L1 - 0.1:
            items.append(self._extrusion(ring, x, y, z, 0.01))
            z += LINK_STEP
        self._group("IfcReinforcingBar", f"column-cage-{t}", f"Column cage {t}", "MAIN", items, REBAR, {"Grid": t})

    def rc_beam(self, a: tuple[int, int], c: tuple[int, int]) -> None:
        """Concrete beam between two grid points, face to face of the columns, top flush with the slab top."""
        (ax, ay), (cx, cy) = (GRID_X[a[0]], GRID_Y[a[1]]), (GRID_X[c[0]], GRID_Y[c[1]])
        ux, uy = (cx - ax) / math.hypot(cx - ax, cy - ay), (cy - ay) / math.hypot(cx - ax, cy - ay)
        h, z = RC_COL / 2, L1 - BEAM_D / 2
        t = f"{tag(*a)}-{tag(*c)}"
        notes = {"Install": "400 x 600, C30/37, cast with the slab. Soffit 3.9 m above the ground.", "Grid": t} \
            if (a, c) == ((0, 0), (1, 0)) else {"Grid": t}
        self.linear("IfcBeam", f"rc-beam-{t}", f"Beam {t}", "BEAM", self.rc_beam_profile,
                    (ax + h * ux, ay + h * uy, z), (cx - h * ux, cy - h * uy, z), notes, material=CONCRETE)

    def slab(self, bay: int) -> None:
        b = self.b
        x0, x1 = GRID_X[bay], GRID_X[bay + 1]
        t = f"{'ABCD'[bay]}-{'ABCD'[bay + 1]}"
        s = b.entity("IfcSlab", f"slab-L1-{t}", name=f"Slab L1 {t}", predefined_type="FLOOR")
        b.body_rep(s, self._rep([self._extrusion(b.rect_profile(f"{x1 - x0:.0f}x{SPAN:.0f}", x1 - x0, SPAN),
                                                 (x0 + x1) / 2, SPAN / 2, L1 - SLAB_T, SLAB_T)]))
        b.place(s, (0.0, 0.0, 0.0))
        b.pset(s, "Pset_SlabCommon", {"LoadBearing": True})
        self._finish(s, CONCRETE, {"Install": "200 mm C30/37 flat slab, cast with the beams.", "Bay": t})

    def slab_mat(self) -> None:
        """Bottom mat of the bay not cast yet: T16 both ways at 400 mm, on spacers 40 mm above the slab soffit."""
        x0, x1 = CAST_TO_X, GRID_X[-1]
        z = L1 - SLAB_T + 0.04
        items = []
        y = MAT_STEP / 2
        while y < SPAN:
            items.append(self._extrusion(self.bar16, x0, y, z, x1 - x0, axis=(1.0, 0.0, 0.0)))
            y += MAT_STEP
        x = x0 + MAT_STEP / 2
        while x < x1:
            items.append(self._extrusion(self.bar16, x, 0.0, z + 0.016, SPAN, axis=(0.0, 1.0, 0.0)))
            x += MAT_STEP
        self._group("IfcReinforcingBar", "slab-mat-L1-C-D", "Slab mat L1 C-D", "MAIN", items, REBAR,
                    {"Install": "Bottom mat T16 @ 400 both ways. Not cast yet: check cover and laps before the pour.", "Bay": "C-D"})

    def edge_protection(self) -> None:
        """Scaffold-tube guardrails (posts every 2 m, top and mid rails) just inside the level 1 slab edge."""
        lo_x, hi_x, lo_y, hi_y = GRID_X[0] + RAIL_IN, GRID_X[-1] - RAIL_IN, GRID_Y[0] + RAIL_IN, GRID_Y[-1] - RAIL_IN
        sides = {"south": ((lo_x, lo_y), (hi_x, lo_y)), "north": ((lo_x, hi_y), (hi_x, hi_y)),
                 "west": ((lo_x, lo_y), (lo_x, hi_y)), "east": ((hi_x, lo_y), (hi_x, hi_y))}
        for side, ((x0, y0), (x1, y1)) in sides.items():
            length = math.hypot(x1 - x0, y1 - y0)
            axis = ((x1 - x0) / length, (y1 - y0) / length, 0.0)
            items = [self._extrusion(self.tube, x0, y0, L1 + h, length, axis=axis) for h in (0.5, RAIL_H)]
            n = math.ceil(length / POST_STEP)
            items += [self._extrusion(self.post, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, L1, RAIL_H + 0.05) for i in range(n + 1)]
            self._group("IfcRailing", f"edge-protection-{side}", f"Edge protection {side}", "GUARDRAIL", items, RAIL,
                        {"Install": "Scaffold-tube guardrail, 1.1 m top rail and 0.5 m mid rail, posts at 2 m."} if side == "south" else None)

    # --- upper storey: steel ----------------------------------------------------------------------
    def steel_column(self, gx: int, gy: int) -> None:
        x, y, t = GRID_X[gx], GRID_Y[gy], tag(gx, gy)
        self.linear("IfcColumn", f"column-{t}", f"Steel column {t}", "COLUMN", self.col_profile, (x, y, L1), (x, y, EAVES), {
            "Install": "UC 305 x 305 x 118, S355, on a base plate with 4 M24 cast-in bolts on the RC column head.",
            "Grid": t})

    def edge_beam(self, gy: int, bay: int) -> None:
        y = GRID_Y[gy]
        a, c = GRID_X[bay] + COL_W / 2, GRID_X[bay + 1] - COL_W / 2
        t = f"{tag(bay, gy)}-{tag(bay + 1, gy)}"
        z = EAVES - EDGE_D / 2  # top flush with the column caps
        self.linear("IfcBeam", f"edge-{t}", f"Edge beam {t}", "BEAM", self.edge_profile, (a, y, z), (c, y, z),
                    {"Install": "UB 305 x 165 x 40, S355, bolted to the column caps.", "Grid": t})

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
                t = f"{'ABCD'[bay]}-{'ABCD'[bay + 1]}"
                notes = {"Install": "Cold-formed C200 x 75 x 2.5 at 1.5 m centres, lapped over the trusses."} if j == 4 else None
                self.linear("IfcMember", f"purlin-{j}-{bay}", f"Purlin P{j} {t}", "PURLIN", self.purlin_profile,
                            (GRID_X[bay], y, z), (GRID_X[bay + 1], y, z), notes)

    def bracing(self) -> None:
        notes = {"Install": "CHS 60 tension bracing. Tighten after the frame is plumbed."}
        for bay in (0, len(GRID_X) - 2):  # the two end bays
            a, c = GRID_X[bay], GRID_X[bay + 1]
            t = f"{'ABCD'[bay]}-{'ABCD'[bay + 1]}"
            for y, side in ((GRID_Y[0], "south"), (GRID_Y[-1], "north")):
                self.linear("IfcMember", f"brace-wall-{side}-{bay}-1", f"Brace wall {side} {t} (1)", "BRACE", self.rod_profile,
                            (a, y, L1 + 0.4), (c, y, EAVES - 0.4), notes)
                self.linear("IfcMember", f"brace-wall-{side}-{bay}-2", f"Brace wall {side} {t} (2)", "BRACE", self.rod_profile,
                            (c, y, L1 + 0.4), (a, y, EAVES - 0.4))
                ye, yr = y, SPAN / 2  # eaves and ridge of this roof slope
                self.linear("IfcMember", f"brace-roof-{side}-{bay}-1", f"Brace roof {side} {t} (1)", "BRACE", self.rod_profile,
                            (a, ye, top_chord_z(ye)), (c, yr, top_chord_z(yr)))
                self.linear("IfcMember", f"brace-roof-{side}-{bay}-2", f"Brace roof {side} {t} (2)", "BRACE", self.rod_profile,
                            (c, ye, top_chord_z(ye)), (a, yr, top_chord_z(yr)))

    def build(self) -> Builder:
        for gx in range(len(GRID_X)):
            for gy in range(len(GRID_Y)):
                self.footing(gx, gy)
                self.rc_column(gx, gy)
        for gy in range(len(GRID_Y)):
            for gx in range(len(GRID_X) - 1):
                self.rc_beam((gx, gy), (gx + 1, gy))
        for gx in range(len(GRID_X)):
            for gy in range(len(GRID_Y) - 1):
                self.rc_beam((gx, gy), (gx, gy + 1))
        for bay in range(GRID_X.index(CAST_TO_X)):
            self.slab(bay)
        self.slab_mat()
        self.edge_protection()
        for gx in range(len(GRID_X)):
            for gy in (0, len(GRID_Y) - 1):
                self.steel_column(gx, gy)
        for gy in (0, len(GRID_Y) - 1):
            for bay in range(len(GRID_X) - 1):
                self.edge_beam(gy, bay)
        for gx in range(len(GRID_X)):
            self.truss(gx)
        self.purlins()
        self.bracing()
        return self.b


# --- sheets -------------------------------------------------------------------------------------------------
def view_sheet(anchor: dict) -> Sheet:
    vid = anchor["anchor_id"]
    _, stand, look, name = next(v for v in VIEWPOINTS if v[0] == vid)
    x, y, _ = anchor["position_m"]
    return Sheet(
        vid, "wall", anchor["label"], f"TrueSite building site viewpoint {vid} ({name}) - life size 1:1", portrait(A3),
        qr_mm(anchor), (148.5, 265.0), check_bar_mm=(98.5, 40.0), text_box_mm=(20.0, 120.0),
        position_m=anchor["position_m"], normal=anchor["normal"], up=anchor["up"], scale=1.0,
        instructions=[
            f"{vid} {name}. Code centre at x {x:g} m, y {y:g} m from point O (see site-layout.pdf), facing "
            f"{COMPASS[(-look[0], -look[1])]}.",
            f"Mount UPRIGHT on a rigid board and stand: code centre {CODE_Z:.2f} m above the ground, sheet vertical, still.",
            f"Stand on the X {STAND_OFF:g} m in front ({stand[0]:g}, {stand[1]:g}). Hold the iPad upright at chest height.",
            "Scan, tap Start camera. Lock 0.7 m from the code, a little to one side, until 'Alignment: Good'.",
            "Step back to the X, then turn slowly on the spot and look up. Don't walk. Re-align on the code every minute.",
            "Measure the check bar: if it is not 10.0 cm, enter the length in the app.",
        ],
    )


def d1_sheet() -> Sheet:
    return Sheet(
        "D1", "desk", ANCHOR_DESK["label"], "TrueSite building desk sheet D1 - scale model 1:100", landscape(A4),
        70.0, DESK_QR_MM, check_bar_mm=(185.0, 18.0), text_box_mm=(15.0, 190.0),
        position_m=ANCHOR_DESK["position_m"], normal=ANCHOR_DESK["normal"], up=ANCHOR_DESK["up"], scale=DESK_SCALE_SITE,
        model_origin_mm=DESK_ORIGIN_MM,
        instructions=[
            "Print at 100% and lay it flat on a table in good light. Scan the code, tap Start camera.",
            "The 18 x 12 m building appears at 1:100 on the left half of the page.",
        ],
    )


def sheets() -> list[Sheet]:
    return [*(view_sheet(a) for a in VIEW_ANCHORS), d1_sheet()]


def tape_distances() -> list[tuple[str, str, float]]:
    """Code-to-code distances (plan, metres) to check the set-out with a tape."""
    pts = {a["anchor_id"]: a["position_m"][:2] for a in VIEW_ANCHORS}
    ids = list(pts)
    return [(p, q, round(math.dist(pts[p], pts[q]), 2)) for i, p in enumerate(ids) for q in ids[i + 1:]]


def render_layout(out_pdf: Path) -> Path:
    """A3 landscape plan at 1:125 for setting out the four viewpoint sheets on a car park."""
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    page = landscape(A3)
    c = canvas.Canvas(str(out_pdf), pagesize=page, pageCompression=0)
    c.setTitle("TrueSite building site - viewpoint layout")
    c.setAuthor("TrueSite")
    ox, oy, k = 45.0, 135.0, 8.0  # page mm of point O; mm per metre (1:125)

    def P(x: float, y: float) -> tuple[float, float]:
        return (ox + x * k) * mm, (oy + y * k) * mm

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, page[1] - 18 * mm, "TrueSite building site: where to put the four QR viewpoints (plan, 1:125 on A3)")
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, page[1] - 25 * mm, "All distances in metres from point O = grid corner A1. x runs east along line 1, y runs north "
                                              "along line A. Only the stands and the four standing spots need to be clear; the model can overlap cars.")
    # building footprint, slab cast area, grid
    c.setFillColorRGB(0.9, 0.9, 0.9)
    c.rect(*P(0, 0), CAST_TO_X * k * mm, SPAN * k * mm, stroke=0, fill=1)
    c.setFillColorRGB(1.0, 0.93, 0.9)
    c.rect(*P(CAST_TO_X, 0), (GRID_X[-1] - CAST_TO_X) * k * mm, SPAN * k * mm, stroke=0, fill=1)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 8)
    c.drawCentredString(*P(CAST_TO_X / 2, SPAN / 2 + 0.6), "Level 1 slab cast (ceiling 3.9-4.5 m)")
    c.drawCentredString(*P((CAST_TO_X + GRID_X[-1]) / 2, SPAN / 2 + 0.6), "Open bay: rebar mat at 4.3 m")
    c.setDash(4, 3)
    c.setStrokeColorRGB(0.4, 0.4, 0.4)
    for i, x in enumerate(GRID_X):
        c.line(*P(x, -1.0), *P(x, SPAN + 1.0))
        c.drawCentredString(*P(x, SPAN + 1.4), "ABCD"[i])
    for j, y in enumerate(GRID_Y):
        c.line(*P(-1.0, y), *P(GRID_X[-1] + 1.0, y))
        c.drawRightString(*P(-1.3, y - 0.15), str(j + 1))
    c.setDash()
    c.setStrokeColorRGB(0, 0, 0)
    for x in GRID_X:
        for y in GRID_Y:
            px, py = P(x - RC_COL / 2, y - RC_COL / 2)
            c.rect(px, py, RC_COL * k * mm, RC_COL * k * mm, stroke=1, fill=1)
    # point O
    c.setStrokeColorRGB(0.8, 0.1, 0.1)
    c.setLineWidth(1.5)
    c.circle(*P(0, 0), 3 * mm)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColorRGB(0.8, 0.1, 0.1)
    c.drawString(*P(-3.3, -1.3), "O (0, 0)")
    # viewpoints
    for a in VIEW_ANCHORS:
        vid = a["anchor_id"]
        _, stand, look, name = next(v for v in VIEWPOINTS if v[0] == vid)
        (x, y, _), (nx, ny, _) = a["position_m"], a["normal"]
        half = 0.15  # half the sheet width (A3 portrait, 297 mm)
        c.setStrokeColorRGB(0.1, 0.3, 0.8)
        c.setFillColorRGB(0.1, 0.3, 0.8)
        c.setLineWidth(4)
        c.line(*P(x - half * ny, y + half * nx), *P(x + half * ny, y - half * nx))  # the sheet, edge on
        c.setLineWidth(1)
        c.line(*P(x, y), *P(stand[0], stand[1]))  # facing arrow to the standing spot
        sx, sy = P(stand[0], stand[1])
        c.setStrokeColorRGB(0, 0.55, 0.2)
        c.setLineWidth(2)
        c.line(sx - 2.5 * mm, sy - 2.5 * mm, sx + 2.5 * mm, sy + 2.5 * mm)
        c.line(sx - 2.5 * mm, sy + 2.5 * mm, sx + 2.5 * mm, sy - 2.5 * mm)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 11)
        lx, ly = P(x + 0.5 * (ny or 1), y + 0.5 * (nx or 0) + 0.4)
        c.drawString(lx, ly, vid)
        c.setFont("Helvetica", 7)
        c.drawString(sx + 3 * mm, sy - 1 * mm, f"stand {STAND_OFF:g} m")
    # table
    c.setFont("Helvetica-Bold", 10)
    tx, ty = 20 * mm, 72 * mm
    c.drawString(tx, ty, "Set-out table (metres)")
    rows = [("Sheet", "Name", "Code centre x, y", "Code height", "Sheet faces", "Stand on X at", "Look")]
    for a in VIEW_ANCHORS:
        vid = a["anchor_id"]
        _, stand, look, name = next(v for v in VIEWPOINTS if v[0] == vid)
        x, y, z = a["position_m"]
        rows.append((vid, name, f"{x:g}, {y:g}", f"{z:.2f}", COMPASS[(-look[0], -look[1])], f"{stand[0]:g}, {stand[1]:g}",
                     COMPASS[look]))
    cols = [0, 14, 70, 108, 132, 156, 186]
    for r, row in enumerate(rows):
        c.setFont("Helvetica-Bold" if r == 0 else "Helvetica", 9)
        for col, cell in zip(cols, row):
            c.drawString(tx + col * mm, ty - (6 + 5 * r) * mm, cell)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(tx + 215 * mm, ty, "Tape check, code to code")
    c.setFont("Helvetica", 9)
    for i, (p, q, d) in enumerate(tape_distances()):
        c.drawString(tx + 215 * mm, ty - (6 + 5 * i) * mm, f"{p} - {q}: {d:.2f} m")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(tx + 290 * mm, ty, "How to set out")
    c.setFont("Helvetica", 8)
    steps = ["1. Tape a cross at O. Run a long tape east along a straight line (a", "   parking bay line works): this is the x axis.",
             "2. For y, turn 90 degrees: 3 m along x, 4 m up, 5 m diagonal.", "3. Tape each code spot and its X; check the code-to-code tapes.",
             "4. Sheet face square to its axis (+/- 1 degree): align the board's", "   bottom edge with a 1 m tape line on the ground.",
             "5. Code centre 1.40 m high; board vertical (phone level app)."]
    for i, s in enumerate(steps):
        c.drawString(tx + 290 * mm, ty - (6 + 4.5 * i) * mm, s)
    c.showPage()
    c.save()
    return out_pdf


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=Path("models") / PROJECT_ID)
    ap.add_argument("--base-url", type=https_base_url, help="render the sheets with links to this host")
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
        SiteBuilding().build().write(ifc)
        report = run_pipeline(ifc, a.out)
        lf = {"encoding": "utf-8", "newline": "\n"}  # LF on every OS, so Windows runs don't dirty the committed files
        (a.out / "anchors.json").write_text(json.dumps(ANCHORS, indent=2) + "\n", **lf)
        (a.out / "project.json").write_text(json.dumps(PROJECT) + "\n", **lf)
    if a.base_url:
        info = [render_sheet(sh, f"{a.base_url}/a/{PROJECT_ID}/{sh.anchor_id}", a.sheets_dir / f"{PROJECT_ID}-{sh.anchor_id}.pdf")
                for sh in sheets()]
        for sheet_info in info:
            warn_thin_quiet_zone(sheet_info)
        render_layout(a.sheets_dir / f"{PROJECT_ID}-layout.pdf")
        report = {"pipeline": report, "sheets": info}
    print(json.dumps(report, indent=2, default=str)[:1500])


if __name__ == "__main__":
    main()
