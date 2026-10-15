"""Read-only access to the BIM pipeline's output: MODELS_DIR/<project_id>/...

  project.json      {"project_id", "name", "check_note"?}; check_note is added to every check prompt
  model.glb         served by GET /api/projects/{project_id}/model.glb
  elements.json     list[Element]
  anchors.json      list[Anchor]
  demo_issues.json  list[IssueIn-shaped dicts], optional; seeded as session "demo" on startup

Files are parsed once per project and cached; a project is parsed again when the mtime of project.json,
elements.json, anchors.json or model.glb changes (a rebuilt model or a new sheet during development).
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
    def __init__(self, project_id: str, name: str, elements: list[Element], anchors: list[Anchor],
                 check_note: str = "") -> None:
        self.manifest = ProjectManifest(
            project_id=project_id,
            name=name,
            model_url=f"/api/projects/{project_id}/model.glb",
            elements=elements,
            anchors=anchors,
        )
        self.by_guid = {e.guid: e for e in elements}
        self.check_note = check_note


class ProjectRepo:
    def __init__(self, models_dir: Path) -> None:
        self.models_dir = Path(models_dir)
        self._cache: dict[str, tuple[tuple[float, ...], _Project]] = {}
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
            d = self._dir(project_id)
            # Reload when any project file changes (a rebuilt model or a new sheet during development).
            stamp = tuple((d / n).stat().st_mtime if (d / n).exists() else 0.0
                          for n in ("project.json", "elements.json", "anchors.json", "model.glb"))
            hit = self._cache.get(project_id)
            if hit is not None and hit[0] == stamp:
                return hit[1]
            meta = json.loads((d / "project.json").read_text(encoding="utf-8"))
            elements = [Element.model_validate(e) for e in json.loads((d / "elements.json").read_text(encoding="utf-8"))]
            anchors = [Anchor.model_validate(a) for a in json.loads((d / "anchors.json").read_text(encoding="utf-8"))]
            note = meta.get("check_note")
            project = _Project(project_id, meta["name"], elements, anchors, note.strip() if isinstance(note, str) else "")
            self._cache[project_id] = (stamp, project)
            return project

    def project_ids(self) -> list[str]:
        if not self.models_dir.is_dir():
            return []
        return sorted(
            p.name for p in self.models_dir.iterdir() if PROJECT_ID_RE.match(p.name) and (p / "project.json").is_file()
        )

    def manifest(self, project_id: str) -> ProjectManifest:
        return self._load(project_id).manifest

    def check_note(self, project_id: str) -> str:
        """Server-side guidance for the check prompt (project.json "check_note"), "" if none."""
        return self._load(project_id).check_note

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
