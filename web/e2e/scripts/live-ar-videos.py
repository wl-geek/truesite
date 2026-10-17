#!/usr/bin/env python3
"""Synthetic camera feeds (Y4M) with exact ground truth for the live AR e2e test (web/e2e/tests/live-ar.e2e.ts).

Chromium plays a .y4m file as the camera with
    --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file.y4m>
and loops it. Every frame here is ray-traced from a known camera pose:
  * site sheets: an upright sheet of bim/truesite_bim/site.py (the code size from anchors.json, code centre 1.40 m above the
    ground, on a pole), a car-park ground with the TRUE column and footing outlines of the site model painted on
    it, and sky;
  * D1: the A4 landscape desk sheet (70 mm code) flat on a table, with dots where the 1:100 columns stand.
The intrinsics are the app's default (63 degrees across the long side, principal point at the centre), so an
uncalibrated session has the exact K. Each frame carries its index as 12 black/white 16 px blocks in the top-left
corner (bit i = block i, then a white and a black check block), so the page can send motion events that match
the frame on screen.

Run with numpy + segno (the bim venv has both), from bim/:
    uv run python ../web/e2e/scripts/live-ar-videos.py --out ../web/e2e/.videos [--base-url http://127.0.0.1:8814]
Writes <dir>/<name>.y4m (1920 x 1080 I420, about 3.1 MB per frame) and <dir>/live-ar-videos.json with the
per-frame camera poses (camera -> world rotation, row-major, OpenCV axes: x right, y down, z forward).
World = IFC metres (Z up) for the site; for D1 it is the desk: origin at the code centre, x page right,
y page up, z up, metres.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import segno

REPO = Path(__file__).resolve().parents[3]  # web/e2e/scripts/ -> the repo root
W, H, FPS = 1920, 1080, 15
HFOV_DEG = 63.0  # web/src/camera/intrinsics.ts DEFAULT_HFOV_DEG (across the long side)
F = (max(W, H) / 2) / math.tan(math.radians(HFOV_DEG) / 2)
CX, CY = W / 2, H / 2
STAMP_BITS, STAMP_PX = 12, 16
PREVIEW = False

# Sheet layouts (bim/truesite_bim/site.py view_sheet / d1_sheet): page size, code centre on the page (mm from the
# bottom-left corner), code size from anchors.json, check bar (left end, bottom edge), instruction block top-left.
P_PAGE, P_CODE, P_BAR, P_TEXT = (297.0, 420.0), (148.5, 265.0), (98.5, 40.0), (20.0, 120.0)
D_PAGE, D_CODE, D_BAR, D_TEXT, D_ORIGIN = (297.0, 210.0), (250.0, 105.0), (185.0, 18.0), (15.0, 190.0), (15.0, 45.0)
GRID_X, GRID_Y, FOOT, RC_COL = (0.0, 6.0, 12.0, 18.0), (0.0, 6.0, 12.0), 1.8, 0.45

PAPER = np.array([0.93, 0.93, 0.91], np.float32)
INK = np.array([0.07, 0.07, 0.08], np.float32)


def unit(v) -> np.ndarray:
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def look_rotation(forward, up=(0.0, 0.0, 1.0), roll_deg: float = 0.0) -> np.ndarray:
    """Camera -> world rotation (columns: camera x right, y down, z forward in world) with no roll about forward."""
    z = unit(forward)
    x = unit(np.cross(z, up))
    y = np.cross(z, x)
    if roll_deg:
        a = math.radians(roll_deg)
        x, y = math.cos(a) * x + math.sin(a) * y, -math.sin(a) * x + math.cos(a) * y
    return np.column_stack([x, y, z])


def rot_axis(axis, deg: float) -> np.ndarray:
    k = unit(axis)
    a = math.radians(deg)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


def anchors() -> dict[str, dict]:
    rows = json.loads((REPO / "bim" / "models" / "site" / "anchors.json").read_text())
    return {a["anchor_id"]: a for a in rows}


def qr_modules(payload: str) -> np.ndarray:
    qr = segno.make_qr(payload, error="m", boost_error=False)  # same call as qr_sheets.qr_for
    return np.array([[bool(v) for v in row] for row in qr.matrix], bool)


@dataclass
class Sheet:
    """A printed sheet: page rectangle in mm around the code centre, its code and the page decorations."""
    C: np.ndarray  # code centre (world)
    ex: np.ndarray  # page right (world)
    ey: np.ndarray  # page up (world)
    ez: np.ndarray  # out of the printed face
    modules: np.ndarray | None
    qr_mm: float
    page: tuple[float, float, float, float]  # u0, u1, v0, v1 (mm, relative to the code centre)
    bar: tuple[float, float]  # check bar left end, bottom (mm, relative)
    text: tuple[float, float]  # instruction block top-left (mm, relative)
    pole: bool = False
    dots: list[tuple[float, float]] | None = None  # grid dots (mm, relative), desk sheet only


def paper_colour(sh: Sheet, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Colour of page points (u, v mm relative to the code centre)."""
    out = np.broadcast_to(PAPER, u.shape + (3,)).copy()
    dark = np.zeros(u.shape, bool)
    if sh.modules is not None:
        n = sh.modules.shape[0]
        half = sh.qr_mm / 2
        m = sh.qr_mm / n
        inq = (np.abs(u) < half) & (np.abs(v) < half)
        col = np.clip(((u + half) / m).astype(np.int32), 0, n - 1)
        row = np.clip(((half - v) / m).astype(np.int32), 0, n - 1)
        dark |= inq & sh.modules[row, col]
    bx, by = sh.bar
    inbar = (u >= bx) & (u < bx + 100) & (v >= by) & (v < by + 5)
    dark |= inbar & ((((u - bx) // 10).astype(np.int32) % 2) == 0)
    tx, ty = sh.text
    for i, length in enumerate((60, 150, 140, 165, 120, 150, 90)):
        top = ty - i * 9 - (0 if i == 0 else 6)
        h = 7 if i == 0 else 3
        dark |= (u >= tx) & (u < tx + length) & (v <= top) & (v > top - h)
    out[dark] = INK
    if sh.dots:
        for du, dv in sh.dots:
            d2 = (u - du) ** 2 + (v - dv) ** 2
            out[d2 < 2.0 ** 2] = np.array([0.55, 0.55, 0.58], np.float32)
    return out


def ground_colour(x: np.ndarray, y: np.ndarray, dist: np.ndarray) -> np.ndarray:
    """Car park: tarmac, parking bay lines, and the site model's true footing (yellow) and column (white) outlines."""
    ix, iy = np.floor(x / 0.08), np.floor(y / 0.08)
    h = np.modf(np.sin(ix * 12.9898 + iy * 78.233) * 43758.5453)[0]
    g = 0.34 + 0.05 * np.abs(h) + 0.02 * np.sin(x * 0.9 + 0.5 * np.sin(y * 0.7)) + 0.015 * np.sin(y * 2.3)
    out = np.stack([g, g * 1.01, g * 1.04], -1).astype(np.float32)
    # bay lines under the south half of the building (they run north-south) and the bay end line
    bx = np.abs(((x - 1.25) % 2.5) - 1.25)
    lines = ((bx < 0.05) & (y > -1.5) & (y < 3.5) & (x > -1.3) & (x < 19.3)) | ((np.abs(y + 1.5) < 0.05) & (x > -1.3) & (x < 19.3))
    out[lines] = np.array([0.82, 0.82, 0.80], np.float32)
    # nearest grid point (the grid is regular: 6 m bays), then the square rings around it
    step = GRID_X[1] - GRID_X[0]
    gx = np.clip(np.rint(x / step) * step, GRID_X[0], GRID_X[-1])
    gy = np.clip(np.rint(y / step) * step, GRID_Y[0], GRID_Y[-1])
    r = np.maximum(np.abs(x - gx), np.abs(y - gy))
    out[(r < FOOT / 2) & (r > FOOT / 2 - 0.05)] = np.array([0.85, 0.72, 0.15], np.float32)
    out[(r < RC_COL / 2) & (r > RC_COL / 2 - 0.04)] = np.array([0.95, 0.95, 0.95], np.float32)
    fog = (1 - np.exp(-dist / 90.0))[..., None].astype(np.float32)
    return out * (1 - fog) + np.array([0.78, 0.80, 0.83], np.float32) * fog


def sky_colour(d: np.ndarray) -> np.ndarray:
    t = np.clip(d[..., 2] / 0.6, 0, 1)[..., None]
    return (np.array([0.80, 0.83, 0.86], np.float32) * (1 - t) + np.array([0.55, 0.68, 0.86], np.float32) * t).astype(np.float32)


def table_colour(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    g = 0.04 * np.sin(y * 180 + 3 * np.sin(x * 9)) + 0.02 * np.sin(y * 37 + x * 3)
    out = np.stack([0.56 + g, 0.41 + g, 0.27 + g * 0.8], -1).astype(np.float32)
    far = (np.abs(x) > 0.9) | (y > 0.7) | (y < -0.9)
    out[far] = np.array([0.45, 0.45, 0.47], np.float32)
    return out


def shade(scene: str, sheet: Sheet | None, o: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Colour of rays from o (3,) along d (..., 3) (world, unit length)."""
    col = sky_colour(d) if scene == "site" else np.broadcast_to(np.array([0.74, 0.74, 0.72], np.float32), d.shape).copy()
    dz = d[..., 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        tg = np.where(dz < -1e-6, -o[2] / dz, np.inf)
    hit_g = np.isfinite(tg)
    P = o + np.where(hit_g, tg, 0)[..., None] * d
    if scene == "site":
        col[hit_g] = ground_colour(P[..., 0][hit_g], P[..., 1][hit_g], tg[hit_g])
    else:
        col[hit_g] = table_colour(P[..., 0][hit_g], P[..., 1][hit_g])
    if sheet is None:
        return col
    if scene == "desk":
        u, v = P[..., 0] * 1000, P[..., 1] * 1000  # the sheet lies on the table: desk frame = page frame
        u0, u1, v0, v1 = sheet.page
        on = hit_g & (u >= u0) & (u <= u1) & (v >= v0) & (v <= v1)
        col[on] = paper_colour(sheet, u[on], v[on])
        return col
    denom = d @ sheet.ez
    with np.errstate(divide="ignore", invalid="ignore"):
        ts = np.where(denom < -1e-9, ((sheet.C - o) @ sheet.ez) / denom, np.inf)
    Q = o + np.where(np.isfinite(ts), ts, 0)[..., None] * d
    rel = Q - sheet.C
    u, v = (rel @ sheet.ex) * 1000, (rel @ sheet.ey) * 1000
    u0, u1, v0, v1 = sheet.page
    front = np.isfinite(ts) & (ts > 0) & (ts < tg)
    on = front & (u >= u0) & (u <= u1) & (v >= v0) & (v <= v1)
    pole = front & sheet.pole & (np.abs(u) <= 20) & (v < v0) & (v > -sheet.C[2] * 1000 - 50)
    col[pole] = np.array([0.22, 0.22, 0.24], np.float32)
    col[on] = paper_colour(sheet, u[on], v[on])
    return col


def render(scene: str, sheet: Sheet | None, c: np.ndarray, R: np.ndarray, ss: int = 2) -> np.ndarray:
    """Supersampled pinhole render, H x W x 3 float32 in 0..1 (pixel-edge convention: centre at i + 0.5)."""
    img = np.zeros((H, W, 3), np.float32)
    offs = [(k + 0.5) / ss for k in range(ss)]
    cols = np.arange(W, dtype=np.float64)
    chunk = 108
    for r0 in range(0, H, chunk):
        rows = np.arange(r0, min(H, r0 + chunk), dtype=np.float64)
        acc = np.zeros((len(rows), W, 3), np.float32)
        for oy in offs:
            for ox in offs:
                xs = (cols[None, :] + ox - CX) / F
                ys = (rows[:, None] + oy - CY) / F
                dc = np.stack(np.broadcast_arrays(xs, ys, np.ones_like(xs)), -1)
                dw = dc @ R.T
                dw /= np.linalg.norm(dw, axis=-1, keepdims=True)
                acc += shade(scene, sheet, c, dw)
        img[r0:r0 + len(rows)] = acc / (ss * ss)
    return img


def blur(img: np.ndarray) -> np.ndarray:
    """Light optical blur: [1 2 1] / 4 in x and y."""
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    x = (p[:, :-2] + 2 * p[:, 1:-1] + p[:, 2:]) / 4
    return (x[:-2] + 2 * x[1:-1] + x[2:]) / 4


def to_i420(rgb: np.ndarray, frame_index: int) -> bytes:
    """BT.601 limited-range I420, with the frame index stamped into the top-left corner of the luma plane."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 16 + 65.481 * r + 128.553 * g + 24.966 * b
    cb = 128 - 37.797 * r - 74.203 * g + 112.0 * b
    cr = 128 + 112.0 * r - 93.786 * g - 18.214 * b
    sub = lambda p: (p[0::2, 0::2] + p[1::2, 0::2] + p[0::2, 1::2] + p[1::2, 1::2]) / 4  # noqa: E731
    U, V = sub(cb), sub(cr)
    bits = [(frame_index >> i) & 1 for i in range(STAMP_BITS)] + [1, 0]
    for i, bit in enumerate(bits):
        y[0:STAMP_PX, i * STAMP_PX:(i + 1) * STAMP_PX] = 235 if bit else 16
        U[0:STAMP_PX // 2, i * STAMP_PX // 2:(i + 1) * STAMP_PX // 2] = 128
        V[0:STAMP_PX // 2, i * STAMP_PX // 2:(i + 1) * STAMP_PX // 2] = 128
    q = lambda p: np.clip(np.rint(p), 0, 255).astype(np.uint8).tobytes()  # noqa: E731
    return q(y) + q(U) + q(V)


def code_visible(sheet: Sheet | None, c: np.ndarray, R: np.ndarray) -> bool:
    """All four outer corners of the code in front of the camera and inside the frame."""
    if sheet is None or sheet.modules is None:
        return False
    h = sheet.qr_mm / 2000
    for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
        p = sheet.C + sx * h * sheet.ex + sy * h * sheet.ey
        x, y, z = R.T @ (p - c)
        if z <= 0.05:
            return False
        u, v = F * x / z + CX, F * y / z + CY
        if not (0 <= u <= W and STAMP_PX <= v <= H):
            return False
    return True


def site_sheet(anchor: dict, payload: str | None, lean_deg: float = 0.0) -> Sheet:
    """The upright A3 sheet of `anchor`, optionally leaning back (top away from the viewer) about its x axis."""
    z = unit(anchor["normal"])
    up = np.asarray(anchor["up"], float)
    y = unit(up - z * (up @ z))
    x = np.cross(y, z)
    L = rot_axis(x, -lean_deg)  # positive lean: the top edge tips away from the viewer (+z)
    pw, ph = P_PAGE
    cu, cv = P_CODE
    return Sheet(
        C=np.asarray(anchor["position_m"], float), ex=L @ x, ey=L @ y, ez=L @ z,
        modules=qr_modules(payload) if payload else None, qr_mm=anchor["qr_size_m"] * 1000,
        page=(-cu, pw - cu, -cv, ph - cv), bar=(P_BAR[0] - cu, P_BAR[1] - cv), text=(P_TEXT[0] - cu, P_TEXT[1] - cv), pole=True,
    )


def desk_sheet(anchor: dict, payload: str) -> Sheet:
    pw, ph = D_PAGE
    cu, cv = D_CODE
    s = anchor["scale"]
    dots = [((D_ORIGIN[0] + gx * 1000 * s) - cu, (D_ORIGIN[1] + gy * 1000 * s) - cv) for gx in GRID_X for gy in GRID_Y]
    return Sheet(
        C=np.zeros(3), ex=np.array([1.0, 0, 0]), ey=np.array([0, 1.0, 0]), ez=np.array([0, 0, 1.0]),
        modules=qr_modules(payload), qr_mm=anchor["qr_size_m"] * 1000,
        page=(-cu, pw - cu, -cv, ph - cv), bar=(D_BAR[0] - cu, D_BAR[1] - cv), text=(D_TEXT[0] - cu, D_TEXT[1] - cv), dots=dots,
    )


def smooth(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def write_video(out: Path, name: str, scene: str, sheet: Sheet | None, cams: list[tuple[np.ndarray, np.ndarray]],
                meta: dict, seed: int, hidden: set[int] | None = None) -> dict:
    """Render every distinct pose once, add per-frame sensor noise, write the Y4M and return its manifest row.
    Frames in `hidden` are rendered without the sheet (someone stepped in front of it, or it was taken away)."""
    hidden = hidden or set()
    rng = np.random.default_rng(seed)
    cache: dict[bytes, np.ndarray] = {}
    path = out / f"{name}.y4m"
    with path.open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
        for i, (c, R) in enumerate(cams):
            key = np.concatenate([c, R.ravel(), [i in hidden]]).round(9).tobytes()
            if key not in cache:
                cache[key] = blur(render(scene, None if i in hidden else sheet, c, R))
            noisy = cache[key] + rng.standard_normal((H, W, 3), dtype=np.float32) * np.float32(1.3 / 255)
            f.write(b"FRAME\n" + to_i420(np.clip(noisy, 0, 1), i))
            if PREVIEW and i in (0, len(cams) - 1):
                from PIL import Image  # optional: only for --preview
                Image.fromarray((np.clip(noisy, 0, 1) * 255).astype(np.uint8)).save(out / f"{name}-{i:03d}.png")
    print(f"{path.name}: {len(cams)} frames, {len(cache)} distinct poses, {path.stat().st_size / 1e6:.0f} MB")
    return {
        "file": path.name, "scene": scene, "frames": len(cams), **meta,
        "cams": [{"c": [round(v, 6) for v in c], "R": [round(v, 9) for v in R.ravel()]} for c, R in cams],
        "codeVisible": [i not in hidden and code_visible(sheet, c, R) for i, (c, R) in enumerate(cams)],
        "sheet": None if sheet is None else {
            "C": sheet.C.tolist(), "ex": sheet.ex.tolist(), "ey": sheet.ey.tolist(), "ez": sheet.ez.tolist(), "qrMm": sheet.qr_mm,
            "modules": None if sheet.modules is None else int(sheet.modules.shape[0]),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--base-url", default="http://127.0.0.1:8814")
    ap.add_argument("--only", nargs="*", help="video names to (re)make; default all")
    ap.add_argument("--preview", action="store_true", help="also save the first and last frame of each video as PNG")
    a = ap.parse_args()
    global PREVIEW
    PREVIEW = a.preview
    a.out.mkdir(parents=True, exist_ok=True)
    base = a.base_url.rstrip("/")
    an = anchors()
    P1, D1 = an["P1"], an["D1"]
    C = np.asarray(P1["position_m"], float)
    normal = unit(P1["normal"])
    toward_east = np.array([1.0, 0, 0])  # P1 faces south: its right-hand side is east

    def lock_cam(dist: float = 0.7, side_deg: float = 25.0, height: float | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Lock pose of the filming doc: `dist` from the code, `side_deg` to the east of its normal, level, aimed at it."""
        s = math.radians(side_deg)
        c = C + dist * (math.cos(s) * normal + math.sin(s) * toward_east)
        if height is not None:
            c[2] = height
        return c, look_rotation(C - c)

    lock = lock_cam()
    manifest: dict = {
        "width": W, "height": H, "fps": FPS, "K": {"f": F, "cx": CX, "cy": CY}, "hfovDeg": HFOV_DEG,
        "stamp": {"bits": STAMP_BITS, "px": STAMP_PX}, "baseUrl": base, "videos": {},
    }
    old = a.out / "live-ar-videos.json"
    if a.only and old.exists():
        manifest["videos"] = json.loads(old.read_text())["videos"]

    def want(name: str) -> bool:
        return not a.only or name in a.only

    p1_url = f"{base}/a/site/P1"
    if want("p1-steady"):  # (a) the code steady in view at the lock pose: 0.7 m, 25 degrees to the east, level
        manifest["videos"]["p1-steady"] = write_video(a.out, "p1-steady", "site", site_sheet(P1, p1_url), [lock] * 15,
                                                      {"anchor": "P1", "payload": p1_url, "leanDeg": 0}, 1)
    def turn_cams(start: int, frames: int, yaw_deg: float, pitch_deg: float, total: int, profile=smooth):
        """Turn on the spot from the lock pose: yaw left and pitch up over `frames` frames from `start`.
        Pure rotation about the camera centre (what look-around assumes)."""
        c0, R0 = lock
        fwd0 = R0[:, 2]  # horizontal: the camera is at the code's height, aimed at it
        cams = []
        for i in range(total):
            t = profile((i - start) / frames)
            f = rot_axis([0, 0, 1], yaw_deg * t) @ fwd0
            f = math.cos(math.radians(pitch_deg * t)) * f + math.sin(math.radians(pitch_deg * t)) * np.array([0, 0, 1.0])
            cams.append((c0, look_rotation(f)))
        return cams

    def steady(t: float) -> float:
        """0 -> 1 at constant speed with a 10% ease in and out."""
        t = min(1.0, max(0.0, t))
        e = 0.1
        if t < e:
            return t * t / (2 * e * (1 - e))
        if t > 1 - e:
            return 1 - (1 - t) ** 2 / (2 * e * (1 - e))
        return (t - e / 2) / (1 - e)

    def turn_meta(start: int, frames: int, yaw: float, pitch: float, **extra) -> dict:
        return {"anchor": "P1", "payload": p1_url, "leanDeg": 0, "turn": {"startFrame": start, "frames": frames, "yawDeg": yaw, "pitchDeg": pitch}, **extra}

    if want("p1-turn"):
        # (b) 3 s at the lock pose, a quick 0.8 s turn on the spot (55 degrees left, 18 degrees up; about 100
        # degrees/s at its fastest, the code leaves the frame about half-way), then 6.7 s held there.
        manifest["videos"]["p1-turn"] = write_video(a.out, "p1-turn", "site", site_sheet(P1, p1_url),
                                                    turn_cams(45, 12, 55.0, 18.0, 158), turn_meta(45, 12, 55, 18), 2)
    if want("p1-turn-covered"):
        # The same quick turn, but the code is covered (someone walks in front) 0.33 s before the turn starts: the
        # look-around lock is taken while the camera is still, so this isolates the look-around maths.
        manifest["videos"]["p1-turn-covered"] = write_video(
            a.out, "p1-turn-covered", "site", site_sheet(P1, p1_url), turn_cams(50, 12, 55.0, 18.0, 122),
            turn_meta(50, 12, 55, 18, coveredFrom=45), 8, hidden=set(range(45, 122)))
    if want("p1-turn-slow"):
        # A turn at the filming doc's pace: 60 degrees left at 30 degrees/s and 12 degrees up; the code leaves the
        # frame at full speed, about 40 degrees into the turn.
        frames = round(60 / 30 / (1 - 0.1) * FPS)  # 33 frames
        manifest["videos"]["p1-turn-slow"] = write_video(
            a.out, "p1-turn-slow", "site", site_sheet(P1, p1_url), turn_cams(45, frames, 60.0, 12.0, 45 + frames + 75, steady),
            turn_meta(45, frames, 60, 12), 9)
    if want("p1-nocode"):  # (c) the same view with no sheet at all
        manifest["videos"]["p1-nocode"] = write_video(a.out, "p1-nocode", "site", None, [lock] * 15, {"anchor": "P1", "payload": None, "leanDeg": 0}, 3)
    if want("p1-lean4"):  # a board leaning back 4 degrees, camera level at the lock pose (gravity levelling)
        manifest["videos"]["p1-lean4"] = write_video(a.out, "p1-lean4", "site", site_sheet(P1, p1_url, 4.0), [lock] * 15,
                                                     {"anchor": "P1", "payload": p1_url, "leanDeg": 4.0}, 4)
    if want("p1-other"):  # P2's code where P1 stands: "This is a different code (P2)"
        url = f"{base}/a/site/P2"
        manifest["videos"]["p1-other"] = write_video(a.out, "p1-other", "site", site_sheet(P1, url), [lock] * 15,
                                                     {"anchor": "P1", "payload": url, "leanDeg": 0}, 5)
    if want("p1-x"):  # head-on from the X (1.5 m), the filming spot, no lock close first
        manifest["videos"]["p1-x"] = write_video(a.out, "p1-x", "site", site_sheet(P1, p1_url), [lock_cam(1.5, 0.0)] * 15,
                                                 {"anchor": "P1", "payload": p1_url, "leanDeg": 0}, 6)
    for vid in ("P2", "P3", "P4"):  # the other viewpoints: same lock pose, to the code's right-hand side
        name = f"{vid.lower()}-steady"
        if want(name):
            an_v = an[vid]
            Cv = np.asarray(an_v["position_m"], float)
            sh = site_sheet(an_v, f"{base}/a/site/{vid}")
            sv = math.radians(25.0)
            cv = Cv + 0.7 * (math.cos(sv) * sh.ez + math.sin(sv) * sh.ex)
            manifest["videos"][name] = write_video(a.out, name, "site", sh, [(cv, look_rotation(Cv - cv))] * 15,
                                                   {"anchor": vid, "payload": f"{base}/a/site/{vid}", "leanDeg": 0}, 10 + int(vid[1]))
    if want("d1-desk"):
        # D1 flat on a table; the camera 0.35 m from a point between the code and the model, 50 degrees up, from the
        # bottom edge of the page and a little to the right.
        url = f"{base}/a/site/D1"
        target = np.array([-0.06, 0.0, 0.0])
        el, az = math.radians(50), math.radians(-75)
        c = target + 0.35 * np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])
        manifest["videos"]["d1-desk"] = write_video(a.out, "d1-desk", "desk", desk_sheet(D1, url), [(c, look_rotation(target - c))] * 15,
                                                    {"anchor": "D1", "payload": url, "leanDeg": 0}, 7)
    old.write_text(json.dumps(manifest, indent=1))
    print(f"wrote {old}")


if __name__ == "__main__":
    main()
