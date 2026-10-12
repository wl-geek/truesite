"""FirestoreGcsStore blob methods against a tiny local stand-in for the GCS
JSON API (there is no official GCS emulator). It proves the real
google-cloud-storage client calls we make -- upload with content type,
download, NotFound -> None, keys with slashes -- not GCS itself."""

from __future__ import annotations

import base64
import json
import threading
import time
import urllib.parse
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import google_crc32c
import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore, storage

from app.store import blob_key
from app.store_gcp import FirestoreGcsStore

BUCKET = "truesite-uploads-test"


class FakeGcs(BaseHTTPRequestHandler):
    objects: dict[str, tuple[bytes, str]] = {}
    log: list[tuple[str, str]] = []

    def log_message(self, *args) -> None:  # keep pytest output clean
        pass

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        self.log.append(("POST", self.path))
        assert url.path == f"/upload/storage/v1/b/{BUCKET}/o", url.path
        qs = urllib.parse.parse_qs(url.query)
        assert qs["uploadType"] == ["multipart"]
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        msg = BytesParser(policy=HTTP).parsebytes(
            b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + raw
        )
        meta_part, media_part = list(msg.iter_parts())
        meta = json.loads(meta_part.get_payload(decode=True))
        media = media_part.get_payload(decode=True)
        self.objects[meta["name"]] = (media, meta.get("contentType") or media_part.get_content_type())
        self._json(200, {"bucket": BUCKET, "name": meta["name"], "size": str(len(media)), "generation": "1"})

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        if url.path == f"/storage/v1/b/{BUCKET}":
            # google-cloud-storage 3.x fetches bucket metadata once, in a
            # background thread, for its observability cache. On Cloud Run
            # with only roles/storage.objectAdmin this is a 403, which the
            # library caches and ignores.
            self.log.append(("BUCKET-META", self.path))
            self._json(403, {"error": {"code": 403, "message": "storage.buckets.get denied"}})
            return
        self.log.append(("GET", self.path))
        prefix = f"/download/storage/v1/b/{BUCKET}/o/"
        assert url.path.startswith(prefix), url.path
        name = urllib.parse.unquote(url.path[len(prefix) :])
        if name not in self.objects:
            self._json(404, {"error": {"code": 404, "message": "No such object"}})
            return
        data, ctype = self.objects[name]
        crc = base64.b64encode(google_crc32c.Checksum(data).digest()).decode()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("x-goog-hash", f"crc32c={crc}")
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture
def gcs_store():
    FakeGcs.objects = {}
    FakeGcs.log = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGcs)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    endpoint = f"http://127.0.0.1:{server.server_address[1]}"
    gcs = storage.Client(
        project="demo-truesite", credentials=AnonymousCredentials(), client_options={"api_endpoint": endpoint}
    )
    fs = firestore.Client(project="demo-truesite", credentials=AnonymousCredentials())  # not used here
    yield FirestoreGcsStore(bucket=BUCKET, firestore_client=fs, storage_client=gcs)
    time.sleep(0.2)  # let the library's background bucket-metadata fetch finish
    gcs.close()
    fs.close()
    server.shutdown()
    server.server_close()


def test_put_and_get_blob(gcs_store: FirestoreGcsStore) -> None:
    key = blob_key("0b8f6b8e-2a4e-4c1e-9d55-1d2f3a4b5c6d", "AbC_dEf-123456789012", "photo.jpg")
    data = b"\xff\xd8\xff" + bytes(range(256)) * 100
    assert gcs_store.put_blob(key, data, "image/jpeg") == f"gs://{BUCKET}/{key}"
    assert FakeGcs.objects[key] == (data, "image/jpeg")
    assert gcs_store.get_blob(key) == data
    # the object name (with slashes) is percent-encoded into one path segment
    get_path = [p for m, p in FakeGcs.log if m == "GET"][0]
    assert urllib.parse.quote(key, safe="") in get_path and "alt=media" in get_path


def test_missing_blob_is_none(gcs_store: FirestoreGcsStore) -> None:
    assert gcs_store.get_blob("uploads/nobody/none/photo.jpg") is None


def test_library_fetches_bucket_metadata_in_background(gcs_store: FirestoreGcsStore) -> None:
    gcs_store.put_blob("uploads/s/r/photo.jpg", b"\xff\xd8\xff", "image/jpeg")
    time.sleep(0.3)
    kinds = [m for m, _ in FakeGcs.log]
    assert kinds.count("BUCKET-META") == 1  # once per bucket; its 403 is cached, not retried
    assert gcs_store.get_blob("uploads/s/r/photo.jpg") == b"\xff\xd8\xff"  # and harmless
