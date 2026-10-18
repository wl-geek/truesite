# Developing TrueSite

How we build and change TrueSite. The [README](README.md) covers what it is, how to try it and how to deploy it.

## Read first

| What | Where | Role |
|---|---|---|
| Brief | `docs/BRIEF.md` | The competition, the product, the demo plan and the current state |
| Design spec | `docs/specs/2026-10-11-truesite-design.md` | What to build and why; copy rules; error handling; limits |
| Interface contract | `docs/plans/2026-10-11-truesite-contract.md` | **Binding:** names, paths, schemas, API, pinned versions |
| Research notes | `docs/research/research-notes.md` | Verified facts and gotchas: check here before guessing an API |
| Audits | `docs/audit-2026-10-1*.md` | Findings, fixes and what still needs a device |

## How we work

1. One branch per change: `git switch -c <topic>`.
2. Test first: a failing test, then the minimal code, then a passing test. Pure logic always gets unit tests; browser behaviour gets a Playwright test in `web/e2e` or a short manual check written into the PR.
3. `make test` (BIM, server, web unit tests and `tsc -b`) passes before every push. Changes to the UI or the live view also run the Playwright projects they touch.
4. Small conventional commits (`feat(web): …`, `fix(server): …`), one pull request per change, merged when green.
5. Never commit secrets (`.env` is git-ignored), credentials, personal data or real client files.

## Hard rules

- **Freshness.** Only new code and assets made during the event: nothing from earlier projects, their code, prompts or data.
- **Follow the contract.** Use its names, paths and JSON fields exactly. If it is wrong, fix the contract in the same change and say why.
- **Copy rules (spec §4.4).** Findings are labelled "Visual check, not a survey." Offsets are rough ("about 30 cm left"), never millimetres. "Can't judge from this photo" instead of guessing. Gemini text is a draft for a person to approve. Never render model text as HTML.
- **Severity comes from code** (`server/app/severity.py`), never from the model. Gemini has no tools and no write access.

## Commands

| What | Command |
|---|---|
| All tests | `make test` |
| BIM tests / rebuild the model | `cd bim && uv run pytest -q` · `make models` (rebuilds `bim/models/site` from `site.py`) |
| Server (offline Gemini stand-in, memory store) | `make dev-server` → http://127.0.0.1:8000 |
| Web | `make dev-web` (Vite proxies `/api` to :8000) · phones on the LAN: `cd web && npm run dev:https` |
| End to end | `cd web/e2e && npx playwright test` (see `web/e2e/README.md`) |
| Container and cloud | `make docker-build` · `make setup` / `make deploy` / `make verify` |

Tooling: Node 20.19 or newer, Python 3.13 with `uv`, `gh` for pull requests.

## Where things live

- **Live AR** (`web/src/ui/LivePage.tsx`, `web/src/scene/overlay.ts`): QR reading in a zxing-wasm worker that follows the code (`scene/roi.ts`), corner smoothing while still (`scene/cornerFilter.ts`), pose from the code's corners (`pose/tracker.ts`), sensor fusion with the device rotation (`scene/fusion.ts`, `scene/rotationFilter.ts`), levelling by gravity (`scene/level.ts`), look-around on the sensors (`scene/motion.ts`), tap for details (`scene/pick.ts`, `scene/look.ts`).
- **The check** (`web/src/check/`): the ID buffer, numbered marks, the design render and the outline image; the server repairs Gemini's JSON and sets severity (`server/app/validate.py`, `server/app/severity.py`).
- **Virtual demo** (`web/src/ui/VirtualSite.tsx`, `web/src/sim/`): the simulated as-built with ten planted defects and the scorecard.
- **3D model** (`web/src/ui/ViewerPage.tsx`) and the shared element panel (`web/src/ui/ElementPanel.tsx`).
- **Model and sheets** (`bim/truesite_bim/site.py`): the site building, its QR anchors, the printable sheets and the layout plan.

## Gotchas that already cost us time

- **TypeScript.** `tsconfig.app.json` enables `verbatimModuleSyntax` and `erasableSyntaxOnly`: use `import { type X }` for types, and no constructor parameter properties or enums.
- **Coordinates.** The glb is Y-up (glTF = IFC (X, Z, −Y)); never rotate it by hand. Everything under `ifcRoot` is in IFC metres, Z up. Viewer: `ifcRoot.matrix = makeRotationX(-π/2)`. AR: `ifcRoot.matrix.fromArray(modelMatrixIfc(anchor, pose))`.
- **AR camera.** It has its own `PerspectiveCamera`: set `projectionMatrix` **and** `projectionMatrixInverse` from `projectionMatrixGL(...)`, and never call `updateProjectionMatrix()` on it.
- **QR.** zxing-wasm in a module worker on every device (iOS has no BarcodeDetector), the `.wasm` served from our own origin. Corners come in symbol order (TL, TR, BR, BL), scaled back to video pixels before `PoseTracker.update`. The planar flip is real: start within about 1 m of the code.
- **ID buffer.** `idColor()` uses linear `setRGB` (`setHex` corrupts IDs); `samples: 0` and no tone mapping. GL rows come back bottom-up.
- **iPhone.** Start the camera from a tap, with `<video playsinline muted autoplay>` over HTTPS. Calibration is stored per device, resolution and orientation.
- **Server.** Gemini and store calls are blocking, so endpoints are plain `def` or use `run_in_threadpool`. `<img src>` can't send `X-Session-Id`: fetch with the header, then `URL.createObjectURL`. The daily cap is a single Firestore `Increment`.
- **Gemini** (`server/app/gemini_client.py`): `gemini-3.8-flash` with low thinking and high media resolution, `response_json_schema` plus server-side repair, no temperature. One code path for Agent Platform (`GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_LOCATION=global`) and an AI Studio key; locally `GEMINI_MODE=fake`.
- **Cloud Run.** The Dockerfile stays at the repo root, `.gcloudignore` controls the upload, and the client IP is the right-most `X-Forwarded-For` entry.

## Windows

- Tools from winget: Git, GitHub CLI, Node LTS (20.19 or newer), uv, `ezwinports.make`, FFmpeg. Run repo commands in Git Bash; without `make`, run the Makefile's commands directly.
- Clone with `git config --global core.autocrlf false` (scripts keep LF endings) and `core.longpaths true`.
- For phone tests, allow inbound TCP 5173 (Private profile), then `npm run dev:https` and `make sheets BASE_URL=https://<laptop-ip>:5173`.
