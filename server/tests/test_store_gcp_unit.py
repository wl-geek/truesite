"""FirestoreGcsStore against the in-memory Firestore stand-in (tests/fake_gcp.py), so the
production store runs in `make test`. The shared behaviour is in test_store_contract.py
(params "fake-gcp" and, with FIRESTORE_EMULATOR_HOST set, "gcp"); this file checks what
only the Firestore store does: document ids, expire_at, and the routes that use it."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.schemas import CheckRun, Issue
from app.store_gcp import FirestoreGcsStore

from .conftest import GUID_DOOR, GUID_WALL, new_session
from .fake_gcp import FakeFirestore, FakeStorage

T0 = datetime(2026, 10, 15, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
def fake_db() -> FakeFirestore:
    return FakeFirestore()


@pytest.fixture
def store(fake_db: FakeFirestore) -> FirestoreGcsStore:
    """Overrides conftest's InMemoryStore, so make_client/client run on the Firestore store."""
    return FirestoreGcsStore(bucket="truesite-test", firestore_client=fake_db, storage_client=FakeStorage())


def test_ask_key_is_its_own_counter_and_expires_30_days_after_its_date(store, fake_db) -> None:
    assert store.try_consume_daily("2026-10-15-ask", 1) == (True, 1)
    assert store.try_consume_daily("2026-10-15-ask", 1) == (False, 1)
    assert store.try_consume_daily("2026-10-15", 1) == (True, 1)
    usage = fake_db.docs["usage"]
    assert set(usage) == {"2026-10-15-ask", "2026-10-15"}  # the full key is the document id
    assert usage["2026-10-15-ask"]["checks"] == 2  # counts attempts
    assert usage["2026-10-15-ask"]["expire_at"] == datetime(2026, 11, 14, tzinfo=timezone.utc)
    assert usage["2026-10-15"]["expire_at"] == datetime(2026, 11, 14, tzinfo=timezone.utc)


def test_cap_check_is_one_write(store, fake_db) -> None:
    store.try_consume_daily("2026-10-15", 3)
    assert fake_db.writes == 1


def test_runs_and_issues_carry_expire_at(store, fake_db) -> None:
    run = CheckRun(run_id="r" * 22, session_id="s1", project_id="room1", anchor_id="A1", created_at=T0,
                   context={"visible": [{"mark": 1, "box": [0, 0, 10, 10]}]}, result={"findings": []},
                   photo_key="uploads/s1/r/photo.jpg", render_key="uploads/s1/r/render.png")
    store.save_check_run(run)
    issue = Issue(id=uuid.uuid4().hex, session_id="s1", project_id="room1", guid=GUID_WALL, title="t",
                  created_at=T0)
    store.save_issue(issue)
    assert fake_db.docs["check_runs"]["r" * 22]["expire_at"] == T0 + timedelta(days=30)
    assert fake_db.docs["issues"][issue.id]["expire_at"] == T0 + timedelta(days=30)


def test_listing_issues_reads_at_most_200_documents(store, fake_db) -> None:
    for minutes in range(3):
        store.save_issue(Issue(id=uuid.uuid4().hex, session_id="s1", project_id="room1", guid=GUID_WALL,
                               title=f"t{minutes}", created_at=T0 + timedelta(minutes=minutes)))
    assert [i.title for i in store.list_issues("s1", "room1")] == ["t2", "t1", "t0"]
    assert [i.title for i in store.list_issues("s1", limit=2)] == ["t2", "t1"]
    assert fake_db.query_limits and max(fake_db.query_limits) <= 200  # was 500 per GET (A-24)


def test_a_run_id_with_a_slash_is_a_422_not_a_firestore_500(client) -> None:
    body = {"project_id": "testproj", "guid": GUID_WALL, "title": "t", "run_id": "a/b" * 6}
    assert client.post("/api/issues", json=body, headers={"X-Session-Id": new_session()}).status_code == 422


def test_saved_result_gets_a_server_timestamp(store, fake_db) -> None:
    store.put_saved_result("room1-01", {"summary": "s"})
    doc = fake_db.docs["saved_results"]["room1-01"]
    assert doc["result"] == {"summary": "s"} and isinstance(doc["saved_at"], datetime)
    assert store.get_saved_result("room1-01") == {"summary": "s"}


def test_ask_route_works_on_the_firestore_store(client) -> None:
    r = client.post("/api/ask", json={"project_id": "testproj", "guid": GUID_WALL, "question": "Fire rating?"},
                    headers={"X-Session-Id": new_session()})
    assert r.status_code == 200, r.text


def test_check_draft_and_issue_routes_work_on_the_firestore_store(client, fake_db) -> None:
    from .test_issues_route import check_run

    session = new_session()
    run_id, mark = check_run(client, session)
    r = client.post("/api/issues/draft", json={"run_id": run_id, "mark": mark}, headers={"X-Session-Id": session})
    assert r.status_code == 200, r.text
    body = {"project_id": "testproj", "guid": GUID_DOOR, "run_id": run_id, "finding_ref": f"{run_id}:{mark}",
            "title": "Door D-01 about 30 cm right", "severity": "medium"}
    assert client.post("/api/issues", json=body, headers={"X-Session-Id": session}).status_code == 201
    listed = client.get("/api/issues", headers={"X-Session-Id": session}).json()
    assert [i["title"] for i in listed["issues"]] == ["Door D-01 about 30 cm right"]
    assert set(fake_db.docs["usage"]) == {"2026-10-15", "2026-10-15-ask"}
