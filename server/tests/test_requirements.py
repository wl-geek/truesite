"""The container installs server/requirements.txt, not pyproject.toml, so the two must agree."""

import re
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest

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


# The names above, and the versions too: every package the image installs, transitive ones included, is the one
# uv.lock tests against (a Dependabot bump of uv.lock fails here until requirements.txt is regenerated).
PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==([^\s;\\]+)", re.M)


def pins(text: str) -> dict[str, str]:
    """{normalised name: version} for every `name==version` line of a requirements file."""
    return {re.sub(r"[-_.]+", "-", name).lower(): version for name, version in PIN.findall(text)}


def test_pins_reads_names_extras_and_markers():
    text = "Foo_Bar==1.2 \\\n    --hash=sha256:ab\nuvicorn[standard]==0.54.0\ncolorama==0.4.6 ; sys_platform == 'win32'\n# x==1\n"
    assert pins(text) == {"foo-bar": "1.2", "uvicorn": "0.54.0", "colorama": "0.4.6"}


@pytest.mark.skipif(shutil.which("uv") is None, reason="needs uv")
def test_requirements_txt_pins_the_versions_in_uv_lock():
    locked = subprocess.run(
        ["uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--format", "requirements-txt"],
        cwd=SERVER, capture_output=True, text=True, check=True,
    ).stdout
    assert pins((SERVER / "requirements.txt").read_text()) == pins(locked)
