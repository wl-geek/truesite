# TrueSite: one container serving the FastAPI API and the built web app.
# Must live at the repo root: `gcloud run deploy --source .` only uses a
# Dockerfile in the source directory (there is no flag for another path).
# Classic Dockerfile syntax only (no BuildKit-only features), so it builds the
# same locally and on Cloud Build.

# ---- 1. Build the web app ----------------------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. Python runtime ----------------------------------------------------------
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    STATIC_DIR=/app/static \
    MODELS_DIR=/app/models \
    STORE_BACKEND=gcp
WORKDIR /app
# Hash-pinned (uv pip compile --generate-hashes); pip enforces the hashes.
# pip byte-compiles at install time, so cold starts don't recompile (Cloud
# Run's filesystem is in-memory; PYTHONDONTWRITEBYTECODE only stops runtime writes).
COPY server/requirements.txt ./
RUN pip install --require-hashes -r requirements.txt
COPY server/app ./app
COPY bim/models ./models
COPY --from=web /web/dist ./static
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin truesite
USER 10001
EXPOSE 8080
# `sh -c` so ${PORT} expands; `exec` makes uvicorn PID 1 so it receives
# SIGTERM (Cloud Run gives 10 s before SIGKILL).
# --no-proxy-headers: client IPs come from app.limits.client_ip, which takes the
# right-most X-Forwarded-For entry; uvicorn's own handling must not rewrite them.
CMD ["sh", "-c", "exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port \"${PORT:-8080}\" --no-proxy-headers --no-server-header --timeout-graceful-shutdown 8"]
