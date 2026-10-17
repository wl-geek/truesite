.PHONY: test test-bim test-server test-web dev-server dev-web build docker-build setup deploy verify models sheets

test: test-bim test-server test-web
test-bim:
	cd bim && uv run pytest -q
test-server:
	cd server && uv run pytest -q
test-web:
	cd web && npx vitest run && npx tsc -b

# Local dev: API on :8000 with fake Gemini + in-memory store; Vite proxies /api to it.
dev-server:
	cd server && GEMINI_MODE=fake API_DOCS=1 uv run uvicorn --factory app.main:create_app --reload --port 8000
dev-web:
	cd web && npm run dev
build:
	cd web && npm run build
docker-build:
	docker build -t truesite-local .

# Rebuild the building site model (model.ifc, glb, elements.json, anchors.json) from bim/truesite_bim/site.py
models:
	cd bim && uv run python -m truesite_bim.site --out models/site

setup:
	bash infra/gcloud.sh setup
# Renders the QR sheets for the service URL, then deploys (GEMINI_BACKEND=apikey for the AI Studio fallback)
deploy:
	bash infra/gcloud.sh deploy
verify:
	bash infra/gcloud.sh verify

# Printable QR sheets for the start page, pointing at BASE_URL (e.g. the Cloud Run URL or https://<lan-ip>:5173).
# Only the PDFs are written: the committed model files stay as they are. Warnings still show (stderr).
sheets:
	cd bim && uv run python -m truesite_bim.site --sheets-only --base-url $(BASE_URL) --sheets-dir ../web/public/sheets > /dev/null && ls ../web/public/sheets
