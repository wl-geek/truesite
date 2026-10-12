"""Read-only access to the BIM pipeline's output: MODELS_DIR/<project_id>/...

  project.json      {"project_id", "name"}
  model.glb         served by GET /api/projects/{project_id}/model.glb
  elements.json     list[Element]
  anchors.json      list[Anchor]
  demo_issues.json  list[IssueIn-shaped dicts], optional; seeded as session "demo" on startup

Files are parsed once per project and cached (they only change with a new deploy).
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from .schemas import PROJECT_ID_RE, Anchor, Element, ProjectManifest


class UnknownProject(Exception):
    """No such project directory (or an id that can never be one)."""


class UnknownElement(Exception):
    """The project has no element with that GUID."""


class _Project:
    def __init__(self, project_id: str, name: str, elements: list[Element], anchors: list[Anchor]) -> None:
        self.manifest = ProjectManifest(
            project_id=project_id,
            name=name,
            model_url=f"/api/projects/{project_id}/model.glb",
            elements=elements,
            anchors=anchors,
        )
        self.by_guid = {e.guid: e for e in elements}


class ProjectRepo:
    def __init__(self, models_dir: Path) -> None:
        self.models_dir = Path(models_dir)
        self._cache: dict[str, _Project] = {}
        self._lock = threading.Lock()

    def _dir(self, project_id: str) -> Path:
        # The pattern check also blocks path tricks ("..", "/", "\\") before touching the disk.
        if not PROJECT_ID_RE.match(project_id):
            raise UnknownProject(project_id)
        d = self.models_dir / project_id
        if not (d / "project.json").is_file():
            raise UnknownProject(project_id)
        return d

    def _load(self, project_id: str) -> _Project:
        with self._lock:
            hit = self._cache.get(project_id)
            if hit is not None:
                return hit
            d = self._dir(project_id)
            meta = json.loads((d / "project.json").read_text(encoding="utf-8"))
            elements = [Element.model_validate(e) for e in json.loads((d / "elements.json").read_text(encoding="utf-8"))]
            anchors = [Anchor.model_validate(a) for a in json.loads((d / "anchors.json").read_text(encoding="utf-8"))]
            project = _Project(project_id, meta["name"], elements, anchors)
            self._cache[project_id] = project
            return project

    def project_ids(self) -> list[str]:
        if not self.models_dir.is_dir():
            return []
        return sorted(
            p.name for p in self.models_dir.iterdir() if PROJECT_ID_RE.match(p.name) and (p / "project.json").is_file()
        )

    def manifest(self, project_id: str) -> ProjectManifest:
        return self._load(project_id).manifest

    def elements_by_guid(self, project_id: str) -> dict[str, Element]:
        return dict(self._load(project_id).by_guid)

    def element(self, project_id: str, guid: str) -> Element:
        element = self._load(project_id).by_guid.get(guid)
        if element is None:
            raise UnknownElement(guid)
        return element

    def glb_path(self, project_id: str) -> Path:
        path = self._dir(project_id) / "model.glb"
        if not path.is_file():
            raise UnknownProject(project_id)
        return path

    def demo_issues(self, project_id: str) -> list[dict[str, Any]]:
        path = self._dir(project_id) / "demo_issues.json"
        if not path.is_file():
            return []
        return json.loads(path.read_text(encoding="utf-8"))
