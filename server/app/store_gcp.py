"""Firestore (Native mode) + Cloud Storage implementation of `Store`.

Data model
  usage/{YYYY-MM-DD[-ask]}  {checks, expire_at}                     daily cap counters (UTC day; count attempts)
  check_runs/{run_id}       CheckRun fields + expire_at
  issues/{issue_id}         Issue fields + expire_at
  saved_results/{sample_id} {result, saved_at}                       last real result per sample photo
  gs://<bucket>/uploads/<session_id>/<run_id>/{photo.jpg,render.png} 30-day lifecycle delete

`expire_at` lets a Firestore TTL policy delete old docs (see infra/gcloud.sh);
Cloud Storage objects are deleted by the bucket lifecycle rule.

Queries use equality filters only (Firestore serves those by merging
single-field indexes), and sort in Python -- so no composite index has to be
created. Adding .order_by("created_at") to the session_id filter WOULD need a
composite index (session_id ASC, created_at DESC).

Images are served by an API route that reads from GCS with the service
account (see main.py: GET /api/runs/{run_id}/{name}); we do not hand out
signed URLs. Signing on Cloud Run has no private key: blob.generate_signed_url
then needs service_account_email + access_token and the IAM signBlob
permission (roles/iam.serviceAccountTokenCreator on the SA itself). Not worth
it for <= 4 MB images.

Credentials: Application Default Credentials. On Cloud Run that is the
service account given with --service-account; locally,
`gcloud auth application-default login`, or the emulator via
FIRESTORE_EMULATOR_HOST.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from google.api_core.exceptions import NotFound
from google.cloud import firestore, storage
from google.cloud.firestore_v1 import FieldFilter

from .schemas import CheckRun, Issue

RETENTION = timedelta(days=30)

USAGE = "usage"
RUNS = "check_runs"
ISSUES = "issues"
SAVED = "saved_results"


class FirestoreGcsStore:
    def __init__(
        self,
        *,
        bucket: str,
        project: str | None = None,
        database: str = "(default)",
        firestore_client: firestore.Client | None = None,
        storage_client: storage.Client | None = None,
    ) -> None:
        self.db = firestore_client or firestore.Client(project=project, database=database)
        self._gcs = storage_client or storage.Client(project=project)
        self.bucket_name = bucket
        self._bucket = self._gcs.bucket(bucket)  # no API call

    # --- abuse cap ------------------------------------------------------------
    def try_consume_daily(self, day: str, cap: int) -> tuple[bool, int]:
        """Atomic increment-then-check in ONE write, no transaction.

        The commit response's `transform_results` holds the post-increment
        value of *this* write, and increments on one document serialise, so
        exactly `cap` callers see a value <= cap -- even when racing. Calls
        after the cap still bump the counter (it counts attempts), which is
        why the admitted count is reported as min(value, cap).

        Measured on the Firestore emulator: a read-check-write
        @firestore.transactional version was also correct, but with 3+
        concurrent callers some raised ValueError("Failed to commit
        transaction in 5 attempts") and calls stalled 6-8 s.

        `day` may carry a suffix ("2026-10-15-ask"): only its date part sets
        expire_at, and the full key stays the document id.
        """
        expire_at = datetime.strptime(day[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc) + RETENTION
        result = self.db.collection(USAGE).document(day).set(
            # Exactly one transform in this write, so transform_results[0] is it.
            {"checks": firestore.Increment(1), "expire_at": expire_at},
            merge=True,
        )
        value = int(result.transform_results[0].integer_value)
        return value <= cap, min(value, cap)

    # --- check runs -------------------------------------------------------------
    def save_check_run(self, run: CheckRun) -> None:
        data = run.model_dump()
        data["expire_at"] = run.created_at + RETENTION
        self.db.collection(RUNS).document(run.run_id).set(data)

    def get_check_run(self, run_id: str, session_id: str) -> CheckRun | None:
        snap = self.db.collection(RUNS).document(run_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        if data.get("session_id") != session_id:
            return None
        return CheckRun.model_validate(data)

    # --- issues -----------------------------------------------------------------
    def save_issue(self, issue: Issue) -> None:
        data = issue.model_dump()
        data["expire_at"] = issue.created_at + RETENTION
        self.db.collection(ISSUES).document(issue.id).set(data)

    def list_issues(self, session_id: str, project_id: str | None = None, limit: int = 200) -> list[Issue]:
        query = self.db.collection(ISSUES).where(filter=FieldFilter("session_id", "==", session_id))
        if project_id is not None:
            query = query.where(filter=FieldFilter("project_id", "==", project_id))
        rows = [Issue.model_validate(doc.to_dict()) for doc in query.limit(500).stream()]
        rows.sort(key=lambda i: i.created_at, reverse=True)
        return rows[:limit]

    # --- saved results for sample photos ----------------------------------------
    def put_saved_result(self, sample_id: str, result: dict[str, Any]) -> None:
        self.db.collection(SAVED).document(sample_id).set({"result": result, "saved_at": firestore.SERVER_TIMESTAMP})

    def get_saved_result(self, sample_id: str) -> dict[str, Any] | None:
        snap = self.db.collection(SAVED).document(sample_id).get()
        if not snap.exists:
            return None
        return (snap.to_dict() or {}).get("result")

    # --- blobs ---------------------------------------------------------------------
    def put_blob(self, key: str, data: bytes, content_type: str) -> str:
        self._bucket.blob(key).upload_from_string(data, content_type=content_type)
        return f"gs://{self.bucket_name}/{key}"

    def get_blob(self, key: str) -> bytes | None:
        try:
            return self._bucket.blob(key).download_as_bytes()
        except NotFound:
            return None
