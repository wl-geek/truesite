from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.config import DEFAULT_MODELS_DIR, DEFAULT_STATIC_DIR, MiB, REPO_ROOT, Settings

ENV_VARS = [
    "STATIC_DIR", "MODELS_DIR", "MAX_UPLOAD_BYTES", "MAX_BODY_BYTES", "CHECKS_PER_IP_PER_HOUR",
    "ASKS_PER_IP_PER_HOUR", "DAILY_CHECK_CAP", "DAILY_ASK_CAP", "TRUSTED_PROXY_HOPS", "STORE_BACKEND",
    "GOOGLE_CLOUD_PROJECT", "GCS_BUCKET", "FIRESTORE_DATABASE", "GEMINI_MODE", "ISSUES_PER_IP_PER_HOUR",
    "ISSUES_PER_SESSION", "API_DOCS", "MAX_IMAGE_PIXELS",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_defaults_point_into_the_repo() -> None:
    assert (REPO_ROOT / "server" / "app" / "config.py").is_file()
    s = Settings.from_env()
    assert s == Settings()
    assert s.static_dir == DEFAULT_STATIC_DIR == REPO_ROOT / "web" / "dist"
    assert s.models_dir == DEFAULT_MODELS_DIR == REPO_ROOT / "bim" / "models"
    assert (s.max_upload_bytes, s.max_body_bytes) == (4 * MiB, 13 * MiB)
    assert s.max_image_pixels == 4_000_000
    assert (s.checks_per_ip_per_hour, s.asks_per_ip_per_hour) == (10, 30)
    assert (s.daily_check_cap, s.daily_ask_cap) == (300, 1000)
    assert (s.issues_per_ip_per_hour, s.issues_per_session) == (30, 100)
    assert s.api_docs is False
    assert s.trusted_proxy_hops == 1
    assert (s.store_backend, s.gcp_project, s.gcs_bucket, s.firestore_database) == ("memory", None, None, "(default)")
    assert s.gemini_mode == "fake"


def test_the_body_cap_fits_a_check_with_three_images_at_the_file_limit() -> None:
    """C-41: photo, render and overlay at the per-file limit, the largest context (64 Ki characters, at most
    4 bytes each in UTF-8) and 64 KiB for multipart boundaries and headers all fit under the default cap."""
    from app.routes.check import MAX_CONTEXT_CHARS

    s = Settings()
    assert 3 * s.max_upload_bytes + 4 * MAX_CONTEXT_CHARS + 64 * 1024 <= s.max_body_bytes


def test_every_variable_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {
        "STATIC_DIR": "/app/static", "MODELS_DIR": "/app/models", "MAX_UPLOAD_BYTES": "100",
        "MAX_BODY_BYTES": "200", "CHECKS_PER_IP_PER_HOUR": "3", "ASKS_PER_IP_PER_HOUR": "4",
        "DAILY_CHECK_CAP": "5", "DAILY_ASK_CAP": "6", "TRUSTED_PROXY_HOPS": "2", "STORE_BACKEND": "gcp",
        "GOOGLE_CLOUD_PROJECT": "truesite-hack", "GCS_BUCKET": "truesite-hack-uploads",
        "FIRESTORE_DATABASE": "other", "GEMINI_MODE": "live", "ISSUES_PER_IP_PER_HOUR": "7",
        "ISSUES_PER_SESSION": "8", "API_DOCS": "1", "MAX_IMAGE_PIXELS": "9",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert Settings.from_env() == Settings(
        static_dir=Path("/app/static"), models_dir=Path("/app/models"), max_upload_bytes=100, max_body_bytes=200,
        checks_per_ip_per_hour=3, asks_per_ip_per_hour=4, daily_check_cap=5, daily_ask_cap=6,
        trusted_proxy_hops=2, store_backend="gcp", gcp_project="truesite-hack", gcs_bucket="truesite-hack-uploads",
        firestore_database="other", gemini_mode="live", issues_per_ip_per_hour=7, issues_per_session=8,
        api_docs=True, max_image_pixels=9,
    )


@pytest.mark.parametrize("value,expected", [("1", True), ("true", True), ("0", False), ("false", False), ("", False)])
def test_api_docs_flag(monkeypatch: pytest.MonkeyPatch, value: str, expected: bool) -> None:
    monkeypatch.setenv("API_DOCS", value)
    assert Settings.from_env().api_docs is expected


def test_empty_values_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_VARS:
        monkeypatch.setenv(name, "")
    assert Settings.from_env() == Settings()


@pytest.mark.parametrize("name,value", [("STORE_BACKEND", "redis"), ("GEMINI_MODE", "maybe")])
def test_unknown_choices_are_rejected(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        Settings.from_env()


# ---- .env.example ---------------------------------------------------------------------------------------------
ENV_EXAMPLE = REPO_ROOT / ".env.example"
ENV_READ = re.compile(r"""(?:_int|_flag|_choice|os\.environ\.get|os\.getenv)\(\s*["']([A-Z][A-Z0-9_]+)["']""")


def env_example() -> dict[str, str]:
    """The uncommented NAME=value lines, quotes stripped as a dotenv loader does."""
    rows = re.findall(r"^([A-Z][A-Z0-9_]+)=(.*)$", ENV_EXAMPLE.read_text(encoding="utf-8"), re.M)
    return {name: value.strip().strip('"') for name, value in rows}


def test_env_example_documents_every_variable_the_server_reads() -> None:
    read = {name for path in (REPO_ROOT / "server" / "app").rglob("*.py")
            for name in ENV_READ.findall(path.read_text(encoding="utf-8"))}
    documented = set(re.findall(r"^#? ?([A-Z][A-Z0-9_]+)=", ENV_EXAMPLE.read_text(encoding="utf-8"), re.M))
    assert {"STATIC_DIR", "MAX_IMAGE_PIXELS", "CHECK_VERIFY_POLICY"} <= read  # the pattern still finds them
    assert sorted(read - documented) == []


def test_env_example_holds_the_defaults_and_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    example = env_example()
    assert "GEMINI_API_KEY" not in example and "GOOGLE_API_KEY" not in example  # documented, commented out, empty
    for name, value in example.items():
        monkeypatch.setenv(name, value)
    assert Settings.from_env() == Settings(gcp_project="your-project-id")
