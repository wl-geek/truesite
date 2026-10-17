"""QR sheet tests on the building site's sheets: measure the vector PDF itself, decode a render, check the geometry."""
import json

import numpy as np
import pymupdf
import pytest
import zxingcpp

from truesite_bim import qr_sheets, site

PT_PER_MM = 72 / 25.4
BASE = "https://truesite-7x2k3m4n5q-as.a.run.app"  # realistic legacy *.a.run.app length (QR version 4)
LONG_BASE = "https://truesite-123456789012.asia-southeast1.run.app"  # new-style Cloud Run URL (QR version 5)
PORTRAIT, LANDSCAPE = (215.9, 279.4), (279.4, 215.9)  # US Letter
SHEETS = {"P1": (160.0, PORTRAIT), "P2": (160.0, PORTRAIT), "P3": (160.0, PORTRAIT), "P4": (160.0, PORTRAIT),
          "D1": (62.0, LANDSCAPE)}
ALL_SHEETS = site.sheets()


@pytest.fixture(scope="module")
def sheets(tmp_path_factory):
    d = tmp_path_factory.mktemp("sheets")
    site.main(["--sheets-only", "--base-url", BASE, "--sheets-dir", str(d)])
    return d


def drawings_mm(pdf):
    page = pymupdf.open(pdf)[0]
    out = []
    for dr in page.get_drawings():
        r = dr["rect"]
        out.append({"type": dr["type"], "n": len(dr["items"]),
                    "x0": r.x0 / PT_PER_MM, "y0": r.y0 / PT_PER_MM, "w": r.width / PT_PER_MM, "h": r.height / PT_PER_MM})
    return page, out


def test_the_site_has_these_sheets():
    assert [sh.anchor_id for sh in ALL_SHEETS] == list(SHEETS)


@pytest.mark.parametrize("aid", list(SHEETS))
def test_page_size_and_exact_qr_module_area(sheets, aid):
    size_mm, (pw, ph) = SHEETS[aid]
    page, drs = drawings_mm(sheets / f"site-{aid}.pdf")
    assert page.rect.width / PT_PER_MM == pytest.approx(pw, abs=0.01)
    assert page.rect.height / PT_PER_MM == pytest.approx(ph, abs=0.01)
    qr = max((d for d in drs if d["type"] == "f"), key=lambda d: d["n"])  # the one big module path
    assert qr["w"] == pytest.approx(size_mm, abs=0.01) and qr["h"] == pytest.approx(size_mm, abs=0.01)


@pytest.mark.parametrize("aid", list(SHEETS))
def test_check_bar_is_100_mm(sheets, aid):
    _, drs = drawings_mm(sheets / f"site-{aid}.pdf")
    bars = [d for d in drs if d["type"] == "s" and d["h"] == pytest.approx(5.0, abs=0.01)]
    assert len(bars) == 1 and bars[0]["w"] == pytest.approx(100.0, abs=0.01)


@pytest.mark.parametrize("aid", list(SHEETS))
def test_render_decodes_to_anchor_url_with_ec_m_and_measures_right(sheets, aid):
    size_mm, _ = SHEETS[aid]
    page = pymupdf.open(sheets / f"site-{aid}.pdf")[0]
    dpi = 150 if size_mm > 100 else 300
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    (res,) = zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode)
    assert res.text == f"{BASE}/a/site/{aid}"
    assert res.ec_level == "M"
    p = res.position
    width_px = ((p.top_right.x - p.top_left.x) + (p.bottom_right.x - p.bottom_left.x)) / 2
    height_px = ((p.bottom_left.y - p.top_left.y) + (p.bottom_right.y - p.top_right.y)) / 2
    assert width_px / dpi * 25.4 == pytest.approx(size_mm, abs=0.5)
    assert height_px / dpi * 25.4 == pytest.approx(size_mm, abs=0.5)
    # upright: the decoder sees the top-left finder at the top-left of the page
    assert p.top_left.x < p.top_right.x and p.top_left.y < p.bottom_left.y


@pytest.mark.parametrize("base", [BASE, LONG_BASE])
def test_every_sheet_keeps_a_full_four_module_quiet_zone(tmp_path, base):
    for sh in ALL_SHEETS:
        info = qr_sheets.render_sheet(sh, f"{base}/a/site/{sh.anchor_id}", tmp_path / f"{sh.anchor_id}.pdf")
        assert info["quiet_zone_modules_on_paper"] >= qr_sheets.QUIET_MODULES, info


def test_anchor_text_on_every_sheet(sheets):
    for aid in SHEETS:
        text = pymupdf.open(sheets / f"site-{aid}.pdf")[0].get_text()
        assert aid in text and "10.0 cm" in text and "US Letter at 100%" in text and f"/a/site/{aid}" in text


def test_sheets_carry_the_anchor_code_sizes():
    by_id = {a["anchor_id"]: a for a in site.ANCHORS}
    for sh in ALL_SHEETS:
        assert sh.qr_mm == qr_sheets.qr_mm(by_id[sh.anchor_id])
        assert qr_sheets.anchor_entry(sh, "site")["qr_size_m"] == by_id[sh.anchor_id]["qr_size_m"]


def test_desk_sheet_puts_the_model_origin_where_the_page_says():
    (d1,) = [sh for sh in ALL_SHEETS if sh.kind == "desk"]
    a = qr_sheets.anchor_entry(d1, "site")
    assert a["scale"] == 0.01 and a["normal"] == [0, 0, 1] and a["up"] == [0, 1, 0]
    # model point (0, 0) must land on the page at model_origin_mm: page = qr_centre + (p - pos) * scale
    qx, qy = d1.qr_centre_mm
    px = qx + (0 - a["position_m"][0]) * a["scale"] * 1000
    py = qy + (0 - a["position_m"][1]) * a["scale"] * 1000
    assert (px, py) == pytest.approx(d1.model_origin_mm)


def text_lines(page) -> list[tuple[pymupdf.Rect, str]]:
    return [(pymupdf.Rect(line["bbox"]), "".join(s["text"] for s in line["spans"]))
            for block in page.get_text("dict")["blocks"] for line in block.get("lines", [])]


@pytest.mark.parametrize("sheet", ALL_SHEETS, ids=lambda sh: sh.anchor_id)
def test_text_clears_the_check_bar_and_other_text(tmp_path, sheet):
    pdf = tmp_path / f"{sheet.anchor_id}.pdf"
    qr_sheets.render_sheet(sheet, f"{BASE}/a/site/{sheet.anchor_id}", pdf)
    page = pymupdf.open(pdf)[0]
    lines = text_lines(page)
    bars = [pymupdf.Rect(d["rect"]) for d in page.get_drawings()
            if d["rect"].height / PT_PER_MM == pytest.approx(5.0, abs=0.01)]
    assert bars  # the check bar's segments and outline
    on_bar = [text for rect, text in lines for bar in bars if rect.intersects(bar)]
    on_text = [(a, b) for i, (ra, a) in enumerate(lines) for rb, b in lines[i + 1:] if ra.intersects(rb)]
    assert on_bar == [] and on_text == []
    margin = 5 * PT_PER_MM  # printers can't reach the last few mm
    assert all(page.rect.x0 + margin <= r.x0 and r.x1 <= page.rect.x1 - margin and
               page.rect.y0 + margin <= r.y0 and r.y1 <= page.rect.y1 - margin for r, _ in lines)


@pytest.mark.parametrize("sheet", ALL_SHEETS, ids=lambda sh: sh.anchor_id)
def test_drawings_stay_inside_the_page_and_the_check_bar_is_10_cm(tmp_path, sheet):
    pdf = tmp_path / f"{sheet.anchor_id}.pdf"
    qr_sheets.render_sheet(sheet, f"{BASE}/a/site/{sheet.anchor_id}", pdf)
    page = pymupdf.open(pdf)[0]
    margin = 5 * PT_PER_MM  # printers can't reach the last few mm
    inner = pymupdf.Rect(page.rect.x0 + margin, page.rect.y0 + margin, page.rect.x1 - margin, page.rect.y1 - margin)
    off = [tuple(round(v / PT_PER_MM, 1) for v in d["rect"]) for d in page.get_drawings() if not inner.contains(d["rect"])]
    assert off == []
    bar = [d["rect"].width / PT_PER_MM for d in page.get_drawings()
           if d["rect"].height / PT_PER_MM == pytest.approx(5.0, abs=0.01)]
    assert max(bar) == pytest.approx(qr_sheets.CHECK_BAR_MM, abs=0.01)  # the outline: 100 mm


@pytest.mark.parametrize("sheet", ALL_SHEETS, ids=lambda sh: sh.anchor_id)
def test_no_sheet_sends_anyone_to_a_hidden_button(sheet):
    # No QR carries ?xr=1, so a scanned sheet never shows Start AR or Walk inside (B-04); it says Start camera.
    text = " ".join([sheet.title, sheet.label, *sheet.instructions])
    assert "Start AR" not in text and "Walk inside" not in text
    assert "Start camera" in text


def test_quiet_zone_warning_goes_to_stderr(tmp_path, capsys):
    # A very short host gives a version-2 code with big modules: a 16 cm code then has < 4 modules of paper above it.
    site.main(["--sheets-only", "--base-url", "https://a.io", "--sheets-dir", str(tmp_path)])
    out, err = capsys.readouterr()
    assert "WARNING P1" in err and "WARNING" not in out


@pytest.mark.parametrize("url", ["http://192.168.1.23:5173", "192.168.1.23:5173"])
def test_base_url_must_be_https(tmp_path, url):
    # Phones open the camera only on a secure origin, so a sheet with an http:// link can never work.
    with pytest.raises(SystemExit):
        site.main(["--sheets-only", "--base-url", url, "--sheets-dir", str(tmp_path)])
    assert not list(tmp_path.glob("*.pdf"))


def test_sheets_only_writes_the_sheets_and_a_json_report(tmp_path, capsys):
    site.main(["--sheets-only", "--base-url", BASE, "--sheets-dir", str(tmp_path)])
    out = capsys.readouterr().out
    assert {p.name for p in tmp_path.glob("*.pdf")} == {f"site-{aid}.pdf" for aid in SHEETS} | {"site-layout.pdf"}
    assert '"sheets"' in out and json.dumps(f"{BASE}/a/site/P1") in out
