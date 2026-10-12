"""Serve the built single-page app from the same origin as the API.

Rules (all covered by tests/test_spa.py):
  * a real file under dist/ is served as-is (favicon, sample photos, models, ...)
  * /assets/*   -> hashed Vite output, cached for a year; a missing file is a
                   real 404 (never index.html, or a stale lazy chunk would be
                   "loaded" as HTML and fail with a confusing MIME error)
  * /api, /api/* -> never falls back; unknown API paths are a JSON 404
  * anything else (/, /a/{project}/{anchor}, /viewer, ...) -> index.html

Path safety (`..`, absolute paths, symlinks out of the dir) comes from
Starlette's StaticFiles.lookup_path, which this class reuses.
"""

from __future__ import annotations

import mimetypes
import os

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# python:3.13-slim has no /etc/mime.types entries for these; Starlette would
# otherwise send text/plain.
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")
mimetypes.add_type("font/woff2", ".woff2")

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"  # browser may store it, but must revalidate (ETag) each time


def _first_segment(path: str) -> str:
    # `path` arrives normalised by StaticFiles.get_path(): OS separators, no
    # leading slash, "." for the root.
    return path.replace(os.sep, "/").split("/", 1)[0]


class SPAStaticFiles(StaticFiles):
    def __init__(self, *, directory: str | os.PathLike[str], index: str = "index.html") -> None:
        # html=False: we do our own index fallback; html=True would add
        # directory redirects and 404.html handling we don't want.
        super().__init__(directory=directory, html=False, check_dir=True)
        self.index = index

    async def get_response(self, path: str, scope: Scope) -> Response:
        first = _first_segment(path)
        raw = scope.get("path", "")
        if first == "api" or raw == "/api" or raw.startswith("/api/"):
            # Any method, any /api path that no API route matched -- checked on the raw path too,
            # because `path` is normalised ("/api/x/..%2f..%2fetc" would become "etc").
            raise HTTPException(status_code=404)

        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or first == "assets":
                raise
            response = await super().get_response(self.index, scope)
            response.headers["Cache-Control"] = REVALIDATE
            return response

        if first == "assets" and response.status_code in (200, 304):
            response.headers["Cache-Control"] = IMMUTABLE
        else:
            response.headers.setdefault("Cache-Control", REVALIDATE)
        return response
