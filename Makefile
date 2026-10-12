.PHONY: test test-bim test-server test-web dev-server dev-web build docker-build setup deploy verify models

test: test-bim test-server test-web
test-bim:
	cd bim && uv run pytest -q
test-server:
	cd server && uv run pytest -q
test-web:
	cd web && npx vitest run && npx tsc -b

# Local dev: API on :8000 with fake Gemini + in-memory store; Vite proxies /api to it.
dev-server:
	cd server && GEMINI_MODE=fake uv run uvicorn --factory app.main:create_app --reload --port 8000
dev-web:
	cd web && npm run dev
build:
	cd web && npm run build
docker-build:
	docker build -t truesite-local .

# Rebuild glb + elements.json after replacing bim/models/room1/model.ifc
models:
	cd bim && uv run python -m truesite_bim.pipeline models/room1/model.ifc --out models/room1

setup:
	bash infra/gcloud.sh setup
deploy:
	bash infra/gcloud.sh deploy
verify:
	bash infra/gcloud.sh verify
