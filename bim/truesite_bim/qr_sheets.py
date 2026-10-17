"""Printable TrueSite QR anchor sheets (vector PDF) + the matching anchors.json.

Every sheet prints on US Letter (215.9 x 279.4 mm), the paper the team and judges have (17 Oct 2026).
Sheets (spec sections 4.1 and 6):
  D1  portrait   desk sheet for judges: 12 cm QR; the 1:20 model appears above the code
  D2  portrait   desk sheet for the physical model: 20 x 15 cm footprint outline (1:20) above a 7 cm QR
  L1  portrait   life-size floor sheet: 16 cm QR (LIFE_* layout)
  A1  portrait   wall sheet: 16 cm QR (LIFE_* layout)

Guarantees (checked by tests/test_qr_sheets.py on the PDF itself):
  * the QR module area (outer edge of the modules, excluding the quiet zone) is exactly the
    stated size; modules are drawn as one filled vector path, no raster, no stroke
  * a 100 mm check bar (10 x 1 cm alternating segments)
  * anchor id, payload URL and short instructions on every sheet
  * error correction level M (boost_error=False, so the level is exactly M)

Anchor frame (contract section 3): origin at the code centre, +z = normal (toward the viewer),
+y = up (the code's top edge direction), +x = y x z. Desk sheets lie flat: normal = +Z, page
"up" (towards the top edge) is model +Y, page right is model +X, scale 0.05 (1:20), and model
(0, 0) sits at the footprint's bottom-left corner on the page. The wall anchor pose comes from
the room survey (--wall-position/--wall-normal/--wall-up); the default is a placeholder.

Usage (from bim/):
  python -m truesite_bim.qr_sheets --project room1 --anchors-out models/room1/anchors.json
  python -m truesite_bim.qr_sheets --base-url https://<app-host> --project room1 --out-dir sheets \
      [--anchors-out models/room1/anchors.json] [--wall-position 0.1 1.5 1.35] [--wall-normal 1 0 0]
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import segno
from reportlab.lib.pagesizes import landscape, letter, portrait
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

DESK_SCALE = 0.05  # 1:20
QUIET_MODULES = 4  # ISO/IEC 18004 quiet zone
CHECK_BAR_MM = 100.0
DESK_BASE_Z = -0.15  # model Z of the paper plane: the demo slab's underside sits on the sheet
WALL_POSITION = (0.1, 1.5, 1.35)  # placeholder until the survey: west partition inner face, code centre
WALL_NORMAL = (1.0, 0.0, 0.0)
WALL_UP = (0.0, 0.0, 1.0)
# Both platforms start with "Start camera" (the camera overlay): Start AR and Walk inside need ?xr=1 on the page
# URL, and no printed code carries it.
ANDROID_STEP = "Android: scan, tap Start camera, start within 1 m, then step back."
IPHONE_LIFE_SIZE_STEP = "iPhone: scan, tap Start camera, start within 1 m, then step back."

LETTER = portrait(letter)  # 215.9 x 279.4 mm
LETTER_LANDSCAPE = landscape(letter)  # 279.4 x 215.9 mm
# Life-size sheets (upright, wall and floor) share one portrait layout: a 16 cm code, the largest a Letter page holds
# with the full 4-module quiet zone around a version-4 or -5 code (the Cloud Run URLs), centred near the top, and the
# anchor id, instructions and check bar below it.
LIFE_QR_MM = 160.0
LIFE_QR_CENTRE_MM = (107.95, 178.0)
LIFE_CHECK_BAR_MM = (57.95, 12.0)
LIFE_TEXT_BOX_MM = (15.0, 70.0)


@dataclass
class Sheet:
    anchor_id: str
    kind: str  # "desk" | "floor" | "wall"
    label: str  # short name the app shows for this anchor
    title: str
    pagesize: tuple[float, float]  # points
    qr_mm: float
    qr_centre_mm: tuple[float, float]  # page coords, origin bottom-left
    check_bar_mm: tuple[float, float]  # left end, bottom edge
    text_box_mm: tuple[float, float]  # top-left of the instruction block
    position_m: list[float]  # anchor position in IFC model coordinates (metres, Z up)
    normal: list[float]
    up: list[float]
    scale: float
    model_origin_mm: tuple[float, float] | None = None  # page position of model (0, 0) for desk sheets
    footprint_m: tuple[float, float] | None = None  # outline drawn when set (model metres)
    instructions: list[str] = field(default_factory=list)


def desk_position(qr_centre_mm: tuple[float, float], model_origin_mm: tuple[float, float], base_z: float) -> list[float]:
    """Model coordinates of the QR centre for a flat 1:20 desk sheet."""
    qx, qy = qr_centre_mm
    ox, oy = model_origin_mm
    return [round((qx - ox) / 1000 / DESK_SCALE, 4), round((qy - oy) / 1000 / DESK_SCALE, 4), base_z]


def make_sheets(
    footprint_m: tuple[float, float] = (4.0, 3.0),
    base_z: float = DESK_BASE_Z,
    wall_position: tuple[float, float, float] = WALL_POSITION,
    wall_normal: tuple[float, float, float] = WALL_NORMAL,
    wall_up: tuple[float, float, float] = WALL_UP,
) -> list[Sheet]:
    common = [
        "Print on US Letter at 100% / 'Actual size' - never 'Fit to page'.",
        "If the check bar is not 10.0 cm, enter its measured length in the app.",
    ]
    d1_qr, d1_origin = (108.0, 98.0), (8.0, 178.0)  # the 1:20 room appears above the code
    d2_qr, d2_origin = (166.0, 64.0), (8.0, 116.0)  # the 20 x 15 cm outline above, the code below right
    return [
        Sheet(
            "D1", "desk", "Desk sheet Letter (1:20)", "TrueSite desk anchor D1 - model at 1:20", LETTER, 120.0, d1_qr,
            check_bar_mm=(57.95, 12.0), text_box_mm=(15.0, 262.0),
            position_m=desk_position(d1_qr, d1_origin, base_z), normal=[0, 0, 1], up=[0, 1, 0], scale=DESK_SCALE,
            model_origin_mm=d1_origin,
            instructions=[
                "Lay the sheet flat on a table in good light.",
                ANDROID_STEP,
                "iPhone: scan, tap Start camera, aim at the code.",
                "The 1:20 model appears on this half of the page.",
                *common,
            ],
        ),
        Sheet(
            "D2", "desk", "Physical model sheet Letter (1:20)", "TrueSite physical model sheet D2 - 1:20", LETTER,
            70.0, d2_qr, check_bar_mm=(12.0, 30.0), text_box_mm=(12.0, 96.0),
            position_m=desk_position(d2_qr, d2_origin, base_z), normal=[0, 0, 1], up=[0, 1, 0], scale=DESK_SCALE,
            model_origin_mm=d2_origin, footprint_m=footprint_m,
            instructions=[
                "Place the 1:20 physical model exactly on the outline.",
                "Keep the code flat and fully visible.",
                *common,
            ],
        ),
        Sheet(
            "L1", "floor", "Life-size floor sheet Letter (1:1)", "TrueSite floor anchor L1 - life size 1:1", LETTER,
            LIFE_QR_MM, LIFE_QR_CENTRE_MM, check_bar_mm=LIFE_CHECK_BAR_MM, text_box_mm=LIFE_TEXT_BOX_MM,
            position_m=[round(footprint_m[0] / 2, 4), round(footprint_m[1] / 2, 4), 0.0], normal=[0, 0, 1], up=[0, 1, 0],
            scale=1.0,
            instructions=[
                "Lay it flat on the floor in an open space; the demo room appears around you at real size.",
                "The top edge points to the room's north wall.",
                ANDROID_STEP,
                IPHONE_LIFE_SIZE_STEP,
                *common,
            ],
        ),
        Sheet(
            "A1", "wall", "Wall sheet Letter (1:1)", "TrueSite wall anchor A1 - 1:1", LETTER, LIFE_QR_MM, LIFE_QR_CENTRE_MM,
            check_bar_mm=LIFE_CHECK_BAR_MM, text_box_mm=LIFE_TEXT_BOX_MM,
            position_m=list(wall_position), normal=list(wall_normal), up=list(wall_up), scale=1.0,
            instructions=[
                "Tape flat to the wall at the surveyed spot, code upright.",
                "The code centre must be where anchors.json says (A1).",
                *common,
            ],
        ),
    ]


def qr_for(url: str) -> segno.QRCode:
    return segno.make_qr(url, error="m", boost_error=False)  # make_qr never emits Micro QR


def draw_qr(c: canvas.Canvas, qr: segno.QRCode, x0_mm: float, y0_mm: float, size_mm: float) -> float:
    """Draw dark modules as one filled path; the module area spans exactly size_mm. Returns module mm."""
    rows = qr.matrix  # no border
    n = len(rows)
    mod = size_mm / n
    p = c.beginPath()
    for r, row in enumerate(rows):
        y = y0_mm + (n - 1 - r) * mod  # row 0 is the top row
        col = 0
        while col < n:
            if row[col]:
                start = col
                while col < n and row[col]:
                    col += 1
                p.rect((x0_mm + start * mod) * mm, y * mm, (col - start) * mod * mm, mod * mm)
            else:
                col += 1
    c.setFillColorRGB(0, 0, 0)
    c.drawPath(p, stroke=0, fill=1)
    return mod


def draw_check_bar(c: canvas.Canvas, x_mm: float, y_mm: float, h_mm: float = 5.0) -> None:
    seg = CHECK_BAR_MM / 10
    p = c.beginPath()
    for i in range(0, 10, 2):
        p.rect((x_mm + i * seg) * mm, y_mm * mm, seg * mm, h_mm * mm)
    c.setFillColorRGB(0, 0, 0)
    c.drawPath(p, stroke=0, fill=1)
    c.setLineWidth(0.3)
    c.setStrokeColorRGB(0, 0, 0)
    c.rect(x_mm * mm, y_mm * mm, CHECK_BAR_MM * mm, h_mm * mm, stroke=1, fill=0)
    c.setFont("Helvetica", 8)
    for i in range(11):
        c.drawCentredString((x_mm + i * seg) * mm, (y_mm + h_mm + 1.5) * mm, str(i))
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString((x_mm + CHECK_BAR_MM / 2) * mm, (y_mm - 5) * mm, "CHECK BAR: must measure 10.0 cm")


def draw_footprint(c: canvas.Canvas, sheet: Sheet) -> None:
    ox, oy = sheet.model_origin_mm
    wx, wy = (v * 1000 * DESK_SCALE for v in sheet.footprint_m)  # model m -> paper mm
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(0.5)
    c.rect(ox * mm, oy * mm, wx * mm, wy * mm, stroke=1, fill=0)
    c.setFont("Helvetica", 8)
    c.drawString(ox * mm, (oy + wy + 3) * mm,
                 f"Footprint {sheet.footprint_m[0]:.1f} x {sheet.footprint_m[1]:.1f} m at 1:20 = {wx:.0f} x {wy:.0f} mm")
    # origin marker and model axes
    c.setLineWidth(0.8)
    c.line(ox * mm, oy * mm, (ox + 15) * mm, oy * mm)
    c.line(ox * mm, oy * mm, ox * mm, (oy + 15) * mm)
    c.drawString((ox + 16) * mm, (oy - 1) * mm, "+X")
    c.drawString((ox - 1) * mm, (oy + 16) * mm, "+Y")
    c.drawString((ox + 1.5) * mm, (oy - 5) * mm, "model origin (0, 0)")  # below the "+X" label, not touching it


def anchor_entry(sheet: Sheet, project_id: str) -> dict:
    """One anchors.json row (contract section 5 Anchor)."""
    return {"anchor_id": sheet.anchor_id, "project_id": project_id, "qr_size_m": sheet.qr_mm / 1000,
            "position_m": sheet.position_m, "normal": sheet.normal, "up": sheet.up, "scale": sheet.scale,
            "label": sheet.label}


def render_sheet(sheet: Sheet, url: str, out_pdf: Path) -> dict:
    qr = qr_for(url)
    n = qr.symbol_size(border=0)[0]
    mod = sheet.qr_mm / n
    qx, qy = sheet.qr_centre_mm
    x0, y0 = qx - sheet.qr_mm / 2, qy - sheet.qr_mm / 2
    pw, ph = sheet.pagesize[0] / mm, sheet.pagesize[1] / mm
    quiet_avail = min(x0, y0, pw - (x0 + sheet.qr_mm), ph - (y0 + sheet.qr_mm)) / mod
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(out_pdf), pagesize=sheet.pagesize, pageCompression=0)
    c.setTitle(sheet.title)
    c.setAuthor("TrueSite")
    c.setCreator("TrueSite qr_sheets.py")
    draw_qr(c, qr, x0, y0, sheet.qr_mm)
    draw_check_bar(c, *sheet.check_bar_mm)
    if sheet.footprint_m:
        draw_footprint(c, sheet)
    tx, ty = sheet.text_box_mm
    c.setFont("Helvetica-Bold", 28)
    c.drawString(tx * mm, ty * mm, sheet.anchor_id)
    c.setFont("Helvetica-Bold", 11)
    c.drawString((tx + 16) * mm, (ty + 2) * mm, sheet.title)
    c.setFont("Helvetica", 9)
    lines = [*sheet.instructions,
             f"QR {sheet.qr_mm / 10:.0f} cm (module area), version {qr.version}-{qr.error}, {n} x {n} modules.",
             url]
    for i, line in enumerate(lines):
        c.drawString(tx * mm, (ty - 8 - 5 * i) * mm, line)
    c.showPage()
    c.save()
    return {"anchor_id": sheet.anchor_id, "pdf": str(out_pdf), "url": url, "version": qr.version, "modules": n,
            "module_mm": round(mod, 3), "quiet_zone_modules_on_paper": round(quiet_avail, 2)}


def https_base_url(value: str) -> str:
    """argparse type for --base-url: phones open the camera only on a secure origin, so http:// sheets can never work."""
    if not value.startswith("https://"):
        raise argparse.ArgumentTypeError(f"{value!r} must start with https://")
    return value.rstrip("/")


def warn_thin_quiet_zone(info: dict) -> None:
    """Warn on stderr (stdout carries the JSON report) when the paper leaves less than the ISO quiet zone."""
    if info["quiet_zone_modules_on_paper"] < QUIET_MODULES:
        print(f"WARNING {info['anchor_id']}: only {info['quiet_zone_modules_on_paper']} modules of white paper "
              f"around the code (ISO asks for {QUIET_MODULES}); mount it on a light surface.", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="TrueSite printable QR anchor sheets and anchors.json")
    ap.add_argument("--base-url", type=https_base_url,
                    help="https://<app-host> (no trailing path); omit to write anchors.json only")
    ap.add_argument("--project", default="room1")
    ap.add_argument("--out-dir", type=Path, default=Path("sheets"))
    ap.add_argument("--anchors-out", type=Path, help="write anchors.json for all sheets")
    ap.add_argument("--footprint", type=float, nargs=2, default=(4.0, 3.0), metavar=("X_M", "Y_M"))
    ap.add_argument("--base-z", type=float, default=DESK_BASE_Z,
                    help="model Z of the paper plane for desk anchors (slab underside = -0.15 in the demo)")
    ap.add_argument("--wall-position", type=float, nargs=3, default=WALL_POSITION)
    ap.add_argument("--wall-normal", type=float, nargs=3, default=WALL_NORMAL)
    ap.add_argument("--wall-up", type=float, nargs=3, default=WALL_UP)
    a = ap.parse_args(argv)
    if a.base_url is None and a.anchors_out is None:
        ap.error("give --base-url (to render the sheets) and/or --anchors-out")
    sheets = make_sheets(tuple(a.footprint), a.base_z, tuple(a.wall_position), tuple(a.wall_normal), tuple(a.wall_up))
    report = []
    if a.base_url is not None:
        for sh in sheets:
            info = render_sheet(sh, f"{a.base_url}/a/{a.project}/{sh.anchor_id}", a.out_dir / f"{a.project}-{sh.anchor_id}.pdf")
            report.append(info)
            warn_thin_quiet_zone(info)
    anchors = [anchor_entry(sh, a.project) for sh in sheets]
    if a.anchors_out:
        a.anchors_out.parent.mkdir(parents=True, exist_ok=True)
        a.anchors_out.write_text(json.dumps(anchors, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"sheets": report, "anchors": anchors}, indent=2))


if __name__ == "__main__":
    main()
