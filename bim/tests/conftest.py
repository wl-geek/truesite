"""Shared fixtures: the scripted room and the 1 m reference cube, in metres and millimetres."""
from pathlib import Path

import pytest

from truesite_bim import convert, make_demo_model


@pytest.fixture(scope="session")
def built(tmp_path_factory) -> dict[tuple[str, str], tuple[Path, Path]]:
    """{(kind, units): (ifc_path, glb_path)} for kind in room|cube and units in m|mm."""
    tmp = tmp_path_factory.mktemp("built")
    out = {}
    for kind in ("room", "cube"):
        for units in ("m", "mm"):
            builder = make_demo_model.build_ref_cube(units) if kind == "cube" else make_demo_model.build_room(units)
            ifc = tmp / f"{kind}_{units}.ifc"
            builder.write(ifc)
            glb = convert.convert(ifc, tmp / f"{kind}_{units}.glb")
            out[(kind, units)] = (ifc, glb)
    return out
