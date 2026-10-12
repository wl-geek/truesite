"""QR sheet tests: measure the vector PDF itself, decode a render, check the anchor geometry."""
import json

import numpy as np
import pymupdf
import pytest
import zxingcpp

from truesite_bim import qr_sheets

PT_PER_MM = 72 / 25.4
BASE = "https://truesite-7x2k3m4n5q-as.a.run.app"  # realistic legacy *.a.run.app length (QR version 4)
LONG_BASE = "https://truesite-123456789012.asia-southeast1.run.app"  # new-style Cloud Run URL (QR version 5)
SHEETS = {"D1": (120.0, (210, 297)), "D2": (150.0, (420, 297)), "A1": (230.0, (297, 420))}


@pytest.fixture(scope="module")
def sheets(tmp_path_factory):
    d = tmp_path_factory.mktemp("sheets")
    qr_sheets.main(["--base-url", BASE, "--project", "room1", "--out-dir", str(d),
                    "--anchors-out", str(d / "anchors.json")])
    return d


def drawings_mm(pdf):
    page = pymupdf.open(pdf)[0]
    out = []
    for dr in page.get_drawings():
        r = dr["rect"]
        out.append({"type": dr["type"], "n": len(dr["items"]),
                    "x0": r.x0 / PT_PER_MM, "y0": r.y0 / PT_PER_MM, "w": r.width / PT_PER_MM, "h": r.height / PT_PER_MM})
    return page, out


@pytest.mark.parametrize("aid", list(SHEETS))
def test_page_size_and_exact_qr_module_area(sheets, aid):
    size_mm, (pw, ph) = SHEETS[aid]
    page, drs = drawings_mm(sheets / f"room1-{aid}.pdf")
    assert page.rect.width / PT_PER_MM == pytest.approx(pw, abs=0.01)
    assert page.rect.height / PT_PER_MM == pytest.approx(ph, abs=0.01)
    qr = max((d for d in drs if d["type"] == "f"), key=lambda d: d["n"])  # the one big module path
    assert qr["w"] == pytest.approx(size_mm, abs=0.01) and qr["h"] == pytest.approx(size_mm, abs=0.01)


@pytest.mark.parametrize("aid", list(SHEETS))
def test_check_bar_is_100_mm(sheets, aid):
    _, drs = drawings_mm(sheets / f"room1-{aid}.pdf")
    bars = [d for d in drs if d["type"] == "s" and d["h"] == pytest.approx(5.0, abs=0.01)]
    assert len(bars) == 1 and bars[0]["w"] == pytest.approx(100.0, abs=0.01)


def test_a3_desk_sheet_has_20_by_15_cm_footprint(sheets):
    _, drs = drawings_mm(sheets / "room1-D2.pdf")
    outlines = [d for d in drs if d["type"] == "s" and d["w"] > 150]
    assert len(outlines) == 1
    assert outlines[0]["w"] == pytest.approx(200.0, abs=0.01) and outlines[0]["h"] == pytest.approx(150.0, abs=0.01)


@pytest.mark.parametrize("aid", list(SHEETS))
def test_render_decodes_to_anchor_url_with_ec_m_and_measures_right(sheets, aid):
    size_mm, _ = SHEETS[aid]
    page = pymupdf.open(sheets / f"room1-{aid}.pdf")[0]
    dpi = 150 if aid == "A1" else 300
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    (res,) = zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode)
    assert res.text == f"{BASE}/a/room1/{aid}"
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
    for sh in qr_sheets.make_sheets():
        info = qr_sheets.render_sheet(sh, f"{base}/a/room1/{sh.anchor_id}", tmp_path / f"{sh.anchor_id}.pdf")
        assert info["quiet_zone_modules_on_paper"] >= qr_sheets.QUIET_MODULES, info


def test_anchor_text_on_every_sheet(sheets):
    for aid in SHEETS:
        text = pymupdf.open(sheets / f"room1-{aid}.pdf")[0].get_text()
        assert aid in text and "10.0 cm" in text and "Actual size" in text and f"/a/room1/{aid}" in text


def test_anchors_json_matches_the_sheets(sheets):
    anchors = json.loads((sheets / "anchors.json").read_text())
    assert anchors == [qr_sheets.anchor_entry(sh, "room1") for sh in qr_sheets.make_sheets()]
    by_id = {a["anchor_id"]: a for a in anchors}
    assert set(by_id) == {"D1", "D2", "A1"}
    assert {k: by_id[k]["qr_size_m"] for k in by_id} == {"D1": 0.12, "D2": 0.15, "A1": 0.23}
    for a in anchors:
        assert set(a) == {"anchor_id", "project_id", "qr_size_m", "position_m", "normal", "up", "scale", "label"}
        assert a["project_id"] == "room1" and a["label"]
    a1 = by_id["A1"]  # placeholder wall pose until the room survey: west partition face, code upright
    assert (a1["position_m"], a1["normal"], a1["up"], a1["scale"]) == ([0.1, 1.5, 1.35], [1, 0, 0], [0, 0, 1], 1.0)


def test_desk_anchor_positions_round_trip_to_the_page():
    for sh in qr_sheets.make_sheets():
        a = qr_sheets.anchor_entry(sh, "room1")
        if sh.kind != "desk":
            continue
        assert a["scale"] == 0.05 and a["normal"] == [0, 0, 1] and a["up"] == [0, 1, 0]
        assert a["position_m"][2] == -0.15  # slab underside sits on the paper
        # model point (0, 0) must land on the page at model_origin_mm: page = qr_centre + (p - pos) * scale
        qx, qy = sh.qr_centre_mm
        px = qx + (0 - a["position_m"][0]) * a["scale"] * 1000
        py = qy + (0 - a["position_m"][1]) * a["scale"] * 1000
        assert (px, py) == pytest.approx(sh.model_origin_mm)
    by_id = {sh.anchor_id: qr_sheets.anchor_entry(sh, "room1") for sh in qr_sheets.make_sheets()}
    assert by_id["D2"]["position_m"][:2] == [-2.0, 1.5] and by_id["D1"]["position_m"][:2] == [2.0, -1.6]


def test_anchors_only_mode_needs_no_url(tmp_path):
    qr_sheets.main(["--project", "room1", "--anchors-out", str(tmp_path / "anchors.json"),
                    "--wall-position", "1", "2", "1.4", "--wall-normal", "0", "-1", "0"])
    a1 = {a["anchor_id"]: a for a in json.loads((tmp_path / "anchors.json").read_text())}["A1"]
    assert a1["position_m"] == [1.0, 2.0, 1.4] and a1["normal"] == [0.0, -1.0, 0.0]
    assert not list(tmp_path.glob("*.pdf"))


def test_cli_needs_an_output():
    with pytest.raises(SystemExit):
        qr_sheets.main(["--project", "room1"])
