"""The container installs server/requirements.txt, not pyproject.toml, so the two must agree."""

import re
import tomllib
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


def _name(spec: str) -> str:
    return re.split(r"[<>=!~;\[ ]", spec, maxsplit=1)[0].strip().lower().replace("_", "-")


def test_every_runtime_dependency_is_pinned_in_requirements_txt():
    deps = tomllib.loads((SERVER / "pyproject.toml").read_text())["project"]["dependencies"]
    pinned = {
        _name(line)
        for line in (SERVER / "requirements.txt").read_text().splitlines()
        if line and not line.startswith((" ", "#"))
    }
    missing = sorted(_name(d) for d in deps if _name(d) not in pinned)
    assert not missing, (
        f"{missing} in pyproject.toml but not in requirements.txt: run "
        "`uv pip compile pyproject.toml --universal --python-version 3.13 --generate-hashes -o requirements.txt` in server/"
    )
