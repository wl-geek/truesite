"""Printable TrueSite QR anchor sheets (vector PDF): the page layout and rendering the site sheets use (site.py).

Every sheet prints on US Letter (215.9 x 279.4 mm), the paper the team and judges have (17 Oct 2026).

Guarantees (checked by tests/test_qr_sheets.py on the PDF itself):
  * the QR module area (outer edge of the modules, excluding the quiet zone) is exactly the
    stated size; modules are drawn as one filled vector path, no raster, no stroke
  * a 100 mm check bar (10 x 1 cm alternating segments)
  * anchor id, payload URL and short instructions on every sheet
  * error correction level M (boost_error=False, so the level is exactly M)

Anchor frame (contract section 3): origin at the code centre, +z = normal (toward the viewer),
+y = up (the code's top edge direction), +x = y x z. Desk sheets lie flat: normal = +Z, page
"up" (towards the top edge) is model +Y, page right is model +X, and model (0, 0) sits at
model_origin_mm on the page.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

import segno
from reportlab.lib.pagesizes import landscape, letter, portrait
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

QUIET_MODULES = 4  # ISO/IEC 18004 quiet zone
CHECK_BAR_MM = 100.0

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
    instructions: list[str] = field(default_factory=list)


def qr_mm(anchor: dict) -> float:
    """A sheet's code size comes from its anchors.json row, so the two can't drift apart."""
    return round(anchor["qr_size_m"] * 1000, 3)


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
