from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_MODELS_DIR
from app.projects import ProjectRepo, UnknownElement, UnknownProject
from app.schemas import IssueIn

from .conftest import GLB, GUID_DOOR, GUID_WALL, write_project


# ---- ProjectRepo ------------------------------------------------------------------------------
def test_manifest(models: Path) -> None:
    m = ProjectRepo(models).manifest("testproj")
    assert (m.project_id, m.name, m.model_url) == ("testproj", "Test project", "/api/projects/testproj/model.glb")
    assert [e.guid for e in m.elements] == [GUID_WALL, GUID_DOOR]
    assert [a.anchor_id for a in m.anchors] == ["A1", "D1"]
    assert m.anchors[1].label == ""  # optional in anchors.json
    assert m.elements[1].load_bearing is None


def test_elements_lookup(models: Path) -> None:
    repo = ProjectRepo(models)
    by_guid = repo.elements_by_guid("testproj")
    assert set(by_guid) == {GUID_WALL, GUID_DOOR}
    by_guid.clear()  # callers get a copy
    assert repo.element("testproj", GUID_DOOR).name == "Door D-01"
    with pytest.raises(UnknownElement):
        repo.element("testproj", "0000000000000000000000")


@pytest.mark.parametrize("bad", ["nope", "", "..", "../models", "TestProj", "a/b", "x" * 33])
def test_unknown_projects(models: Path, bad: str) -> None:
    repo = ProjectRepo(models)
    with pytest.raises(UnknownProject):
        repo.manifest(bad)
    with pytest.raises(UnknownProject):
        repo.glb_path(bad)
    with pytest.raises(UnknownProject):
        repo.demo_issues(bad)


def test_glb_path_and_missing_glb(models: Path) -> None:
    repo = ProjectRepo(models)
    assert repo.glb_path("testproj").read_bytes() == GLB
    (models / "testproj" / "model.glb").unlink()
    with pytest.raises(UnknownProject):
        repo.glb_path("testproj")


def test_project_ids_and_demo_issues(models: Path) -> None:
    write_project(models, "second", demo_issues=None)
    (models / "not-a-project").mkdir()
    repo = ProjectRepo(models)
    assert repo.project_ids() == ["second", "testproj"]
    assert [i["title"] for i in repo.demo_issues("testproj")][0] == "Door D-01 about 30 cm left of design"
    assert repo.demo_issues("second") == []
    assert ProjectRepo(models / "missing").project_ids() == []


def test_the_committed_site_project_loads() -> None:
    repo = ProjectRepo(DEFAULT_MODELS_DIR)
    assert repo.project_ids() == ["site"]  # room1 and rooftop are gone
    m = repo.manifest("site")
    assert (m.name, len(m.elements)) == ("Building under construction (1:1)", 191)
    assert {"IfcColumn", "IfcBeam", "IfcSlab", "IfcRailing"} <= {e.ifc_class for e in m.elements}
    assert repo.element("site", "2yDJKtbhvGCf3rD5NKl0fK").name == "Beam A1-A2"
    assert [a.anchor_id for a in m.anchors] == ["P1", "P2", "P3", "P4", "D1"]
    assert [a.scale for a in m.anchors] == [1.0, 1.0, 1.0, 1.0, 0.01]  # P1-P4 upright at 1:1, D1 a 1:100 desk sheet
    assert repo.glb_path("site").read_bytes()[:4] == b"glTF"
    issues = [IssueIn.model_validate(row) for row in repo.demo_issues("site")]
    assert all(i.guid in repo.elements_by_guid("site") for i in issues)


# ---- HTTP ----------------------------------------------------------------------------------------
def test_get_project(client: TestClient) -> None:
    r = client.get("/api/projects/testproj")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"project_id", "name", "model_url", "elements", "anchors"}
    assert body["model_url"] == "/api/projects/testproj/model.glb"
    assert body["elements"][0]["props"]["Qto_WallBaseQuantities.Width_mm"] == 100
    assert body["anchors"][0] == {"anchor_id": "A1", "project_id": "testproj", "qr_size_m": 0.23,
                                  "position_m": [2.4, 0.0, 1.2], "normal": [0.0, -1.0, 0.0], "up": [0.0, 0.0, 1.0],
                                  "scale": 1.0, "label": "Wall"}


@pytest.mark.parametrize("path", ["/api/projects/nope", "/api/projects/nope/model.glb", "/api/projects/TESTPROJ",
                                  "/api/projects/TESTPROJ/model.glb", "/api/projects/te..st"])
def test_unknown_project_is_404(client: TestClient, path: str) -> None:
    r = client.get(path)
    assert r.status_code == 404
    assert r.json() == {"detail": {"code": "unknown_project"}}


def test_model_glb_with_etag_revalidation(client: TestClient) -> None:
    r = client.get("/api/projects/testproj/model.glb")
    assert r.status_code == 200
    assert r.content == GLB
    assert r.headers["content-type"] == "model/gltf-binary"
    assert r.headers["cache-control"] == "no-cache"
    etag = r.headers["etag"]
    assert etag.startswith('"') and len(etag) == 34
    again = client.get("/api/projects/testproj/model.glb", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    stale = client.get("/api/projects/testproj/model.glb", headers={"If-None-Match": '"old"'})
    assert stale.status_code == 200


def test_model_glb_is_gzipped_when_asked(client: TestClient) -> None:
    r = client.get("/api/projects/testproj/model.glb", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip" and r.content == GLB


def test_wrong_method_is_json_404(client: TestClient) -> None:
    r = client.post("/api/projects/testproj")
    assert r.status_code == 404 and r.headers["content-type"] == "application/json"


def test_the_committed_site_project_has_a_check_note() -> None:
    # The site photos are taken from up to 10 m away: the code is small or out of frame, and the other
    # boards, vehicles and background buildings must not come back as unexpected (B-07).
    note = ProjectRepo(DEFAULT_MODELS_DIR).check_note("site")
    assert "marker_far" in note and "unexpected" in note
    assert all(word in note for word in ("QR boards", "vehicles", "buildings"))


def test_check_note_comes_from_project_json(models) -> None:
    import json as _json
    assert ProjectRepo(models).check_note("testproj") == ""
    (models / "testproj" / "project.json").write_text(
        _json.dumps({"project_id": "testproj", "name": "Test project", "check_note": "  Setting-out check.  "}))
    assert ProjectRepo(models).check_note("testproj") == "Setting-out check."
    with pytest.raises(UnknownProject):
        ProjectRepo(models).check_note("nope")


def test_a_changed_anchors_file_is_picked_up(models) -> None:
    import json as _json
    import os
    repo = ProjectRepo(models)
    assert [a.anchor_id for a in repo.manifest("testproj").anchors] == ["A1", "D1"]
    path = models / "testproj" / "anchors.json"
    rows = _json.loads(path.read_text())
    rows.append({**rows[0], "anchor_id": "R9"})
    path.write_text(_json.dumps(rows))
    st = path.stat()
    os.utime(path, (st.st_atime, st.st_mtime + 5))  # make sure the mtime moves even on coarse clocks
    assert [a.anchor_id for a in repo.manifest("testproj").anchors] == ["A1", "D1", "R9"]
