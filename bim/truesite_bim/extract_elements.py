"""IFC -> elements.json (TrueSite data contract, spec section 6).

One entry per element that has body geometry (the same element set convert.py writes to the glb):
  guid, ifc_class, name ("" if unnamed), storey ("" if not in a storey),
  bbox_m [[minX,minY,minZ],[maxX,maxY,maxZ]] (IFC world coords, metres, Z up),
  load_bearing (bool, or null when no pset says), props (flat dict).

props keys:
  "<PsetName>.<Prop>"            property values as-is (text, bool, number)
  "<PsetName>.<Prop>_mm"         length-typed properties, converted to millimetres
  "<QtoName>.<Quantity>_mm|_m2|_m3|_kg|_s"  quantities in fixed units
  "Material"                     material name(s), " / "-joined
  "PredefinedType", "ObjectType", "Type" (type object name) when present

Usage (from bim/): python -m truesite_bim.extract_elements model.ifc elements.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import ifcopenshell.util.unit

from truesite_bim.convert import EXCLUDE

LENGTH_TYPES = {"IfcLengthMeasure", "IfcPositiveLengthMeasure", "IfcNonNegativeLengthMeasure"}


def _r(x: float, nd: int = 4) -> float:
    v = round(float(x), nd)
    return 0.0 if v == 0 else v  # no "-0.0"


def _num(x: float):
    """Tidy a converted number: ints stay ints, otherwise 3 decimals."""
    v = round(float(x), 3)
    return int(v) if v.is_integer() else v


def element_bboxes(f: ifcopenshell.file) -> dict[str, list[list[float]]]:
    """World-space AABB (metres, IFC Z-up) per GlobalId, from the triangulated body geometry."""
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)  # verts come out in metres regardless of the IFC length unit
    out = {}
    it = ifcopenshell.geom.iterator(s, f, 1, exclude=EXCLUDE)
    if it.initialize():
        while True:
            shape = it.get()
            v = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3)
            if len(v):
                out[shape.guid] = [[_r(c) for c in v.min(0)], [_r(c) for c in v.max(0)]]
            if not it.next():
                break
    return out


def flatten_props(f: ifcopenshell.file, element) -> dict:
    lscale = ifcopenshell.util.unit.calculate_unit_scale(f, "LENGTHUNIT")  # project -> m
    ascale = ifcopenshell.util.unit.calculate_unit_scale(f, "AREAUNIT")  # project -> m2
    vscale = ifcopenshell.util.unit.calculate_unit_scale(f, "VOLUMEUNIT")  # project -> m3
    qconv = {
        "IfcQuantityLength": ("mm", lscale * 1000.0),
        "IfcQuantityArea": ("m2", ascale),
        "IfcQuantityVolume": ("m3", vscale),
        "IfcQuantityWeight": ("kg", 1.0),
        "IfcQuantityTime": ("s", 1.0),
    }
    props: dict = {}
    for pset_name, pset in sorted(ue.get_psets(element, verbose=True).items()):
        for prop, meta in pset.items():
            if prop == "id" or not isinstance(meta, dict):
                continue
            cls, val = meta.get("class"), meta.get("value")
            if val is None:
                continue
            if cls in qconv:
                unit, k = qconv[cls]
                props[f"{pset_name}.{prop}_{unit}"] = _num(val * k)
            elif cls == "IfcQuantityCount":
                props[f"{pset_name}.{prop}"] = _num(val)
            elif meta.get("value_type") in LENGTH_TYPES and isinstance(val, (int, float)):
                props[f"{pset_name}.{prop}_mm"] = _num(val * lscale * 1000.0)
            elif isinstance(val, (str, bool, int, float)):
                props[f"{pset_name}.{prop}"] = val
            else:
                props[f"{pset_name}.{prop}"] = str(val)
    mats = [m.Name for m in ue.get_materials(element) if getattr(m, "Name", None)]
    if mats:
        props["Material"] = " / ".join(dict.fromkeys(mats))
    pt = ue.get_predefined_type(element)
    if pt:
        props["PredefinedType"] = pt
    if getattr(element, "ObjectType", None):
        props["ObjectType"] = element.ObjectType
    t = ue.get_type(element)
    if t is not None and t.Name:
        props["Type"] = t.Name
    return props


def storey_name(element) -> str | None:
    s = ue.get_container(element, ifc_class="IfcBuildingStorey")
    if s is None and getattr(element, "FillsVoids", None):  # door/window only related via its host
        host = element.FillsVoids[0].RelatingOpeningElement.VoidsElements[0].RelatingBuildingElement
        s = ue.get_container(host, ifc_class="IfcBuildingStorey")
    return s.Name if s is not None else None


def load_bearing(props: dict):
    vals = [v for k, v in props.items() if k.endswith(".LoadBearing") and isinstance(v, bool)]
    return any(vals) if vals else None


def extract(ifc_path: str | Path) -> list[dict]:
    f = ifcopenshell.open(str(ifc_path))
    boxes = element_bboxes(f)
    out = []
    for guid, bbox in boxes.items():
        e = f.by_guid(guid)
        props = flatten_props(f, e)
        out.append({
            "guid": guid,
            "ifc_class": e.is_a(),
            "name": e.Name or "",
            "storey": storey_name(e) or "",
            "bbox_m": bbox,
            "load_bearing": load_bearing(props),
            "props": props,
        })
    out.sort(key=lambda d: (d["storey"], d["ifc_class"], d["name"], d["guid"]))
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="IFC -> elements.json")
    ap.add_argument("ifc", type=Path)
    ap.add_argument("out", type=Path)
    a = ap.parse_args(argv)
    els = extract(a.ifc)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(els, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {a.out} ({len(els)} elements)")


if __name__ == "__main__":
    main()
