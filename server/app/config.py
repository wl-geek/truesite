"""Runtime settings, read once from environment variables (contract section 6).

Everything has a safe local default, so `uvicorn --factory app.main:create_app` works on a
laptop with no cloud access: in-memory store, fake Gemini, models and web build from the repo.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

MiB = 1024 * 1024

# server/app/config.py -> the repo root is parents[2]
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC_DIR = REPO_ROOT / "web" / "dist"
DEFAULT_MODELS_DIR = REPO_ROOT / "bim" / "models"

STORE_BACKENDS = ("memory", "gcp")
GEMINI_MODES = ("fake", "live")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return default if raw in (None, "") else int(raw)


def _flag(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _choice(name: str, default: str, allowed: tuple[str, ...]) -> str:
    value = os.environ.get(name) or default
    if value not in allowed:
        raise ValueError(f"{name}={value!r}; expected one of {allowed}")
    return value


@dataclass(frozen=True)
class Settings:
    # Built SPA (Vite dist/). In the container: /app/static.
    static_dir: Path = DEFAULT_STATIC_DIR
    # bim/models/<project>/{model.glb, elements.json, anchors.json, project.json, demo_issues.json}.
    # In the container: /app/models.
    models_dir: Path = DEFAULT_MODELS_DIR

    # Upload limits (spec section 6: photo and render at most 4 MB each).
    max_upload_bytes: int = 4 * MiB
    # Whole-request cap, enforced while the body streams in: three files (photo, render, outline overlay)
    # + context + multipart overhead.
    max_body_bytes: int = 13 * MiB

    # Abuse limits (spec section 9). Per-IP limits are per instance; the daily caps are global (store).
    checks_per_ip_per_hour: int = 10
    asks_per_ip_per_hour: int = 30
    daily_check_cap: int = 300
    daily_ask_cap: int = 1000
    # Saved issues make no Gemini call, so no daily cap: a per-IP write limit and a per-session
    # total instead (each GET /api/issues reads the session's issues).
    issues_per_ip_per_hour: int = 30
    issues_per_session: int = 100

    # How many proxies append to X-Forwarded-For in front of us:
    # 1 = Cloud Run's own front end (direct *.run.app URL); 2 = an external HTTPS load balancer too.
    trusted_proxy_hops: int = 1

    # "memory" (tests, local dev) or "gcp" (Firestore + Cloud Storage).
    store_backend: str = "memory"
    gcp_project: str | None = None
    gcs_bucket: str | None = None
    firestore_database: str = "(default)"

    # "fake" (offline, deterministic) or "live" (google-genai; backend chosen by its own env vars:
    # GOOGLE_GENAI_USE_ENTERPRISE=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION=global,
    # or GEMINI_API_KEY as the fallback).
    gemini_mode: str = "fake"

    # Swagger UI at /api/docs and /api/openapi.json. Off unless API_DOCS=1 (make dev-server sets it):
    # the UI loads an unpinned script from jsDelivr on the app's own origin.
    api_docs: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            static_dir=Path(os.environ.get("STATIC_DIR") or DEFAULT_STATIC_DIR),
            models_dir=Path(os.environ.get("MODELS_DIR") or DEFAULT_MODELS_DIR),
            max_upload_bytes=_int("MAX_UPLOAD_BYTES", 4 * MiB),
            max_body_bytes=_int("MAX_BODY_BYTES", 13 * MiB),
            checks_per_ip_per_hour=_int("CHECKS_PER_IP_PER_HOUR", 10),
            asks_per_ip_per_hour=_int("ASKS_PER_IP_PER_HOUR", 30),
            daily_check_cap=_int("DAILY_CHECK_CAP", 300),
            daily_ask_cap=_int("DAILY_ASK_CAP", 1000),
            issues_per_ip_per_hour=_int("ISSUES_PER_IP_PER_HOUR", 30),
            issues_per_session=_int("ISSUES_PER_SESSION", 100),
            trusted_proxy_hops=_int("TRUSTED_PROXY_HOPS", 1),
            store_backend=_choice("STORE_BACKEND", "memory", STORE_BACKENDS),
            # Cloud Run does not set GOOGLE_CLOUD_PROJECT; infra/gcloud.sh passes it explicitly.
            gcp_project=os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
            gcs_bucket=os.environ.get("GCS_BUCKET") or None,
            firestore_database=os.environ.get("FIRESTORE_DATABASE") or "(default)",
            gemini_mode=_choice("GEMINI_MODE", "fake", GEMINI_MODES),
            api_docs=_flag("API_DOCS"),
        )
