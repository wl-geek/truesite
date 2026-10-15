"""In-memory stand-ins for the parts of google-cloud-firestore and google-cloud-storage
that FirestoreGcsStore calls, so its Firestore half runs in `make test` without the
emulator or a network.

They model the behaviour the store relies on, not Firestore in general:
- DocumentReference.set(data, merge=...) with Increment and SERVER_TIMESTAMP transforms;
  the WriteResult's transform_results holds each transform's post-write value, in order.
- Document ids may not contain "/" (the real client then builds a collection path and
  raises ValueError), and arrays may not directly contain arrays (Firestore rejects them).
- Equality-only where() filters, limit() (recorded in `query_limits`), stream().
Writes are serialised by one lock, like increments on one Firestore document.
"""
from __future__ import annotations

import copy
import threading
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from google.api_core.exceptions import NotFound
from google.cloud import firestore


def _check_storable(value: Any, in_array: bool = False) -> None:
    if isinstance(value, (list, tuple)):
        if in_array:
            raise ValueError("Firestore does not allow an array directly inside an array")
        for v in value:
            _check_storable(v, in_array=True)
    elif isinstance(value, dict):
        for v in value.values():
            _check_storable(v)


class _Snapshot:
    def __init__(self, doc_id: str, data: dict[str, Any] | None) -> None:
        self.id = doc_id
        self.exists = data is not None
        self._data = data

    def to_dict(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._data)


class _DocRef:
    def __init__(self, db: FakeFirestore, collection: str, doc_id: str) -> None:
        if not doc_id or "/" in doc_id:
            raise ValueError(f"A document must have an even number of path elements: {collection}/{doc_id}")
        self._db, self._collection, self.id = db, collection, doc_id

    def set(self, data: dict[str, Any], merge: bool = False) -> SimpleNamespace:
        with self._db.lock:
            docs = self._db.docs.setdefault(self._collection, {})
            doc = copy.deepcopy(docs.get(self.id, {})) if merge else {}
            transforms: list[SimpleNamespace] = []
            for key, value in data.items():
                if isinstance(value, firestore.Increment):
                    doc[key] = doc.get(key, 0) + value.value
                    transforms.append(SimpleNamespace(integer_value=doc[key]))
                elif value is firestore.SERVER_TIMESTAMP:
                    doc[key] = datetime.now(timezone.utc)
                    transforms.append(SimpleNamespace(timestamp_value=doc[key]))
                else:
                    _check_storable(value)
                    doc[key] = copy.deepcopy(value)
            docs[self.id] = doc
            self._db.writes += 1
            return SimpleNamespace(transform_results=transforms, update_time=datetime.now(timezone.utc))

    def get(self) -> _Snapshot:
        with self._db.lock:
            return _Snapshot(self.id, copy.deepcopy(self._db.docs.get(self._collection, {}).get(self.id)))


class _Query:
    def __init__(self, db: FakeFirestore, collection: str, filters: tuple[Any, ...] = (), limit: int | None = None) -> None:
        self._db, self._collection, self._filters, self._limit = db, collection, filters, limit

    def where(self, *, filter: Any) -> _Query:  # noqa: A002 - the real keyword name
        assert filter.op_string == "==", "the store only uses equality filters (no composite index)"
        return _Query(self._db, self._collection, (*self._filters, filter), self._limit)

    def limit(self, count: int) -> _Query:
        self._db.query_limits.append(count)
        return _Query(self._db, self._collection, self._filters, count)

    def stream(self):
        with self._db.lock:
            rows = list(self._db.docs.get(self._collection, {}).items())
        hits = [(i, d) for i, d in rows if all(d.get(f.field_path) == f.value for f in self._filters)]
        for doc_id, data in hits[: self._limit] if self._limit is not None else hits:
            yield _Snapshot(doc_id, copy.deepcopy(data))


class _Collection(_Query):
    def document(self, doc_id: str) -> _DocRef:
        return _DocRef(self._db, self._collection, doc_id)


class FakeFirestore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.docs: dict[str, dict[str, dict[str, Any]]] = {}
        self.query_limits: list[int] = []
        self.writes = 0

    def collection(self, name: str) -> _Collection:
        return _Collection(self, name)


class _Blob:
    def __init__(self, objects: dict[str, tuple[bytes, str]], name: str) -> None:
        self._objects, self.name = objects, name

    def upload_from_string(self, data: bytes, content_type: str) -> None:
        self._objects[self.name] = (bytes(data), content_type)

    def download_as_bytes(self) -> bytes:
        if self.name not in self._objects:
            raise NotFound(f"No such object: {self.name}")
        return self._objects[self.name][0]


class _Bucket:
    def __init__(self, objects: dict[str, tuple[bytes, str]]) -> None:
        self._objects = objects

    def blob(self, name: str) -> _Blob:
        return _Blob(self._objects, name)


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def bucket(self, name: str) -> _Bucket:
        return _Bucket(self.objects)
