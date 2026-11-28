"""The site-objects pass (app/scene.py): the geometry that says which objects stand at an element's outline."""
from __future__ import annotations

from app import scene, verify

COLUMN = [200, 400, 800, 440]  # a tall outline: 600 high, 40 wide


def obj(label: str, box: list[int], solid: bool = True) -> dict:
    return {"label": label, "kind": "materials", "box": box, "solid": solid}


def test_in_front_says_how_much_of_the_outline_an_object_covers_and_where() -> None:
    found = scene.in_front([obj("pallet of blocks", [650, 380, 820, 470]), obj("scaffold tower", [0, 0, 1000, 1000], False),
                            obj("far cone", [900, 900, 950, 950])], COLUMN)
    assert found == [
        {"what": "scaffold tower", "solid": False, "covers": "all of the outline"},
        {"what": "pallet of blocks", "solid": True, "covers": "about a third of the outline, its lower part"},
    ]


def test_in_front_names_an_object_standing_just_beside_the_outline() -> None:
    assert scene.in_front([obj("plywood sheets", [300, 445, 800, 500])], COLUMN) == [
        {"what": "plywood sheets", "solid": True, "beside": "right"}]
    assert scene.in_front([obj("mixer", [300, 600, 800, 700])], COLUMN) == []  # too far to matter


def test_hidden_share_counts_only_solid_objects() -> None:
    assert scene.hidden_share([obj("tarp", [200, 400, 500, 440]), obj("tube", [0, 0, 1000, 1000], False)], COLUMN) == 0.5


def test_clean_objects_drops_what_cannot_be_used() -> None:
    raw = {"objects": [{"label": "  a   pallet ", "kind": "materials", "box": [10, 20, 300, 400], "solid": True},
                       {"label": "no box"}, {"label": "flat", "box": [5, 5, 5, 90]}, "junk"]}
    assert scene.clean_objects(raw) == [{"label": "a pallet", "kind": "materials", "box": [10, 20, 300, 400], "solid": True}]
    assert scene.clean_objects(None) == []


def test_a_close_up_that_sees_none_of_the_element_makes_it_cannot_judge() -> None:
    first = {"mark": 1, "status": "present_ok", "confidence": 0.95, "evidence_box": [0, 0, 0, 0],
             "offset": {"direction": "none", "approx_cm": 0}, "explanation": "first pass"}
    verdict = {"hidden_by": "a pallet of blocks", "visible": "none", "material_seen": "concrete blocks",
               "status": "cannot_judge", "confidence": 0.6, "offset": {"direction": "none", "approx_cm": 0}, "explanation": ""}
    changed, note = verify.merge(first, verdict, "both")
    assert changed["status"] == "cannot_judge" and note == "present_ok -> cannot_judge (hidden by a pallet of blocks)"
    assert changed["explanation"] == "Hidden by a pallet of blocks from this spot. Check it from another viewpoint."
    flagged, note = verify.merge({**first, "status": "missing"}, verdict, "both")
    assert flagged["status"] == "cannot_judge" and note.startswith("missing -> cannot_judge (hidden by")
    assert verify.merge(first, {**verdict, "visible": "part", "status": "present_ok"}, "both")[0] is None


def test_an_outline_that_is_free_to_see_and_empty_stays_missing() -> None:
    first = {"mark": 1, "status": "present_ok", "confidence": 0.9, "evidence_box": [0, 0, 0, 0],
             "offset": {"direction": "none", "approx_cm": 0}, "explanation": "first pass"}
    empty = {"hidden_by": "", "visible": "none", "material_seen": "sky", "status": "missing", "confidence": 0.95,
             "offset": {"direction": "none", "approx_cm": 0}, "explanation": "The outline encloses only sky."}
    changed, note = verify.merge(first, empty, "both")
    assert changed["status"] == "missing" and note == "present_ok -> missing"
    # but an outline wholly covered by a named site object cannot be called missing
    assert verify.merge(first, {**empty, "hidden_by": "a tarp"}, "both")[0]["status"] == "cannot_judge"


def test_a_missing_behind_a_site_object_that_covers_half_the_outline_becomes_cannot_judge() -> None:
    first = {"mark": 1, "status": "missing", "confidence": 0.9, "evidence_box": [0, 0, 0, 0],
             "offset": {"direction": "none", "approx_cm": 0}, "explanation": "first pass"}
    look = {"hidden_by": "a worker", "visible": "part", "material_seen": "ground", "status": "missing", "confidence": 0.95,
            "offset": {"direction": "none", "approx_cm": 0}, "explanation": "No footing shows around the worker."}
    changed, note = verify.merge(first, look, "both")
    assert changed["status"] == "cannot_judge" and note == "missing -> cannot_judge (hidden by a worker)"
    assert changed["explanation"] == "Partly hidden by a worker from this spot. Check it from another viewpoint."
    assert verify.merge(first, {**look, "visible": "most"}, "both")[0] is None  # most of it shows: the flag stands
    assert verify.merge(first, {**look, "status": "misplaced"}, "both")[0]["status"] == "cannot_judge"  # looks disagree
