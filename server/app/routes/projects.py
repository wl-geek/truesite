"""GET /api/projects/{project_id} (manifest) and GET /api/projects/{project_id}/model.glb."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from ..deps import RepoDep
from ..projects import UnknownProject
from ..schemas import ProjectManifest

router = APIRouter()

GLB_MEDIA_TYPE = "model/gltf-binary"


def _unknown_project() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "unknown_project"})


@lru_cache(maxsize=32)
def _content_etag(path: str, mtime_ns: int, size: int) -> str:
    # Content hash, so every Cloud Run instance of one image sends the same ETag.
    return '"' + hashlib.sha256(Path(path).read_bytes()).hexdigest()[:32] + '"'


@router.get("/api/projects/{project_id}")
def get_project(project_id: str, repo: RepoDep) -> ProjectManifest:
    try:
        return repo.manifest(project_id)
    except UnknownProject:
        raise _unknown_project() from None


@router.get("/api/projects/{project_id}/model.glb")
def get_model_glb(project_id: str, request: Request, repo: RepoDep) -> Response:
    try:
        path = repo.glb_path(project_id)
    except UnknownProject:
        raise _unknown_project() from None
    st = path.stat()
    etag = _content_etag(str(path), st.st_mtime_ns, st.st_size)
    headers = {"ETag": etag, "Cache-Control": "no-cache"}  # browsers keep it but revalidate (cheap 304)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type=GLB_MEDIA_TYPE, headers=headers)
