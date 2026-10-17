# TrueSite end-to-end suite (Playwright)

Browser tests for the built app, served by the real FastAPI server with the offline Gemini stand-in
(`GEMINI_MODE=fake`) and the in-memory store: no cloud access, no cost. The suite has its own `package.json`, so
the app's dependencies, `make test` and the Docker build are untouched (`web/e2e/` is in `.dockerignore` and
`.gcloudignore`). Specs are named `*.e2e.ts`, which neither vitest (`src/**/*.test.ts`) nor `tsc -b` (`src` only)
picks up.

## Run it

From the repo root, in Git Bash:

```bash
# The PDFs the start page links to (git-ignored; any https base URL will do for the tests), then the app build.
(cd bim && uv run python -m truesite_bim.site --sheets-only --base-url https://127.0.0.1:8813 --sheets-dir ../web/public/sheets)
(cd web && npm ci && npm run build)
# The suite.
cd web/e2e && npm ci && npx playwright install chromium
npx playwright test                                     # starts the servers below, runs everything (6 min; 10 with live-ar)
npx playwright test tests/virtual-demo.e2e.ts --project desktop-chrome   # one spec, one device
npx playwright show-report                              # the HTML report, with traces of failures
npm run typecheck                                       # tsc for the suite itself
```

`uv` must be on `PATH` (or set `E2E_UV` to its full path). The config starts these servers from `server/`:

| Port | Env | Used by |
|---|---|---|
| `E2E_PORT` (8813) | generous limits; reused if already running | every spec |
| `E2E_LIMITS_PORT` (8815) | `CHECKS_PER_IP_PER_HOUR=1`, `DAILY_CHECK_CAP=3`; always started fresh (`off` skips it and the limit tests) | `limits.e2e.ts` |
| the live AR videos' base URL (8814) | default limits; reused if already running; only when the videos exist | `live-ar.e2e.ts` |

`E2E_STATIC_DIR` and `E2E_MODELS_DIR` point the servers at another build or model folder.
`E2E_BASE_URL=https://...` runs the suite against a deployment instead (no local servers, no limit tests). With live
Gemini the offline-mode assertions fail, and every check costs money and counts against the 30 an hour per address,
so keep that for a smoke run of `start-page`, `live` and `a11y`.

### Live AR with a synthetic camera (`live-ar`)

`tests/live-ar.e2e.ts` plays ray-traced camera videos with exact ground truth (`scripts/live-ar-videos.py`): the
upright A3 sheet P1 (23 cm code at 1.40 m) and P2-P4 on the site, and the D1 desk sheet, each seen by a 1920 x 1080
camera with the app's default intrinsics. Every test launches its own Chromium with
`--use-file-for-fake-video-capture=<video>` on an iPad Pro 11 landscape context, taps Start camera and compares the
overlay's pixels with the model's silhouette projected from the true pose. Motion events are computed from the pose of
the frame on screen (each frame carries its index), so gravity levelling and look-around are checked against the
truth too.

The videos are about 1.7 GB and git-ignored. Make them once (about 6 minutes) with the bim environment (numpy and segno):

```bash
cd bim && uv run python ../web/e2e/scripts/live-ar-videos.py --out ../web/e2e/.videos --base-url http://127.0.0.1:8814
```

Their QR codes point at `--base-url`, so that is where the spec opens the app; the config serves the build on that
port. `E2E_LIVE_AR_VIDEOS` points at another folder. Without the videos the `live-ar` project is left out. With them,
`npx playwright test` runs it next to the other projects, one live-ar browser at a time. The tests are
timing-sensitive (software WebGL, a 1080p camera), so if one fails under load, rerun the project on its own:

```bash
npx playwright test --project live-ar                   # about 3 min
```

Screenshots, overlay masks and fits go to `test-results/live-ar/`.

## Projects

- `desktop-chrome` (1366 x 900): everything except the limit and live AR tests.
- `ipad-pro-11-landscape` and `iphone-15`: Chromium with the device's viewport, touch and user agent, for tests
  tagged `@handheld`. They aren't Safari: WebKit-only behaviour (Quick Look, motion permission) still needs a device.
- `limits`: `limits.e2e.ts`, in order, against the limits server.
- `live-ar`: `live-ar.e2e.ts`, one worker, only when the videos exist.

The `live` spec gets Chromium's built-in fake camera (`--use-fake-device-for-media-stream`), so Start camera, the QR
worker and its wasm really run; there is no QR code in that picture, so tracking never starts. `live-ar` is where
tracking, alignment and look-around are tested.

## What is covered

| Spec | What |
|---|---|
| `start-page` | sections in order, nav anchors and the current-section marker, the progress line, deep links, every `/sheets` and `/models` file, SPA links, a missing sheet is a 404 |
| `live` | the laptop popup (QR of the page, once per visit, focus, Escape, backdrop) and its absence on iPad, iPhone and an iPad that reports a Mac; the camera with Check as-built off on the live sheets; the camera stops on leaving; unknown sheet or project |
| `live-ar` | P1 first use (calibration skipped, QR detected, Alignment Good at 0.7 m, overlay within 10 px of the truth, Check as-built off), gravity levelling of a board leaning 4 degrees (and a sensor 12 degrees off refused), look-around after a turn, the model hidden and the 5 s tips without motion, no code, D1 at 1:100, P2-P4, a different code, camera blocked, `?xr=1`, head-on from the X, frames stalling and the track ending, Motion & Orientation denied |
| `model` | the site by default, colour key, tap an element, Ask with the stand-in, `?project=rooftop`, an unknown project, Last check results, drafting from them |
| `virtual-demo` | P1-P4: intro, turning by keys and drag, design overlay, Check as-built with the three images (photo, design render, design outlines: IMAGE 3), every planted defect in the opening view numbered (also on iPad and iPhone), the honest offline scorecard, the design render, findings; with a stubbed Gemini answer: scorecard hits and misses, Why it matters, Draft issue in Thai, save, the site report in Thai, copy; model text never rendered as HTML; ten visits in one tab keep WebGL alive; the error copy for 503, 429, 422, 502 and no connection |
| `photos` | `?photos`: four simulated photos, a run, the planted defects, pins on the 3D model, the saved result when Gemini can't run |
| `limits` | real 429s: per-address limit (virtual demo and saved-result fallback), the separate question budget, the daily cap |
| `a11y` | axe-core WCAG 2.2 A/AA, serious and critical only: start page, live AR, 3D model, virtual demo with dialogs, ready-made views |
| `layout` | no sideways scrolling and no tap target under 24 px (WCAG 2.5.8) on phone and tablet |
| `csp` | no Content-Security-Policy-Report-Only reports in the main flows, camera and QR worker included |

The offline stand-in reads every element of the site project as matching, so the deviation UI is reached by
rewriting the server's real `/api/check` answer (`stubGeminiFindsPlanted` in `support/fixtures.ts`): the run is
still stored by the server, so drafting, saving and the report go through the real API.

## Known bugs

`support/bugs.ts` lists the bugs this suite found that are not fixed yet. Each has a `test.fixme` with the bug's
title that asserts the fixed behaviour; when a fix lands, change `test.fixme` to `test`. The axe and tap-target
checks leave out findings of a known bug and note it on the test, so anything new still fails.
