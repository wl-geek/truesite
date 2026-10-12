"""Storage abstraction: one Protocol, an in-memory implementation for tests and
local dev, and (in store_gcp.py) Firestore + Cloud Storage for Cloud Run.

Methods are synchronous. Call them from `def` endpoints (FastAPI runs those in
its thread pool) or via `await run_in_threadpool(...)` from `async def` ones.

Blob keys always start with the owner's session id
("uploads/<session_id>/<run_id>/photo.jpg"), so serving an image only needs
the caller's session header -- no metadata lookup, no signed URLs.
"""

from __future__ import annotations

import threading
from typing import Any, Protocol, runtime_checkable

from .schemas import CheckRun, Issue

CONTENT_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def blob_key(session_id: str, run_id: str, name: str) -> str:
    return f"uploads/{session_id}/{run_id}/{name}"


def content_type_for(key: str) -> str:
    dot = key.rfind(".")
    return CONTENT_TYPES.get(key[dot:].lower(), "application/octet-stream") if dot >= 0 else "application/octet-stream"


@runtime_checkable
class Store(Protocol):
    # --- abuse cap -----------------------------------------------------
    def try_consume_daily(self, day: str, cap: int) -> tuple[bool, int]:
        """Atomically admit one call if fewer than `cap` were admitted under `day`, a UTC
        "YYYY-MM-DD" optionally followed by a suffix ("2026-10-12" counts checks,
        "2026-10-12-ask" counts questions). Returns (allowed, admitted_so_far)."""
        ...

    # --- check runs ------------------------------------------------------
    def save_check_run(self, run: CheckRun) -> None: ...

    def get_check_run(self, run_id: str, session_id: str) -> CheckRun | None:
        """None if missing *or* owned by another session."""
        ...

    # --- issues ------------------------------------------------------------
    def save_issue(self, issue: Issue) -> None: ...

    def list_issues(self, session_id: str, project_id: str | None = None, limit: int = 200) -> list[Issue]:
        """Issues of exactly this session, newest first."""
        ...

    # --- saved results for sample photos -------------------------------------
    def put_saved_result(self, sample_id: str, result: dict[str, Any]) -> None: ...

    def get_saved_result(self, sample_id: str) -> dict[str, Any] | None: ...

    # --- blobs ------------------------------------------------------------------
    def put_blob(self, key: str, data: bytes, content_type: str) -> str:
        """Store bytes; returns a storage URI (gs://bucket/key or mem://key)."""
        ...

    def get_blob(self, key: str) -> bytes | None: ...


class InMemoryStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.daily: dict[str, int] = {}
        self.runs: dict[str, CheckRun] = {}
        self.issues: dict[str, Issue] = {}
        self.saved: dict[str, dict[str, Any]] = {}
        self.blobs: dict[str, tuple[bytes, str]] = {}

    def try_consume_daily(self, day: str, cap: int) -> tuple[bool, int]:
        with self._lock:
            count = self.daily.get(day, 0)
            if count >= cap:
                return False, count
            self.daily[day] = count + 1
            return True, count + 1

    def save_check_run(self, run: CheckRun) -> None:
        with self._lock:
            self.runs[run.run_id] = run.model_copy(deep=True)

    def get_check_run(self, run_id: str, session_id: str) -> CheckRun | None:
        run = self.runs.get(run_id)
        if run is None or run.session_id != session_id:
            return None
        return run.model_copy(deep=True)

    def save_issue(self, issue: Issue) -> None:
        with self._lock:
            self.issues[issue.id] = issue.model_copy(deep=True)

    def list_issues(self, session_id: str, project_id: str | None = None, limit: int = 200) -> list[Issue]:
        rows = [
            i.model_copy(deep=True)
            for i in self.issues.values()
            if i.session_id == session_id and (project_id is None or i.project_id == project_id)
        ]
        rows.sort(key=lambda i: i.created_at, reverse=True)
        return rows[:limit]

    def put_saved_result(self, sample_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            self.saved[sample_id] = dict(result)

    def get_saved_result(self, sample_id: str) -> dict[str, Any] | None:
        r = self.saved.get(sample_id)
        return None if r is None else dict(r)

    def put_blob(self, key: str, data: bytes, content_type: str) -> str:
        with self._lock:
            self.blobs[key] = (bytes(data), content_type)
        return f"mem://{key}"

    def get_blob(self, key: str) -> bytes | None:
        hit = self.blobs.get(key)
        return None if hit is None else hit[0]
