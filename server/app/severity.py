"""Severity of an as-built finding, set by code from the element class (spec section 6).

The model never chooses severity: it only reports what the photo shows.
"""
from __future__ import annotations

from .schemas import Element, Severity, Status

STRUCTURAL_CLASSES = {
    "IfcColumn", "IfcBeam", "IfcSlab", "IfcFooting", "IfcMember", "IfcPile", "IfcPlate",
    "IfcReinforcingBar", "IfcReinforcingMesh", "IfcTendon",  # reinforcement: high severity, but not first for marks
}
WALL_CLASSES = {"IfcWall", "IfcWallStandardCase"}  # structural only when load_bearing is True
OPENINGS_SERVICES = {
    "IfcDoor", "IfcWindow", "IfcPipeSegment", "IfcPipeFitting", "IfcDuctSegment", "IfcDuctFitting",
    "IfcFlowSegment", "IfcFlowFitting", "IfcCableCarrierSegment", "IfcOpeningElement",
}
DEVIATIONS = {"missing", "misplaced", "different_from_design"}


def severity_for(element: Element, status: Status) -> Severity | None:
    if status not in DEVIATIONS:
        return None
    if element.ifc_class in STRUCTURAL_CLASSES or (element.ifc_class in WALL_CLASSES and element.load_bearing is True):
        return "high"
    if element.ifc_class in OPENINGS_SERVICES:
        return "medium"
    return "low"
