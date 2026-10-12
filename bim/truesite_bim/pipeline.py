"""Offline BIM pipeline: IFC -> models/<project>/{model.ifc, model.glb, elements.json}.

The web app joins glb nodes to elements.json rows by GUID, so the pipeline refuses to write
anything when the two GUID sets differ. Other files in the output directory (anchors.json,
project.json, demo_issues.json) are left alone; anchors.json comes from qr_sheets.py.

Usage (from bim/): python -m truesite_bim.pipeline models/room1/model.ifc --out models/room1
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from truesite_bim import convert, extract_elements
from truesite_bim.glb_reader import read_glb


class GuidMismatch(RuntimeError):
    """The glb node names and the elements.json GUIDs are not the same set."""


def glb_guids(glb: Path) -> list[str]:
    j, _ = read_glb(glb)
    return [n["name"] for n in j.get("nodes", []) if "name" in n]


def run(ifc: Path, out_dir: Path) -> dict:
    ifc, out_dir = Path(ifc), Path(out_dir)
    with tempfile.TemporaryDirectory() as tmp:
        glb_tmp = convert.convert(ifc, Path(tmp) / "model.glb")
        els = extract_elements.extract(ifc)
        in_glb, in_json = set(glb_guids(glb_tmp)), {e["guid"] for e in els}
        if in_glb != in_json:
            raise GuidMismatch(f"GUID mismatch: only in glb {sorted(in_glb - in_json)}, "
                               f"only in elements.json {sorted(in_json - in_glb)}")
        out_dir.mkdir(parents=True, exist_ok=True)
        if ifc.resolve() != (out_dir / "model.ifc").resolve():
            shutil.copyfile(ifc, out_dir / "model.ifc")
        shutil.copyfile(glb_tmp, out_dir / "model.glb.part")
        os.replace(out_dir / "model.glb.part", out_dir / "model.glb")
    (out_dir / "elements.json").write_text(json.dumps(els, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"elements": len(els), "glb_nodes": len(in_glb), "out": str(out_dir)}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="IFC -> model.glb + elements.json (GUID-joined)")
    ap.add_argument("ifc", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    try:
        print(json.dumps(run(a.ifc, a.out)))
    except GuidMismatch as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
