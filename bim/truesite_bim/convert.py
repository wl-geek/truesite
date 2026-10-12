"""IFC -> model.glb with element GlobalIds as glTF node names (ifcopenshell 0.9.0 Python API).

Uses ifcopenshell.geom.serializers.gltf, the same C++ glTF serializer IfcConvert uses, so no system
install is needed. The output is byte-identical to
`IfcConvert -y --use-element-guids --weld-vertices model.ifc model.glb` (IfcConvert 0.9.0).

Verified behaviour (tests/test_convert.py):
  * node names are the 22-char IFC GlobalIds ("use-element-guids"); one flat node per element,
    the mesh sits directly on that node (no element hierarchy: element-hierarchy is buggy in 0.9.0).
  * vertices are metres whatever the IFC length unit (mm projects are converted).
  * output is glTF Y-up: glTF (x, y, z) = IFC (X, Z, -Y). The serializer always applies this;
    the "y-up" setting only affects OBJ output.
  * IfcOpeningElement / IfcSpace are excluded (the Python iterator does NOT exclude them by default,
    unlike the IfcConvert CLI); openings are already cut out of their host walls.
  * single-threaded iteration keeps the element order, so the bytes are reproducible.

Usage (from bim/): python -m truesite_bim.convert model.ifc model.glb
"""
from __future__ import annotations

import argparse
import gc
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom

from truesite_bim.glb_reader import read_glb

EXCLUDE = ["IfcOpeningElement", "IfcSpace"]
THREADS = 1  # more threads reorder elements, so the glb bytes would change run to run


def make_settings(world_coords: bool = False) -> ifcopenshell.geom.settings:
    s = ifcopenshell.geom.settings()
    s.set("use-element-guids", True)  # node name = GlobalId (default would be "product-<uuid>-body")
    s.set("use-world-coords", world_coords)  # False: local mesh + node matrix; True: baked vertices
    s.set("apply-default-materials", True)
    s.set("weld-vertices", True)  # no NORMALs; unwelded output fails the Khronos validator
    return s


def convert(ifc_path: str | Path, glb_path: str | Path) -> Path:
    ifc_path, glb_path = Path(ifc_path), Path(glb_path)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    f = ifcopenshell.open(str(ifc_path))
    s = make_settings()
    ser = ifcopenshell.geom.serializers.gltf(str(glb_path), s)
    ser.setFile(f)
    ser.setUnitNameAndMagnitude("METER", 1.0)
    ser.writeHeader()
    it = ifcopenshell.geom.iterator(s, f, THREADS, exclude=EXCLUDE)
    if it.initialize():
        while True:
            ser.write(it.get())
            if not it.next():
                break
    ser.finalize()
    # GOTCHA: the .glb is only written to disk when the C++ serializer object is destroyed.
    del ser, it
    gc.collect()
    if not glb_path.exists() or glb_path.stat().st_size == 0:
        raise RuntimeError(f"glTF serializer produced no output for {ifc_path}")
    return glb_path


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="IFC -> GLB with GlobalIds as node names")
    ap.add_argument("ifc", type=Path)
    ap.add_argument("glb", type=Path)
    a = ap.parse_args(argv)
    out = convert(a.ifc, a.glb)
    nodes = len(read_glb(out)[0].get("nodes", []))
    print(f"wrote {out} ({nodes} elements, {out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
