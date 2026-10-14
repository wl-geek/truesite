#!/usr/bin/env bash
# TrueSite -- day-1 Google Cloud setup and deploy.
# Flags checked against `gcloud <cmd> --help` from Google Cloud SDK 588.0.0
# (2026-10-02). Run it a section at a time the first time; every step is safe
# to re-run except where noted ("create" steps fail if the thing exists).
#
#   bash infra/gcloud.sh setup     # sections 1-7, once
#   bash infra/gcloud.sh deploy    # section 8, every release (run from the repo root)
#   bash infra/gcloud.sh verify    # section 9
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

setup() {
  : "${BILLING_ACCOUNT:?set BILLING_ACCOUNT (gcloud billing accounts list)}"

  # ---- 1. Project, billing, defaults ----
  gcloud projects create "$PROJECT_ID" --name="TrueSite" --set-as-default   # skip if it exists
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  gcloud config set project "$PROJECT_ID"
  gcloud config set run/region "$REGION"

  # ---- 2. APIs ----
  gcloud services enable \
    run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
    aiplatform.googleapis.com billingbudgets.googleapis.com iam.googleapis.com

  # ---- 3. Budget alert (alerts only -- a budget never stops spending) ----
  # Needs Billing Account Administrator or Billing Account Costs Manager.
  # If it complains about a quota project, add --billing-project="$PROJECT_ID".
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

  # ---- 4. Runtime service account, least privilege ----
  gcloud iam service-accounts create "$SA_NAME" --display-name="TrueSite Cloud Run runtime"
  for role in roles/datastore.user roles/aiplatform.user roles/logging.logWriter; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:$SA" --role="$role" --condition=None
  done
  # Storage is granted on the bucket only (section 6). Secret access only on
  # the one secret, and only if the API-key fallback is used (section 7).

  # ---- 5. Firestore, Native mode, (default) database ----
  gcloud firestore databases create --location="$REGION" --type=firestore-native
  # TTL: delete docs ~24 h after their expire_at (server writes it = created + 30 d).
  for group in check_runs issues usage; do
    gcloud firestore fields ttls update expire_at --collection-group="$group" --enable-ttl --async
  done

  # ---- 6. Upload bucket: private, uniform access, 30-day delete, no soft delete ----
  gcloud storage buckets create "gs://$BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --soft-delete-duration=0 \
    --lifecycle-file=infra/lifecycle.json
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="serviceAccount:$SA" --role=roles/storage.objectAdmin

  # ---- 7. Source deploys build as the Compute Engine default SA ----
  local number
  number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role=roles/run.builder --condition=None

  # Fallback only (Gemini Developer API key instead of Vertex AI):
  #   printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key \
  #     --replication-policy=automatic --data-file=-
  #   gcloud secrets add-iam-policy-binding gemini-api-key \
  #     --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
  #   and add to the deploy: --set-secrets=GEMINI_API_KEY=gemini-api-key:latest
}

deploy() {
  # ---- 8. Build on Cloud Build from ./Dockerfile and deploy ----
  # First run asks to create the Artifact Registry repo "cloud-run-source-deploy";
  # --quiet answers yes.
  gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --service-account "$SA" \
    --allow-unauthenticated \
    --max-instances 2 \
    --cpu 1 \
    --memory 1Gi \
    --concurrency 20 \
    --timeout 120 \
    --set-env-vars "STORE_BACKEND=gcp,GCS_BUCKET=$BUCKET,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GEMINI_MODE=live,GOOGLE_GENAI_USE_ENTERPRISE=true,GOOGLE_CLOUD_LOCATION=$GEMINI_LOCATION,DAILY_CHECK_CAP=100,CHECKS_PER_IP_PER_HOUR=10,TRUSTED_PROXY_HOPS=1" \
    --quiet
}

verify() {
  # ---- 9. Smoke checks ----
  local url
  url="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
  curl -fsS "$url/api/health"; echo
  # Expect "ip" to be YOUR address, not 203.0.113.9, and x_forwarded_for to end with it.
  curl -fsS -H 'X-Forwarded-For: 203.0.113.9' "$url/api/whoami"; echo
  curl -fsS -o /dev/null -w 'SPA deep link: %{http_code}\n' "$url/a/room1/A1"
  gcloud run services logs read "$SERVICE" --region "$REGION" --limit 20
}

case "${1:-}" in
  setup) setup ;;
  deploy) deploy ;;
  verify) verify ;;
  *) echo "usage: $0 setup|deploy|verify" >&2; exit 2 ;;
esac
