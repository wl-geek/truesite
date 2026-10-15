import pytest

from app.schemas import Element
from app.severity import severity_for


def el(ifc_class: str, load_bearing: bool | None = None) -> Element:
    return Element(guid="g" * 22, ifc_class=ifc_class, name="x", storey="L1",
                   bbox_m=[[0, 0, 0], [1, 1, 1]], load_bearing=load_bearing, props={})


@pytest.mark.parametrize("status", ["missing", "misplaced", "different_from_design"])
@pytest.mark.parametrize("element,expected", [
    (el("IfcColumn"), "high"),
    (el("IfcBeam"), "high"),
    (el("IfcSlab"), "high"),
    (el("IfcWall", load_bearing=True), "high"),
    (el("IfcWallStandardCase", load_bearing=True), "high"),
    # Reinforcement is structural: a missing or misplaced bar is a structural defect (audit A-65).
    (el("IfcReinforcingBar"), "high"),
    (el("IfcReinforcingMesh"), "high"),
    (el("IfcTendon"), "high"),
    (el("IfcWall", load_bearing=False), "low"),
    (el("IfcWall", load_bearing=None), "low"),
    (el("IfcDoor"), "medium"),
    (el("IfcWindow"), "medium"),
    (el("IfcPipeSegment"), "medium"),
    (el("IfcDuctSegment"), "medium"),
    (el("IfcFurniture"), "low"),
    (el("IfcBuildingElementProxy"), "low"),
])
def test_deviation_severity_by_class(element, expected, status):
    assert severity_for(element, status) == expected


@pytest.mark.parametrize("status", ["present_ok", "cannot_judge"])
def test_no_severity_without_a_deviation(status):
    assert severity_for(el("IfcColumn"), status) is None
