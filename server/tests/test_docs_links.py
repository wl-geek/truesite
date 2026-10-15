"""Every relative link in the README and the docs we hand to judges points at a real file."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
# Every doc, so a new one (like docs/BRIEF.md) is checked without anyone remembering to list it.
DOCS = [ROOT / "README.md", ROOT / "DEVELOPMENT.md", *sorted((ROOT / "docs").rglob("*.md"))]
LINK = re.compile(r"\]\(([^)\s]+)\)|src=\"([^\"]+)\"")


def relative_links(text: str) -> list[str]:
    text = re.sub(r"```.*?```", "", text, flags=re.S)  # ignore code blocks
    links = [a or b for a, b in LINK.findall(text)]
    return [link.split("#")[0] for link in links if not re.match(r"^(https?:|mailto:|#)", link) and link.split("#")[0]]


@pytest.mark.parametrize("doc", DOCS, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_relative_links_resolve(doc: Path):
    missing = [link for link in relative_links(doc.read_text(encoding="utf-8")) if not (doc.parent / link).exists()]
    assert missing == []


# Generated, git-ignored folders the README may name: they exist only after a build or a deploy.
GENERATED = {"web/public/sheets", "web/dist"}


def backticked_repo_paths(text: str, top_level: set[str]) -> list[str]:
    """`code` spans that look like a path from the repo root (first segment is a top-level entry)."""
    spans = re.findall(r"`([^`\s]+)`", re.sub(r"```.*?```", "", text, flags=re.S))
    return [s.rstrip("/") for s in spans if "/" in s and "<" not in s and s.split("/")[0] in top_level]


@pytest.mark.skipif(shutil.which("git") is None, reason="needs git")
def test_readme_code_paths_are_in_the_repo():
    # Judges read paths in the README as "this is in the repo": a git-ignored file never is.
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    known = set(tracked) | {"/".join(t.split("/")[:i]) for t in tracked for i in range(1, t.count("/") + 1)} | GENERATED
    top_level = {t.split("/")[0] for t in tracked}
    paths = backticked_repo_paths((ROOT / "README.md").read_text(encoding="utf-8"), top_level)
    assert paths  # the README does name repo paths; an empty list would mean the pattern broke
    assert [p for p in paths if p not in known] == []
