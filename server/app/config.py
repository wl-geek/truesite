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
    # Pixels per image (width x height, read from the header before any decoding). The web app sends at most
    # 1600 px a side (2.56 MP); a few MB of JPEG can declare far more, and the second look (app/verify.py)
    # decodes each image of a check and keeps it while its close-ups are cropped from it.
    max_image_pixels: int = 4_000_000
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

    # A second, close-up look at the marks most likely to be wrong (app/verify.py). Off unless CHECK_VERIFY=1.
    check_verify: bool = False

    # A check of a shipped sample photo refreshes that sample's saved result, the fallback every visitor
    # sees. Off unless SAVE_SAMPLE_RESULTS=1: the sample photos are public, so on the deployed service
    # anyone could otherwise replace the fallback. Refresh them from a local server against the same store.
    save_sample_results: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            static_dir=Path(os.environ.get("STATIC_DIR") or DEFAULT_STATIC_DIR),
            models_dir=Path(os.environ.get("MODELS_DIR") or DEFAULT_MODELS_DIR),
            max_upload_bytes=_int("MAX_UPLOAD_BYTES", 4 * MiB),
            max_image_pixels=_int("MAX_IMAGE_PIXELS", 4_000_000),
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
            check_verify=_flag("CHECK_VERIFY"),
            save_sample_results=_flag("SAVE_SAMPLE_RESULTS"),
        )


VERIFY_RESOLUTIONS = ("high", "medium")


@dataclass(frozen=True)
class VerifySettings:
    """How the close-up second look runs (app/verify.py), read at each check from VERIFY_* variables. Switched on by
    CHECK_VERIFY=1 (Settings.check_verify). The defaults are the ones measured on 26 Nov 2026."""

    # Model for the close-ups; "" = the check's own model (gemini_client.MODEL_ID). Flash-Lite answered a close-up
    # in under 2 s but cleared 6 of 16 real defects (3.8 Flash: 2), so the default stays the check's own model.
    model: str = ""
    # Each close-up's own limit; Gemini answers 504 DEADLINE_EXCEEDED about 3 s before it.
    timeout_ms: int = 14_000
    # The most the second look waits once the first pass has answered: a close-up not back by then leaves its mark as
    # the first pass said (it may still finish, and be billed, in the background). One close-up in seven runs into
    # Gemini's deadline and used to hold the whole check for about 11 s.
    grace_ms: int = 6_000
    # Thin or small marks looked at again (started with the first pass), and flagged or unjudged marks after it.
    max_quiet: int = 16
    max_late: int = 10
    # Close-ups running at once for one check.
    workers: int = 16
    # Media resolution of the photo crops ("high" or "medium"); the render crop is always medium.
    photo_resolution: str = "high"

    @classmethod
    def from_env(cls) -> "VerifySettings":
        d = cls()
        return cls(
            model=(os.environ.get("VERIFY_MODEL") or "").strip(),
            timeout_ms=_int("VERIFY_TIMEOUT_MS", d.timeout_ms),
            grace_ms=max(0, _int("VERIFY_GRACE_MS", d.grace_ms)),
            max_quiet=_int("VERIFY_MAX_QUIET", d.max_quiet),
            max_late=_int("VERIFY_MAX_LATE", d.max_late),
            workers=max(1, _int("VERIFY_WORKERS", d.workers)),
            photo_resolution=_choice("VERIFY_PHOTO_RESOLUTION", d.photo_resolution, VERIFY_RESOLUTIONS),
        )
