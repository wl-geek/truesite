"""infra/gcloud.sh with stub `gcloud` and `uv` on PATH, and `smoke` against a real local server.

Nothing here talks to Google Cloud: the stubs log their arguments and fake just enough state.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from .conftest import INDEX_HTML

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra" / "gcloud.sh"
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(BASH is None, reason="needs bash")

PROJECT = "truesite-test"
SERVICE_URL = "https://truesite-123456789012.asia-southeast1.run.app"  # deterministic URL for the stub's number
SHEETS = ["room1-D1", "room1-L1", "rooftop-R1", "rooftop-R2"]

# "create" marks a resource kind (e.g. iam-service-accounts) as existing and fails if it already is;
# "describe"/"list" report it. Every call is logged with the project gcloud would use.
STUB_GCLOUD = r"""#!/usr/bin/env bash
echo "project=${CLOUDSDK_CORE_PROJECT:-} gcloud $*" >> "$STUB_LOG"
if [ "$1 $2" = "projects describe" ]; then
  case "$*" in *projectNumber*) echo 123456789012 ;; esac
  exit 0
fi
key="$1-$2"
case "${3:-}" in
  create) [ -e "$STUB_STATE/$key" ] && { echo "ALREADY_EXISTS: $key" >&2; exit 1; }; touch "$STUB_STATE/$key" ;;
  describe) [ -e "$STUB_STATE/$key" ] || { echo "NOT_FOUND: $key" >&2; exit 1; } ;;
  list) [ -e "$STUB_STATE/$key" ] && echo "billingAccounts/x/budgets/1" ;;
esac
exit 0
"""

# "uv run python -m truesite_bim.<module> ... --base-url URL --out-dir|--sheets-dir DIR" writes stand-in PDFs
# that link to URL (or to STUB_SHEET_URL, to fake sheets rendered for the wrong host).
STUB_UV = r"""#!/usr/bin/env bash
echo "uv $*" >> "$STUB_LOG"
[ -n "${STUB_NO_SHEETS:-}" ] && exit 0
url= dir= mod=
while [ $# -gt 0 ]; do
  case "$1" in -m) mod="$2"; shift ;; --base-url) url="$2"; shift ;; --out-dir|--sheets-dir) dir="$2"; shift ;; esac
  shift
done
case "$mod" in
  *qr_sheets) names="room1-D1 room1-D2 room1-L1 room1-A1" ;;
  *rooftop) names="rooftop-R1 rooftop-R2" ;;
esac
mkdir -p "$dir"
for n in $names; do printf '%%PDF-1.4\n(%s/a/x/%s) Tj\n' "${STUB_SHEET_URL:-$url}" "$n" > "$dir/$n.pdf"; done
"""


def write_stub(path: Path, text: str) -> None:
    path.write_bytes(text.encode())  # LF on every OS
    path.chmod(0o755)


@pytest.fixture
def stub(tmp_path: Path):
    """A fake repo root to run the script in, plus stub gcloud/uv; returns (run, log)."""
    repo = tmp_path / "repo"
    for d in ("bim", "web/public", "infra"):
        (repo / d).mkdir(parents=True)
    (repo / "Dockerfile").write_text("FROM scratch\n")
    bin_dir, state = tmp_path / "bin", tmp_path / "state"
    bin_dir.mkdir()
    state.mkdir()
    write_stub(bin_dir / "gcloud", STUB_GCLOUD)
    write_stub(bin_dir / "uv", STUB_UV)
    log = tmp_path / "calls.log"
    log.touch()

    def run(*args: str, **env: str) -> subprocess.CompletedProcess[str]:
        full_env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "PROJECT_ID": PROJECT,
                    "STUB_LOG": str(log), "STUB_STATE": str(state), **env}
        for var in ("BASE_URL", "BILLING_ACCOUNT", "GEMINI_BACKEND", "CLOUDSDK_CORE_PROJECT"):
            if var not in env:
                full_env.pop(var, None)
        return subprocess.run([BASH, str(SCRIPT), *args], cwd=repo, env=full_env, capture_output=True, text=True,
                              timeout=60)

    run.repo = repo  # type: ignore[attr-defined]
    return run, log


def calls(log: Path, prefix: str) -> list[str]:
    return [line for line in log.read_text().splitlines() if prefix in line]


# ------------------------------------------------------------------------ deploy


def test_deploy_renders_sheets_for_the_service_url_then_deploys(stub) -> None:
    run, log = stub
    r = run("deploy")
    assert r.returncode == 0, r.stderr
    sheets = run.repo / "web" / "public" / "sheets"
    for name in SHEETS:
        assert f"{SERVICE_URL}/a/".encode() in (sheets / f"{name}.pdf").read_bytes()
    assert any("truesite_bim.rooftop --sheets-only" in c for c in calls(log, "uv "))
    [deploy] = calls(log, "gcloud run deploy")
    assert deploy.startswith(f"project={PROJECT} ")  # never the active gcloud config's project
    assert "DAILY_ASK_CAP=300" in deploy and "GOOGLE_GENAI_USE_ENTERPRISE=true" in deploy
    assert "--set-secrets" not in deploy


def test_deploy_replaces_stale_sheets(stub) -> None:
    run, _ = stub
    stale = run.repo / "web" / "public" / "sheets"
    stale.mkdir()
    (stale / "room1-X9.pdf").write_bytes(b"%PDF https://192.168.1.23:5173/a/room1/X9")
    assert run("deploy").returncode == 0
    assert not (stale / "room1-X9.pdf").exists()


@pytest.mark.parametrize("env", [{"STUB_NO_SHEETS": "1"}, {"STUB_SHEET_URL": "https://192.168.1.23:5173"}],
                         ids=["no-sheets", "lan-url-sheets"])
def test_deploy_refuses_without_sheets_for_the_service_url(stub, env) -> None:
    run, log = stub
    r = run("deploy", **env)
    assert r.returncode != 0
    assert calls(log, "gcloud run deploy") == []


def test_deploy_uses_base_url_when_given(stub) -> None:
    run, log = stub
    assert run("deploy", BASE_URL="https://truesite.example.com/").returncode == 0
    pdf = run.repo / "web" / "public" / "sheets" / "room1-D1.pdf"
    assert b"https://truesite.example.com/a/" in pdf.read_bytes()


def test_api_key_backend_turns_agent_platform_off(stub) -> None:
    # With GOOGLE_GENAI_USE_ENTERPRISE=true the SDK ignores GEMINI_API_KEY, so the switch must set both.
    run, log = stub
    assert run("deploy", GEMINI_BACKEND="apikey").returncode == 0
    [deploy] = calls(log, "gcloud run deploy")
    assert "GOOGLE_GENAI_USE_ENTERPRISE=false" in deploy
    assert "--set-secrets=GEMINI_API_KEY=gemini-api-key:latest" in deploy


def test_unknown_gemini_backend_is_refused(stub) -> None:
    run, log = stub
    assert run("deploy", GEMINI_BACKEND="vertex").returncode != 0
    assert calls(log, "gcloud run deploy") == []


# ------------------------------------------------------------------------- setup


def test_setup_can_be_run_twice(stub) -> None:
    run, log = stub
    for _ in range(2):
        r = run("setup", BILLING_ACCOUNT="000000-000000-000000")
        assert r.returncode == 0, r.stderr
    for create in ("iam service-accounts create", "firestore databases create", "storage buckets create",
                   "billing budgets create"):
        assert len(calls(log, create)) == 1, create
    assert all(line.startswith(f"project={PROJECT} ") for line in calls(log, "gcloud "))


# ---------------------------------------------------------------- .gcloudignore

UPLOADED = ["Dockerfile", "server/app/main.py", "bim/models/room1/model.glb", "web/public/sheets/room1-D1.pdf"]
NOT_UPLOADED = ["capture/site-walk.mp4", ".playwright-mcp/page.png", "infra/sa.pem", "infra/truesite-key.json",
                "service-account-truesite.json", "server/debug.log", ".cache/worktrees/x/Dockerfile", ".env"]


@pytest.mark.skipif(shutil.which("git") is None, reason="needs git")
def test_gcloudignore_ships_the_sheets_but_not_keys_or_captures(tmp_path: Path) -> None:
    # gcloud reads .gcloudignore with .gitignore syntax; git applies the same rules here.
    for rel in UPLOADED + NOT_UPLOADED:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text("x")
    shutil.copy(ROOT / ".gcloudignore", tmp_path / ".gcloudignore")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    listed = subprocess.run(["git", "ls-files", "--others", "--exclude-from=.gcloudignore"], cwd=tmp_path,
                            capture_output=True, text=True, check=True).stdout.split()
    assert sorted(listed) == sorted(UPLOADED)


# ------------------------------------------------------------------------- smoke


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def local_server(tmp_path: Path):
    """The real app (fake Gemini, memory store, the committed models) on a free port; yields (url, static dir)."""
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text(INDEX_HTML)
    port = free_port()
    env = {**os.environ, "STATIC_DIR": str(static), "MODELS_DIR": str(ROOT / "bim" / "models"),
           "GEMINI_MODE": "fake", "STORE_BACKEND": "memory"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "--factory", "app.main:create_app",
                             "--host", "127.0.0.1", "--port", str(port)],
                            cwd=ROOT / "server", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        while True:
            try:
                if httpx.get(f"{url}/api/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert proc.poll() is None and time.monotonic() < deadline, "local server did not start"
            time.sleep(0.2)
        yield url, static
    finally:
        proc.terminate()
        proc.wait(timeout=10)


LOCAL = {"EXPECT_GEMINI_MODE": "fake", "EXPECT_STORE_BACKEND": "memory"}


def write_sheets(static: Path, url: str) -> None:
    (static / "sheets").mkdir()
    for name in SHEETS:
        (static / "sheets" / f"{name}.pdf").write_bytes(f"%PDF-1.4\n({url}/a/x/{name}) Tj\n".encode())


def test_smoke_passes_on_a_complete_deploy(stub, local_server) -> None:
    run, _ = stub
    url, static = local_server
    write_sheets(static, url)
    r = run("smoke", url, **LOCAL)
    assert r.returncode == 0, r.stdout + r.stderr


def test_smoke_fails_when_the_sheets_are_missing(stub, local_server) -> None:
    run, _ = stub
    url, _ = local_server
    r = run("smoke", url, **LOCAL)
    assert r.returncode != 0
    assert "sheets/room1-D1.pdf" in r.stderr


def test_smoke_fails_when_sheets_link_elsewhere(stub, local_server) -> None:
    run, _ = stub
    url, static = local_server
    write_sheets(static, "https://192.168.1.23:5173")
    r = run("smoke", url, **LOCAL)
    assert r.returncode != 0
    assert f"does not link to {url}/a/" in r.stderr


def test_smoke_expects_live_gemini_and_gcp_store_by_default(stub, local_server) -> None:
    run, _ = stub
    url, static = local_server
    write_sheets(static, url)
    r = run("smoke", url)
    assert r.returncode != 0
    assert "gemini_mode" in r.stderr
