"""Every relative link in the README and the docs we hand to judges points at a real file."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = [ROOT / "README.md", ROOT / "DEVELOPMENT.md", ROOT / "docs/submission-checklist.md",
        *sorted((ROOT / "docs/specs").glob("*.md")), *sorted((ROOT / "docs/plans").glob("*.md")),
        ROOT / "docs/research/reference/README.md"]
LINK = re.compile(r"\]\(([^)\s]+)\)|src=\"([^\"]+)\"")


def relative_links(text: str) -> list[str]:
    text = re.sub(r"```.*?```", "", text, flags=re.S)  # ignore code blocks
    links = [a or b for a, b in LINK.findall(text)]
    return [link.split("#")[0] for link in links if not re.match(r"^(https?:|mailto:|#)", link) and link.split("#")[0]]


@pytest.mark.parametrize("doc", DOCS, ids=lambda p: str(p.relative_to(ROOT)))
def test_relative_links_resolve(doc: Path):
    missing = [link for link in relative_links(doc.read_text(encoding="utf-8")) if not (doc.parent / link).exists()]
    assert missing == []
