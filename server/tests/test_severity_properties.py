"""Property tests for severity.severity_for: code sets severity from the element class (spec section 6).

The table is written out here, apart from severity.py, so a class dropped from one of its sets fails.
"""
from __future__ import annotations

from hypothesis import given, settings, strategies as st

from app.schemas import Element
from app.severity import severity_for

HIGH = ["IfcColumn", "IfcBeam", "IfcSlab", "IfcFooting", "IfcMember", "IfcPile", "IfcPlate",
        "IfcReinforcingBar", "IfcReinforcingMesh", "IfcTendon", "IfcRailing"]
WALLS = ["IfcWall", "IfcWallStandardCase"]  # high only when load-bearing
MEDIUM = ["IfcDoor", "IfcWindow", "IfcPipeSegment", "IfcPipeFitting", "IfcDuctSegment", "IfcDuctFitting",
          "IfcFlowSegment", "IfcFlowFitting", "IfcCableCarrierSegment", "IfcOpeningElement"]
DEVIATIONS = ["missing", "misplaced", "different_from_design"]
NOT_DEVIATIONS = ["present_ok", "cannot_judge"]

classes = st.sampled_from(HIGH + WALLS + MEDIUM) | st.text(max_size=24)
load_bearing = st.sampled_from([True, False, None])


def spec_severity(ifc_class: str, bearing: bool | None) -> str:
    if ifc_class in HIGH or (ifc_class in WALLS and bearing is True):
        return "high"
    return "medium" if ifc_class in MEDIUM else "low"


def el(ifc_class: str, bearing: bool | None, **kw) -> Element:
    fields = {"guid": "g" * 22, "name": "x", "storey": "L1", "bbox_m": [[0, 0, 0], [1, 1, 1]], "props": {}, **kw}
    return Element(ifc_class=ifc_class, load_bearing=bearing, **fields)


def test_every_class_in_the_table():
    for ifc_class in HIGH + WALLS + MEDIUM + ["IfcFurniture", "IfcStair", "ifccolumn"]:
        for bearing in (True, False, None):
            for status in DEVIATIONS:
                assert severity_for(el(ifc_class, bearing), status) == spec_severity(ifc_class, bearing), (ifc_class, bearing)
            for status in NOT_DEVIATIONS:
                assert severity_for(el(ifc_class, bearing), status) is None


@settings(max_examples=300, deadline=None)
@given(classes, load_bearing, st.sampled_from(DEVIATIONS + NOT_DEVIATIONS))
def test_severity_follows_the_spec_table(ifc_class, bearing, status):
    expected = spec_severity(ifc_class, bearing) if status in DEVIATIONS else None
    assert severity_for(el(ifc_class, bearing), status) == expected


@settings(max_examples=100, deadline=None)
@given(classes, load_bearing, st.sampled_from(DEVIATIONS), st.text(max_size=30), st.text(max_size=8),
       st.dictionaries(st.text(max_size=8), st.text(max_size=8) | st.booleans(), max_size=3))
def test_severity_depends_only_on_class_load_bearing_and_status(ifc_class, bearing, status, name, storey, props):
    other = el(ifc_class, bearing, guid="h" * 22, name=name, storey=storey, props=props, bbox_m=[[1, 2, 3], [4, 5, 6]])
    assert severity_for(other, status) == severity_for(el(ifc_class, bearing), status)
