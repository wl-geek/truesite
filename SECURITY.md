# Security

How TrueSite handles credentials, data and abuse, and how to tell us about a vulnerability.

## Report a vulnerability

Please report it privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/wl-geek/truesite/security/advisories/new)). Only the maintainers see the report. Please don't open a public issue or pull request for it.

Include what you found, how to reproduce it, and what it lets an attacker do. We aim to reply within a few days, agree a fix and a disclosure date with you, and credit you in the advisory if you want. Please test only against your own local copy or with light, ordinary use of the live demo: no denial of service, no automated scanning at volume, and no access to other people's data.

In scope: this repository and the deployed service. The latest commit on `main` is the supported version.

## No keys in the code, the image or production

TrueSite is keyless by design.

- **Production holds no API key.** The Cloud Run service runs as its own service account, `truesite-run`. Gemini (through Agent Platform), Firestore and Cloud Storage are reached with Application Default Credentials: short-lived tokens from Cloud Run's metadata server. No service-account key file is needed or used.
- **Everything comes from the environment.** `server/app/config.py` reads every setting from environment variables, with safe local defaults (an offline Gemini stand-in and an in-memory store). [.env.example](.env.example) documents each one, and a test keeps that list complete.
- **The optional API-key route uses Secret Manager.** If Agent Platform is not available, `GEMINI_BACKEND=apikey make deploy` switches to a Gemini Developer API key. The key lives only in the Secret Manager secret `gemini-api-key`; Cloud Run mounts it as `GEMINI_API_KEY` with `--set-secrets`, and the service account can read that one secret and nothing else. The deployed service does not use this route.
- **Nothing secret is committed.** `.gitignore`, `.gcloudignore` and `.dockerignore` keep `.env` files, `*.pem`, `*-key.json` and `service-account*.json` out of git, the Cloud Build upload and the image. Every pull request and every push to `main` runs a [gitleaks](https://github.com/gitleaks/gitleaks) scan ([CI](.github/workflows/ci.yml)).
- **Last full scan: 25 Nov 2026**, gitleaks 8.30.1 and trufflehog 3.100.1 over the whole history of every branch: no secrets. The one match, a made-up UUID in a unit test, is a reviewed false positive ([.gitleaksignore](.gitleaksignore)).

The Google Cloud project ID and number in the service URL and in `infra/gcloud.sh` are public identifiers, not credentials.

## Least privilege

`infra/gcloud.sh setup` grants the runtime service account only what the app uses:

| Role | Where | Why |
|---|---|---|
| `roles/datastore.user` | project | Firestore: check runs, issues, daily caps |
| `roles/aiplatform.user` | project | Gemini through Agent Platform |
| `roles/logging.logWriter` | project | logs |
| `roles/storage.objectAdmin` | the upload bucket only | the check photos |
| `roles/secretmanager.secretAccessor` | the `gemini-api-key` secret only | only for the optional API-key route |

Source deploys build as the Compute Engine default service account with `roles/run.builder`, as Cloud Run requires.

## Data

- **Where:** Cloud Run, Firestore and Cloud Storage in `asia-southeast1` (Singapore). Gemini is called on Agent Platform's `global` endpoint, where the model is served.
- **What is stored:** for each check, the photo, the design render and the outline image (Cloud Storage), and the result with its provenance: the images' SHA-256 fingerprints, the server's time, the pose and the distance (Firestore); the issues people save; daily usage counters. No names, emails or accounts.
- **How long:** 30 days. A bucket lifecycle rule deletes photos and renders, and Firestore TTL policies delete check runs, issues and counters. Soft delete is off on the bucket, so deleted photos are gone.
- **Who can see it:** each browser makes a random session id (a UUID v4 kept in `localStorage`) and sends it as `X-Session-Id`. Checks, photos and issues are returned only to that session: the storage key of a photo is built from the caller's own session id, so another session cannot reach it even with the run id. Treat the id like a password: it is the only key to that browser's checks. The bucket is private (uniform bucket-level access, public access prevention), there are no public or signed URLs, and the browser never talks to Firestore or Cloud Storage directly.
- **Logs:** Cloud Run's request logs and the app's own lines (token usage, errors), under Cloud Logging's default retention. Photos are never logged.
- **No tracking:** no analytics, no cookies and no third-party scripts.

## Abuse and cost controls

- **Per-IP limits** (sliding window, per Cloud Run instance, client IP taken from the right-most `X-Forwarded-For` entry so it cannot be forged): 30 checks, 30 questions, issue drafts and site reports together, and 30 saved issues an hour on the deployed service.
- **Daily caps** across all users, counted atomically in Firestore: 300 checks, and 300 questions, issue drafts and site reports together. If the counter can't be read, the request is refused (fail closed) before any model call.
- **Uploads:** JPEG or PNG only (magic bytes checked), at most 4 MB and 4 megapixels per image (the size is read from the header, before any decoding), and 13 MB per request, counted while the body streams in. At most 100 saved issues per session.
- **Spend:** at most 2 Cloud Run instances, and a billing budget alert.
- **Model input and output are untrusted.** Gemini has no tools and no write access. Its output is schema-checked and repaired, element references must match the request, severity is set by code, and text in a photo is treated as scenery.

## Web and container hardening

- Response headers on every page and API response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that keeps the camera, motion sensors and WebXR to this origin and turns off the microphone and location, and `Strict-Transport-Security` over HTTPS. A baseline Content Security Policy is enforced (no plugins, no `<base>` rewrites, forms post only to this origin, no framing); the full policy (`default-src 'self'`) runs in report-only mode, and the end-to-end suite fails on any report in the main flows. API responses are `no-store`.
- No CORS headers, so another website can't read the API's answers in a visitor's browser or send it a session id. The interactive API docs are off in production.
- The image runs as a non-root user on `python:3.13-slim`, installs hash-pinned packages (`pip --require-hashes`), and contains only the server, the built web app and the models.

## Dependencies

Every dependency is pinned in a lockfile (`uv.lock`, `package-lock.json`), and the image installs from a hash-pinned `server/requirements.txt` that a test keeps in step with `server/uv.lock`. Dependabot proposes updates weekly for npm, uv and GitHub Actions ([config](.github/dependabot.yml)), and the packages were checked on 26 Nov 2026: `pip-audit` found no known vulnerabilities in the server's packages, and `npm audit` none in the web app's runtime packages or the end-to-end suite's. Its 9 high findings are all under `puppeteer-core`, a development tool that makes the ready-made sample photos (`web/scripts/make-samples.mjs`) and is not in the image.
