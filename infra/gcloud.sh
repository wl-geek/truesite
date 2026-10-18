#!/usr/bin/env bash
# TrueSite -- day-1 Google Cloud setup and deploy.
# Flags checked against `gcloud <cmd> --help` from Google Cloud SDK 588.0.0
# (2026-10-02). Every step is safe to re-run: "create" steps check first.
# Run from the repo root.
#
#   bash infra/gcloud.sh setup        # sections 1-7, once
#   bash infra/gcloud.sh deploy       # section 8, every release: renders the QR sheets for the service URL first
#   bash infra/gcloud.sh verify       # section 9: smoke checks on the service URL, then recent logs
#   bash infra/gcloud.sh smoke <url>  # the same checks against any URL
set -euo pipefail

# ---- 0. Install gcloud (macOS, Apple silicon) -- by hand, once ----------------------
# Option A, official archive (no Homebrew needed):
#   curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
#   tar -xf google-cloud-cli-darwin-arm.tar.gz
#   ./google-cloud-sdk/install.sh          # adds gcloud to PATH; open a new shell
# Option B, Homebrew cask (cask name is gcloud-cli; on this Mac brew first needs
#   `sudo xcodebuild -license accept`):
#   brew install --cask gcloud-cli
# Then:
#   gcloud init                              # log in, pick or create the project
#   gcloud auth application-default login    # only to run the server locally against real Firestore/GCS

# ---- settings -------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-truesite-hack-2026}"   # globally unique, 6-30 chars
REGION="asia-southeast1"
SERVICE="truesite"
BUCKET="${PROJECT_ID}-uploads"
SA_NAME="truesite-run"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"           # from: gcloud billing accounts list
BUDGET_AMOUNT="${BUDGET_AMOUNT:-30}"             # in the billing account's currency
GEMINI_LOCATION="${GEMINI_LOCATION:-global}"     # decided on day 1 by the Gemini spike
# enterprise: Agent Platform through the runtime service account (default).
# apikey: an AI Studio key from the Secret Manager secret gemini-api-key (see the end of setup).
GEMINI_BACKEND="${GEMINI_BACKEND:-enterprise}"
# Every gcloud call targets PROJECT_ID, whatever project `gcloud config` has active on this machine.
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
# Sheets deploy must render and verify must find, each with a QR for the service URL: the site project's
# viewpoints P1-P4 and its D1 desk sheet, the start page's downloads. site is the only project now.
REQUIRED_SHEETS="site-P1 site-P2 site-P3 site-P4 site-D1"
# Sheets with no QR, so no link to check, that deploy must still render and verify must still find: the site set-out plan.
PLAN_SHEETS="site-layout"
SHEETS_DIR="web/public/sheets"
# What /api/health must report (smoke against a local fake server: EXPECT_GEMINI_MODE=fake EXPECT_STORE_BACKEND=memory).
EXPECT_GEMINI_MODE="${EXPECT_GEMINI_MODE:-live}"
EXPECT_STORE_BACKEND="${EXPECT_STORE_BACKEND:-gcp}"

die() { echo "ERROR: $*" >&2; exit 1; }

retry() {  # a new service account can take a few seconds to show up in IAM
  local n
  for n in 1 2 3 4 5; do
    "$@" && return 0
    echo "retry $n/5 in 5 s: $*" >&2
    sleep 5
  done
  return 1
}

service_url() {
  # The deterministic Cloud Run URL is known before the first deploy, so the sheets can be printed
  # with it. BASE_URL overrides it (a custom domain, say).
  if [ -n "${BASE_URL:-}" ]; then
    echo "${BASE_URL%/}"
    return
  fi
  local number
  number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  [ -n "$number" ] || die "no project number for $PROJECT_ID"
  echo "https://${SERVICE}-${number}.${REGION}.run.app"
}

make_sheets() {
  # Fresh sheets every deploy: leftovers from a LAN phone test would ship a QR for a private address.
  local url="$1" name f
  rm -rf "$SHEETS_DIR"
  (cd bim && uv run python -m truesite_bim.site --sheets-only --base-url "$url" --sheets-dir "../$SHEETS_DIR" >/dev/null)
  for name in $REQUIRED_SHEETS $PLAN_SHEETS; do
    [ -f "$SHEETS_DIR/$name.pdf" ] || die "$SHEETS_DIR/$name.pdf was not rendered"
  done
  for f in "$SHEETS_DIR"/*.pdf; do
    case " $PLAN_SHEETS " in *" $(basename "$f" .pdf) "*) continue ;; esac
    grep -aqF "$url/a/" "$f" || die "$f does not link to $url/a/"
  done
}

setup() {
  # Works for a NEW project (needs BILLING_ACCOUNT) or an EXISTING one created in the console
  # with billing already linked (leave BILLING_ACCOUNT empty; create the budget in the console).

  # ---- 1. Project, billing, defaults ----
  if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Using existing project $PROJECT_ID"
  else
    : "${BILLING_ACCOUNT:?project $PROJECT_ID does not exist: set BILLING_ACCOUNT (gcloud billing accounts list) to create it}"
    gcloud projects create "$PROJECT_ID" --name="TrueSite" --set-as-default
  fi
  if [ -n "$BILLING_ACCOUNT" ]; then
    gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  fi
  gcloud config set project "$PROJECT_ID"
  gcloud config set run/region "$REGION"

  # ---- 2. APIs ----
  gcloud services enable \
    run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
    aiplatform.googleapis.com billingbudgets.googleapis.com iam.googleapis.com

  # ---- 3. Budget alert (alerts only -- a budget never stops spending) ----
  # Needs Billing Account Administrator or Costs Manager; skipped when the billing owner made it in the console.
  if [ -z "$BILLING_ACCOUNT" ]; then
    echo "BILLING_ACCOUNT not set: create the budget alert in the console (Billing -> Budgets & alerts)."
  elif [ -n "$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
                 --filter="displayName='TrueSite hackathon'" --format='value(name)')" ]; then
    echo "Budget alert 'TrueSite hackathon' exists"
  else
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="TrueSite hackathon" \
    --budget-amount="$BUDGET_AMOUNT" \
    --calendar-period=month \
    --filter-projects="projects/$PROJECT_ID" \
    --threshold-rule=percent=0.25 \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 \
    --threshold-rule=percent=1.0,basis=forecasted-spend
  fi

  # ---- 4. Runtime service account, least privilege ----
  if gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
    echo "Using existing service account $SA"
  else
    gcloud iam service-accounts create "$SA_NAME" --display-name="TrueSite Cloud Run runtime"
  fi
  for role in roles/datastore.user roles/aiplatform.user roles/logging.logWriter; do
    retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$SA" --role="$role" --condition=None
  done
  # Storage is granted on the bucket only (section 6). Secret access only on
  # the one secret, and only if the API-key fallback is used (section 7).

  # ---- 5. Firestore, Native mode, (default) database ----
  if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
    echo "Firestore (default) database exists"
  else
    gcloud firestore databases create --location="$REGION" --type=firestore-native
  fi
  # TTL: delete docs ~24 h after their expire_at (server writes it = created + 30 d).
  for group in check_runs issues usage; do
    gcloud firestore fields ttls update expire_at --collection-group="$group" --enable-ttl --async
  done

  # ---- 6. Upload bucket: private, uniform access, 30-day delete, no soft delete ----
  if gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
    echo "Bucket gs://$BUCKET exists"
  else
  gcloud storage buckets create "gs://$BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --soft-delete-duration=0 \
    --lifecycle-file=infra/lifecycle.json
  fi
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="serviceAccount:$SA" --role=roles/storage.objectAdmin

  # ---- 7. Source deploys build as the Compute Engine default SA ----
  local number
  number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role=roles/run.builder --condition=None

  # Fallback only (Gemini Developer API key instead of Agent Platform), by hand, once:
  #   printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key \
  #     --replication-policy=automatic --data-file=-
  #   gcloud secrets add-iam-policy-binding gemini-api-key \
  #     --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
  # then deploy with GEMINI_BACKEND=apikey (it sets GOOGLE_GENAI_USE_ENTERPRISE=false and the secret).
}

deploy() {
  # ---- 8. Build on Cloud Build from ./Dockerfile and deploy ----
  [ -f Dockerfile ] && [ -d bim ] && [ -d web ] || die "run this from the repo root"
  local url env secrets=""
  env="STORE_BACKEND=gcp,GCS_BUCKET=$BUCKET,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GEMINI_MODE=live"
  env="$env,DAILY_CHECK_CAP=300,DAILY_ASK_CAP=300,CHECKS_PER_IP_PER_HOUR=30,TRUSTED_PROXY_HOPS=1"  # judges share office IPs; about US$0.015 a check (eval/README.md section 3)
  case "$GEMINI_BACKEND" in
    enterprise) env="$env,GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_LOCATION=$GEMINI_LOCATION" ;;
    # The SDK ignores GEMINI_API_KEY while GOOGLE_GENAI_USE_ENTERPRISE=true, so the flag goes with the key.
    apikey) env="$env,GOOGLE_GENAI_USE_ENTERPRISE=false"; secrets="--set-secrets=GEMINI_API_KEY=gemini-api-key:latest" ;;
    *) die "GEMINI_BACKEND must be enterprise or apikey, not '$GEMINI_BACKEND'" ;;
  esac

  # The QR sheets ship inside the image (web/public -> dist), so they are rendered for this URL first.
  url="$(service_url)"
  echo "Rendering the QR sheets for $url"
  make_sheets "$url"

  # First run asks to create the Artifact Registry repo "cloud-run-source-deploy";
  # --quiet answers yes.
  gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --service-account "$SA" \
    --allow-unauthenticated \
    --max-instances 2 \
    --cpu 1 \
    --cpu-boost \
    --memory 1Gi \
    --concurrency 20 \
    --timeout 120 \
    --set-env-vars "$env" \
    ${secrets:+"$secrets"} \
    --quiet
}

check_get() {  # check_get <url> <content type> [save to]: fails unless 200 with that type
  local got
  got="$(curl -sS -o "${3:-/dev/null}" -w '%{http_code} %{content_type}' "$1")" || die "GET $1 failed"
  case "$got" in
    "200 $2"*) echo "ok   $1 ($got)" ;;
    *) die "GET $1 gave '$got', expected 200 $2" ;;
  esac
}

new_session_id() {  # a random UUID v4, the shape X-Session-Id must have
  printf '%04x%04x-%04x-4%03x-%04x-%04x%04x%04x\n' "$RANDOM" "$RANDOM" "$RANDOM" "$((RANDOM & 0xfff))" \
    "$(((RANDOM & 0x3fff) | 0x8000))" "$RANDOM" "$RANDOM" "$RANDOM"
}

smoke() {
  # ---- 9. Smoke checks against any URL ----
  local url="${1:?usage: $0 smoke <url>}" tmp health name guid code
  url="${url%/}"
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT  # expanded now: $tmp is local and gone by the time the script exits

  health="$(curl -fsS "$url/api/health")" || die "GET $url/api/health failed"
  echo "ok   $url/api/health $health"
  case "$health" in *"\"gemini_mode\":\"$EXPECT_GEMINI_MODE\""*) ;; *) die "gemini_mode is not $EXPECT_GEMINI_MODE" ;; esac
  case "$health" in *"\"store_backend\":\"$EXPECT_STORE_BACKEND\""*) ;; *) die "store_backend is not $EXPECT_STORE_BACKEND" ;; esac

  check_get "$url/a/site/P1" text/html  # SPA deep link, as the printed P1 sheet opens it

  # A missing sheet is a 404 (server/app/spa.py), and each one must point back at this URL.
  for name in $REQUIRED_SHEETS; do
    check_get "$url/sheets/$name.pdf" application/pdf "$tmp/$name.pdf"
    grep -aqF "$url/a/" "$tmp/$name.pdf" || die "sheets/$name.pdf does not link to $url/a/"
  done
  for name in $PLAN_SHEETS; do
    check_get "$url/sheets/$name.pdf" application/pdf
  done

  # The other demo assets. Outside /sheets a missing file is index.html (200 text/html), so the type catches it.
  check_get "$url/models/site.usdz" model/vnd.usdz+zip  # iPad Walk inside (Quick Look), built by the web prebuild
  check_get "$url/samples/index.json" application/json  # the committed site samples behind /samples
  check_get "$url/samples/site-p1-south/photo.jpg" image/jpeg

  # One real model round trip (counts once against the daily ask cap).
  guid="$(curl -fsS "$url/api/projects/site" | sed -n 's/.*"guid":"\([^"]*\)".*/\1/p')" || die "GET /api/projects/site failed"
  [ -n "$guid" ] || die "no element in /api/projects/site"
  code="$(curl -sS -o "$tmp/ask.json" -w '%{http_code}' -X POST "$url/api/ask" \
    -H "X-Session-Id: $(new_session_id)" -H 'Content-Type: application/json' \
    -d "{\"project_id\":\"site\",\"guid\":\"$guid\",\"question\":\"What is this element?\"}")" || die "POST /api/ask failed"
  [ "$code" = 200 ] || die "POST /api/ask gave $code: $(cat "$tmp/ask.json")"
  echo "ok   $url/api/ask $(cat "$tmp/ask.json")"
  echo "SMOKE OK $url"
}

verify() {
  local url
  url="$(service_url)"
  smoke "$url"
  # Expect "ip" to be YOUR address, not 203.0.113.9, and x_forwarded_for to end with it.
  curl -fsS -H 'X-Forwarded-For: 203.0.113.9' "$url/api/whoami"; echo
  gcloud run services logs read "$SERVICE" --region "$REGION" --limit 20
}

case "${1:-}" in
  setup) setup ;;
  deploy) deploy ;;
  verify) verify ;;
  smoke) smoke "${2:-}" ;;
  *) echo "usage: $0 setup|deploy|verify|smoke <url>" >&2; exit 2 ;;
esac
