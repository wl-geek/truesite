"""One contract for every Store implementation (the in-memory one here; Firestore + GCS in Task 5)."""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.schemas import CheckRun, Issue
from app.store import InMemoryStore, Store, blob_key

T0 = datetime(2026, 10, 15, 8, 0, tzinfo=timezone.utc)


@pytest.fixture(params=["memory"])
def any_store(request) -> Store:
    return InMemoryStore()


def _issue(session: str, title: str, minutes: int = 0, project: str = "room1") -> Issue:
    return Issue(
        id=uuid.uuid4().hex,
        session_id=session,
        project_id=project,
        guid="2O2Fr$t4X7Zf8NOew3FLOH",
        title=title,
        severity="medium",
        crop_box=[1, 2, 3, 4],
        created_at=T0 + timedelta(minutes=minutes),
    )


def test_store_satisfies_protocol(any_store: Store) -> None:
    assert isinstance(any_store, Store)


def test_blob_key() -> None:
    assert blob_key("s1", "run123", "photo.jpg") == "uploads/s1/run123/photo.jpg"


def test_daily_counter_caps_and_is_per_day(any_store: Store) -> None:
    assert any_store.try_consume_daily("2026-10-15", 3) == (True, 1)
    assert any_store.try_consume_daily("2026-10-15", 3) == (True, 2)
    assert any_store.try_consume_daily("2026-10-15", 3) == (True, 3)
    assert any_store.try_consume_daily("2026-10-15", 3) == (False, 3)
    assert any_store.try_consume_daily("2026-10-16", 3) == (True, 1)


def test_daily_counter_keys_with_a_suffix_are_separate(any_store: Store) -> None:
    assert any_store.try_consume_daily("2026-10-15-ask", 1) == (True, 1)
    assert any_store.try_consume_daily("2026-10-15-ask", 1) == (False, 1)
    assert any_store.try_consume_daily("2026-10-15", 1) == (True, 1)


def test_daily_counter_is_atomic_under_concurrency(any_store: Store) -> None:
    cap, workers, per_worker = 7, 8, 3
    results: list[bool] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def worker() -> None:
        for _ in range(per_worker):
            try:
                ok, _ = any_store.try_consume_daily("2026-10-17", cap)
            except BaseException as exc:  # must not happen: no transaction to abort
                with lock:
                    errors.append(exc)
                continue
            with lock:
                results.append(ok)

    threads = [threading.Thread(target=worker) for _ in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert results.count(True) == cap
    assert len(results) == workers * per_worker
    assert any_store.try_consume_daily("2026-10-17", cap) == (False, cap)


def test_check_run_roundtrip_and_scoping(any_store: Store) -> None:
    run = CheckRun(
        run_id="r" * 22,
        session_id="s1",
        project_id="room1",
        anchor_id="A1",
        created_at=T0,
        context={"visible": [{"mark": 1, "box": [0, 0, 10, 10]}]},
        result={"findings": [{"mark": 1, "status": "missing", "confidence": 0.8}], "summary": "x"},
        photo_key="uploads/s1/r/photo.jpg",
        render_key="uploads/s1/r/render.png",
    )
    any_store.save_check_run(run)
    got = any_store.get_check_run(run.run_id, "s1")
    assert got is not None
    assert got.result == run.result
    assert got.context == run.context
    assert got.created_at == T0
    assert any_store.get_check_run(run.run_id, "s2") is None
    assert any_store.get_check_run("missing", "s1") is None


def test_issues_filtered_by_session_and_project_newest_first(any_store: Store) -> None:
    any_store.save_issue(_issue("a", "a-old", 0))
    any_store.save_issue(_issue("a", "a-new", 5))
    any_store.save_issue(_issue("a", "a-desk", 3, project="desk"))
    any_store.save_issue(_issue("b", "b-1", 1))
    any_store.save_issue(_issue("demo", "demo-1", 2))

    assert [i.title for i in any_store.list_issues("a")] == ["a-new", "a-desk", "a-old"]
    assert [i.title for i in any_store.list_issues("a", "room1")] == ["a-new", "a-old"]
    assert [i.title for i in any_store.list_issues("b")] == ["b-1"]
    assert [i.title for i in any_store.list_issues("demo")] == ["demo-1"]
    assert any_store.list_issues("nobody") == []
    assert len(any_store.list_issues("a", limit=1)) == 1
    got = any_store.list_issues("a", "room1")[0]
    assert got.crop_box == [1, 2, 3, 4] and got.severity == "medium" and got.created_at == T0 + timedelta(minutes=5)


def test_save_issue_upserts_by_id(any_store: Store) -> None:
    issue = _issue("demo", "v1")
    any_store.save_issue(issue)
    any_store.save_issue(issue.model_copy(update={"title": "v2"}))
    assert [i.title for i in any_store.list_issues("demo")] == ["v2"]


def test_saved_results(any_store: Store) -> None:
    assert any_store.get_saved_result("room1-01") is None
    any_store.put_saved_result("room1-01", {"summary": "v1", "saved_at": "2026-10-15T08:00:00+00:00"})
    any_store.put_saved_result("room1-01", {"summary": "v2", "saved_at": "2026-10-15T09:00:00+00:00"})
    assert any_store.get_saved_result("room1-01") == {"summary": "v2", "saved_at": "2026-10-15T09:00:00+00:00"}


def test_blobs(any_store: Store) -> None:
    key = blob_key("s1", "run123", "photo.jpg")
    uri = any_store.put_blob(key, b"\xff\xd8\xffdata", "image/jpeg")
    assert uri.endswith(key)
    assert any_store.get_blob(key) == b"\xff\xd8\xffdata"
    assert any_store.get_blob(blob_key("s2", "run123", "photo.jpg")) is None
