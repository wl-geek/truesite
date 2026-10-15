# TrueSite — Interface Contract

**Date:** 11 Oct 2026 · Companion to the [design spec](../specs/2026-10-11-truesite-design.md) and the task list in GitHub Issues (order of work in [DEVELOPMENT.md](../../DEVELOPMENT.md)).

Every plan task uses exactly the names, paths, signatures, JSON fields and versions below. If a task needs something not listed here, it adds it in its own files without renaming anything here. JSON on the wire is **snake_case**, and TypeScript types mirror it field for field, with no camelCase mapping.

Research proofs (verified 11 Oct with running code) back every choice marked ✔.

---

## 1. Versions (pinned exactly)

| Area | Pins |
|---|---|
| Machine | Node 20.20.2 + npm 10.8.2 (local); Docker build stage `node:22-slim`; Python 3.13 via `uv` 0.13 |
| `bim/` (uv project `truesite-bim`) | `ifcopenshell==0.9.0` ✔ (0.8.5 is incompatible) · `segno==1.6.6` · `reportlab==5.0.1` · dev: `pytest==9.1.1`, `pymupdf==1.28.2` (tests only), `zxing-cpp==3.1.1` (tests only) |
| `server/` (uv project `truesite-server`, package `app`) | `fastapi==0.143.0` · `uvicorn[standard]==0.54.0` · `pydantic==2.14.0` · `python-multipart==0.0.32` · `google-genai==2.29.0` · `httpx==0.28.1` · `google-cloud-firestore==2.34.1` · `google-cloud-storage==3.17.0` · dev: `pytest==9.1.1`, `httpx2==2.13.1` (Starlette 1.7's TestClient imports it ✔) |
| `web/` | `vite@8.3.4` · `@vitejs/plugin-react@6.1.2` · `react@19.3.0` `react-dom@19.3.0` · `@types/react@19.3.0` `@types/react-dom@19.3.0` · `typescript@6.0.3` · `vitest@4.1.11` (5.x needs Node 22 ✔) · `three@0.186.1` · `@types/three@0.186.0` · `zxing-wasm@3.1.5` · `@vitejs/plugin-basic-ssl@2.3.0` · `@types/node@20.19.43` · dev: `qrcode@1.5.4`, `@types/qrcode@1.5.6`, `pngjs@7.0.0`, `@types/pngjs@6.0.5` |
| Model | `gemini-3.8-flash` (GA), Agent Platform location **`global`** (not offered in `asia-southeast1` ✔) |
| Cloud | Cloud Run `asia-southeast1`, Firestore Native `asia-southeast1`, one GCS bucket, gcloud CLI 588.0.0 |

## 2. Repository layout

```
truesite/
  Dockerfile  .dockerignore  .gcloudignore  Makefile  README.md   # Dockerfile MUST be at the root (gcloud run deploy --source .) ✔
  bim/
    pyproject.toml  uv.lock  pytest.ini
    truesite_bim/__init__.py
    truesite_bim/make_demo_model.py   # build_room(units="mm") -> Builder ; build_ref_cube(units) -> Builder ; det_guid(key) -> str ; main()
    truesite_bim/convert.py           # make_settings(world_coords=False) ; convert(ifc_path, glb_path) -> Path ; EXCLUDE
    truesite_bim/glb_reader.py        # read_glb(path) -> (json_dict, bin_bytes) ; named_node_bounds(path) -> dict[str, (min3, max3)]
    truesite_bim/extract_elements.py  # extract(ifc_path) -> list[dict]  (elements.json rows) ; main()
    truesite_bim/pipeline.py          # run(ifc: Path, out_dir: Path) -> dict ; main()  (refuses if glb GUIDs != elements GUIDs)
    truesite_bim/qr_sheets.py         # make_sheets(...) ; render_sheet(sheet, url, out_pdf) ; anchor_entry(sheet, project_id) ; main()
    tests/{conftest.py, test_pipeline.py, test_qr_sheets.py}
    models/room1/{model.ifc, model.glb, elements.json, anchors.json, project.json, demo_issues.json}
    sheets/                             # generated PDFs (git-ignored)
  server/
    pyproject.toml  uv.lock  requirements.txt (hash-pinned, for Docker)
    app/__init__.py
    app/config.py      # Settings (dataclass) + Settings.from_env()
    app/schemas.py     # all Pydantic models in §5
    app/projects.py    # ProjectRepo
    app/spa.py         # SPAStaticFiles ✔
    app/uploads.py     # BodySizeLimitMiddleware, read_image ✔
    app/limits.py      # client_ip, rate_key, SlidingWindowLimiter ✔
    app/store.py       # Store Protocol, InMemoryStore, blob_key ✔
    app/store_gcp.py   # FirestoreGcsStore ✔
    app/gemini_client.py  # verified Gemini layer ✔ (build_*_request, generate_json, check_asbuilt, ask_element, draft_issue, GeminiError)
    app/fake_gemini.py # FakeGeminiClient: deterministic offline stand-in with the same generate_content surface
    app/severity.py    # severity_for
    app/validate.py    # repair_check
    app/services.py    # make_checker, make_asker, make_drafter, error mapping
    app/main.py        # create_app (run: uvicorn --factory app.main:create_app)
    tests/...
  web/
    package.json  package-lock.json  vite.config.ts  index.html
    tsconfig.json  tsconfig.app.json  tsconfig.node.json  tsconfig.test.json
    public/samples/index.json   public/samples/<sample_id>/{photo.jpg, meta.json}
    src/main.tsx  src/App.tsx  src/router.ts  src/session.ts  src/styles.css
    src/api/types.ts  src/api/client.ts
    src/pose/**                 # copied verbatim from research (index.ts public API + tests + testing/synth.ts) ✔
    src/camera/camera.ts  src/camera/intrinsics.ts
    src/qr/protocol.ts  src/qr/zxing.worker.ts  src/qr/qrClient.ts  src/qr/link.ts
    src/scene/elements.ts  src/scene/loadModel.ts  src/scene/arCamera.ts  src/scene/viewer.ts  src/scene/overlay.ts  src/scene/idBuffer.ts  src/scene/pins.ts
    src/check/marks.ts  src/check/snapshot.ts  src/check/runCheck.ts
    src/ui/*.tsx
  infra/gcloud.sh  infra/lifecycle.json
  eval/overlay.csv  eval/labels.json  eval/summarise.py
  docs/specs/  docs/plans/
```

## 3. Conventions (fixed)

- **IFC model coordinates:** metres, Z up. elements.json `bbox_m` and anchors.json `position_m`/`normal`/`up` are all in this frame. ✔
- **glb:** produced by `convert.py`; always Y-up with glTF (x, y, z) = IFC (X, Z, −Y). One node per element, named with its 22-char IFC GlobalId (`IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/`). Never rotate the glb by hand. ✔
- **Scene graph (viewer and AR):** `ifcRoot` (Group, `matrixAutoUpdate=false`) → `gltfScene` with `matrix.fromArray(IFC_FROM_GLTF_MAT4)`. So everything under `ifcRoot` is in IFC coordinates: pins, boxes, anchors.
  - **Viewer:** `ifcRoot.matrix` = `makeRotationX(-Math.PI/2)`.
  - **AR:** `ifcRoot.matrix.fromArray(modelMatrixIfc(anchor, pose))`. ✔
- **Anchor (QR) frame:**
  - Origin at the code centre, with +z = `normal` toward the viewer, +y = `up`, and +x = y × z.
  - Corners TL(−s/2,+s/2), TR(+s/2,+s/2), BR(+s/2,−s/2), BL(−s/2,−s/2).
  - A model point maps as `p_marker = scale · Rqmᵀ (p − position_m)`.
  - `s` = `qr_size_m` = the printed symbol's outer edge, excluding the quiet zone. ✔
- **Camera:**
  - CV frame: x right, y down, z forward, with `Xc = R·Xm + t`.
  - Pixels use the edge convention (cx = W/2 for a centred principal point).
  - Corners are in **video pixels** (`video.videoWidth × videoHeight`), in **symbol order** TL, TR, BR, BL. ✔
- **Matrices:** the pose module is row-major internally. Anything handed to three.js is column-major (`fromArray`). `Matrix4.set()` takes rows. ✔
- **AR camera:**
  - Use a dedicated `PerspectiveCamera` at the origin with an identity world matrix.
  - Set `projectionMatrix.fromArray(projectionMatrixGL(...))` **and** `projectionMatrixInverse` (copy + invert).
  - **Never** call `updateProjectionMatrix()` on it. No OrbitControls on it, and no `reversedDepthBuffer`. ✔
- **ID buffer:**
  - Colours come from `idColor(i)` (linear `setRGB`), with `samples: 0` and no tone mapping.
  - Rows come back bottom-up; `visibleFromIdBuffer` flips them.
  - Coverage under 0.05% is dropped. ✔
- **Boxes:** `[ymin, xmin, ymax, xmax]`, integers 0–1000, rows top-down (Gemini convention). ✔
- **Session id:** `crypto.randomUUID()` (lowercase UUID v4), stored in localStorage `truesite.session`, sent as `X-Session-Id` on every `/api` call. The server validates `SESSION_ID_PATTERN`. The reserved session `"demo"` owns the seeded issues and can never be claimed by a client. ✔
- **Images in the UI:** `<img src>` cannot send headers. Fetch `/api/runs/...` with `X-Session-Id`, then use `URL.createObjectURL(blob)`. ✔

## 4. HTTP API

Errors are FastAPI `HTTPException` with `detail = {"code": <code>, ...}`. Paths are exact: no trailing slashes, and GET on a POST route is a 404 because of the SPA mount. ✔

| Method & path | Request | Success | Errors |
|---|---|---|---|
| GET `/api/health` | — | `{"ok": true, "gemini_mode": "live"\|"fake", "store_backend": "memory"\|"gcp"}` | — |
| GET `/api/whoami` | — | `{"ip", "x_forwarded_for", "peer"}` (day-1 X-Forwarded-For check) | — |
| GET `/api/projects/{project_id}` | — | `ProjectManifest` | 404 `unknown_project` |
| GET `/api/projects/{project_id}/model.glb` | — | glb (`model/gltf-binary`, ETag) | 404 |
| POST `/api/check` | multipart: `photo` (JPEG ≤ 4 MiB), `render` (PNG ≤ 4 MiB), `context` (JSON string → `CheckContext`); header `X-Session-Id` | `CheckResponse` | 413 · 415 · 422 (loc `["body","context",…]`) · 429 `rate_limited` (+`retry_after_s`, `Retry-After`) · 429 `daily_cap` · 503 `busy` (cap check failed) · 503 `model_unavailable` (timeout / unavailable / rate_limited) · 502 `model_bad_output` · 422 `model_blocked` · 500 `model_bad_request` |
| GET `/api/runs/{run_id}/{photo.jpg\|render.png}` | header `X-Session-Id` | image bytes (owner session only) | 404 |
| GET `/api/saved-results/{sample_id}` | — | `CheckResult` with `saved_at` set | 404 |
| POST `/api/ask` | `AskRequest`; header `X-Session-Id` | `AskAnswer` | 404 `unknown_element` · 429 · 503/502/422/500 as for check |
| POST `/api/issues/draft` | `IssueDraftRequest`; header `X-Session-Id` | `IssueDraft` | 404 `unknown_run` / `unknown_mark` · 429 · model errors as above |
| POST `/api/issues` | `IssueIn`; header `X-Session-Id` | `Issue` (201) | 422 |
| GET `/api/issues` (optional `?project_id=room1`; omitted = every project) | header `X-Session-Id` | `{"issues": Issue[], "demo": Issue[]}` (newest first) | 422 |

Write limits on POST `/api/issues` (no Gemini call, so no daily cap): 404 `unknown_project` / `unknown_element` / `unknown_run` · 429 `rate_limited` (ISSUES_PER_IP_PER_HOUR; +`retry_after_s`, `Retry-After`) · 429 `issue_cap` (the session already has ISSUES_PER_SESSION issues). A `run_id` that does not match `RUN_ID_PATTERN` is a 422 on both issue POSTs.

Every response carries the headers from `app/security_headers.py`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a `Permissions-Policy` that keeps camera, gyroscope, accelerometer, magnetometer and xr-spatial-tracking for `self`, and the CSP as `Content-Security-Policy-Report-Only` (not enforced yet). `/api` responses that set no `Cache-Control` get `no-store`. `/api/docs` and `/api/openapi.json` exist only with `API_DOCS=1`.

Client routes (the SPA fallback serves index.html): `/` (start page), `/model` (viewer; `?project={project_id}`, default `room1`), `/a/{project_id}/{anchor_id}` (live AR), `/samples`, `/issues` (every project).

## 5. Schemas — Python `server/app/schemas.py` (TS mirrors in `web/src/api/types.ts`)

```python
SESSION_ID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
DEMO_SESSION = "demo"
RUN_ID_PATTERN = r"^[A-Za-z0-9_-]{16,32}$"                     # secrets.token_urlsafe(16); also a Firestore doc id
ProjectId = constr(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$");  AnchorId = constr(pattern=r"^[A-Za-z0-9_-]{1,16}$")
Box = list[int 0..1000] len 4, ymin<=ymax, xmin<=xmax
Status = Literal["present_ok","missing","misplaced","different_from_design","cannot_judge"]
ImageQuality = Literal["good","too_dark","blurred","marker_far","occluded"]
PoseQuality = Literal["good","fair","poor"]
Direction = Literal["left","right","up","down","forward","back","none"]
Severity = Literal["high","medium","low"]

class Element:          guid, ifc_class, name, storey, bbox_m: list[list[float]] (2x3), load_bearing: bool | None, props: dict[str, Any]
class Anchor:           anchor_id, project_id, qr_size_m: float, position_m: list[float] (3), normal: list[float] (3), up: list[float] (3), scale: float, label: str = ""
class ProjectManifest:  project_id, name, model_url: str, elements: list[Element], anchors: list[Anchor]

class VisibleElement:   mark: int 1..25, guid, ifc_class, name = "", box: Box, key_dims: str = "" (<=200)            # extra="forbid"
class CheckContext:     project_id, anchor_id, pose_quality: PoseQuality, distance_m: float 0..50,
                        visible: list[VisibleElement] (1..25, unique marks), sample_id: str | None (pattern ^[a-z0-9][a-z0-9_-]{0,63}$)

class Offset:           direction: Direction, approx_cm: int 0..500
class Finding:          mark, guid, name, ifc_class, status: Status, confidence: float 0..1, evidence_box: Box | None,
                        offset: Offset | None, explanation: str (<=200), severity: Severity | None
class UnexpectedItem:   evidence_box: Box | None, description: str (<=150), confidence: float, severity: Literal["medium"] = "medium"
class Usage:            prompt_tokens: int, output_tokens: int, thought_tokens: int, total_tokens: int, cost_usd_est: float
class CheckResult:      project_id, anchor_id, image_quality: ImageQuality, pose_quality: PoseQuality,
                        findings: list[Finding] (exactly one per context mark, ordered by mark), unexpected: list[UnexpectedItem] (<=10),
                        summary: str (<=300), warnings: list[str], usage: Usage | None = None, model_version: str | None = None,
                        saved_at: str | None = None      # ISO time, set only on /api/saved-results responses
class CheckResponse:    run_id: str, saved: bool, photo_url: str | None, result: CheckResult
class CheckRun:         run_id, session_id, project_id, anchor_id, created_at: datetime, context: dict, result: dict, photo_key, render_key

class AskRequest:       project_id, guid, question: str 1..300
class AskAnswer:        answer: str (<=600), cited_properties: list[str], confidence: float 0..1
class IssueDraftRequest: run_id: str (RUN_ID_PATTERN), mark: int 1..25
class IssueDraft:       title: str (<=80), description: str (<=500), suggested_action: str (<=200)
class IssueIn:          project_id, guid, finding_ref: str | None ("<run_id>:<mark>"), run_id: str | None (RUN_ID_PATTERN), title (1..120),
                        description (<=2000) = "", suggested_action (<=600) = "", severity: Severity | None, crop_box: Box | None
class Issue(IssueIn):   id, session_id, photo_url: str | None, created_at: datetime, status: Literal["open","closed"] = "open"
```

TypeScript (`web/src/api/types.ts`): identical field names. The API's `VisibleElement` is exported as **`MarkedElement`**, so it does not clash with `scene/elements.ts`'s ID-buffer `VisibleElement`. `Issue.created_at` is an ISO string.

## 6. Server modules

```python
# app/config.py — @dataclass(frozen=True) Settings; Settings.from_env() reads these env vars (defaults in brackets):
#   STATIC_DIR [<repo>/web/dist]  MODELS_DIR [<repo>/bim/models]  MAX_UPLOAD_BYTES [4 MiB]  MAX_BODY_BYTES [9 MiB]
#   CHECKS_PER_IP_PER_HOUR [10]  ASKS_PER_IP_PER_HOUR [30]  DAILY_CHECK_CAP [300]  DAILY_ASK_CAP [1000]
#   ISSUES_PER_IP_PER_HOUR [30]  ISSUES_PER_SESSION [100]  API_DOCS [off; 1 = Swagger UI at /api/docs]
#   TRUSTED_PROXY_HOPS [1]  STORE_BACKEND [memory|gcp]  GOOGLE_CLOUD_PROJECT  GCS_BUCKET  FIRESTORE_DATABASE [(default)]
#   GEMINI_MODE [fake|live]  (live uses GOOGLE_GENAI_USE_ENTERPRISE=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION=global,
#                             or GEMINI_API_KEY as the fallback backend)
# app/projects.py
class UnknownProject(Exception): ...
class UnknownElement(Exception): ...
class ProjectRepo:
    def __init__(self, models_dir: Path) -> None
    def manifest(self, project_id: str) -> ProjectManifest     # model_url = f"/api/projects/{project_id}/model.glb"; name from project.json
    def elements_by_guid(self, project_id: str) -> dict[str, Element]
    def element(self, project_id: str, guid: str) -> Element
    def glb_path(self, project_id: str) -> Path
    def demo_issues(self, project_id: str) -> list[dict]        # demo_issues.json rows, [] if absent
# app/store.py  (verified ✔ — names unchanged)
class Store(Protocol):
    def try_consume_daily(self, day: str, cap: int) -> tuple[bool, int]   # day key e.g. "2026-10-12" or "2026-10-12-ask"
    def save_check_run(self, run: CheckRun) -> None
    def get_check_run(self, run_id: str, session_id: str) -> CheckRun | None
    def save_issue(self, issue: Issue) -> None                             # upsert by id
    def list_issues(self, session_id: str, project_id: str | None = None, limit: int = 200) -> list[Issue]
    def put_saved_result(self, sample_id: str, result: dict) -> None
    def get_saved_result(self, sample_id: str) -> dict | None
    def put_blob(self, key: str, data: bytes, content_type: str) -> str
    def get_blob(self, key: str) -> bytes | None
def blob_key(session_id: str, run_id: str, name: str) -> str          # "uploads/<session>/<run>/<name>"
# app/severity.py
STRUCTURAL_CLASSES = {"IfcColumn","IfcBeam","IfcSlab","IfcFooting","IfcMember","IfcPile","IfcPlate"}
WALL_CLASSES = {"IfcWall","IfcWallStandardCase"}                         # structural only when load_bearing is True
OPENINGS_SERVICES = {"IfcDoor","IfcWindow","IfcPipeSegment","IfcPipeFitting","IfcDuctSegment","IfcDuctFitting",
                     "IfcFlowSegment","IfcFlowFitting","IfcCableCarrierSegment","IfcOpeningElement"}
def severity_for(element: Element, status: Status) -> Severity | None   # None for present_ok / cannot_judge
# app/validate.py
CONFIDENCE_FLOOR = 0.5
def repair_check(raw: dict, ctx: CheckContext, elements: dict[str, Element]) -> CheckResult
# app/services.py
Checker = Callable[[bytes, bytes, CheckContext], dict]        # returns CheckResult.model_dump(mode="json")
def make_checker(repo: ProjectRepo, client: Any) -> Checker   # gemini_client.check_asbuilt -> repair_check -> + usage/model_version
def make_asker(repo: ProjectRepo, client: Any) -> Callable[[AskRequest], AskAnswer]
def make_drafter(repo: ProjectRepo, client: Any) -> Callable[[CheckRun, int], IssueDraft]
def http_error_for(err: GeminiError) -> HTTPException         # timeout|unavailable|rate_limited -> 503 model_unavailable; bad_output -> 502;
                                                             # blocked -> 422 model_blocked; bad_request -> 500 model_bad_request
def build_client(settings: Settings) -> Any                   # GEMINI_MODE=fake -> FakeGeminiClient(); live -> gemini_client.default_client()
# app/main.py
def create_app(settings: Settings | None = None, *, store: Store | None = None, repo: ProjectRepo | None = None,
               client: Any = None, now: Callable[[], datetime] = _utcnow, limiter_clock: Callable[[], float] | None = None) -> FastAPI
#   On startup, seeds each project's demo_issues.json into the store as session "demo" with ids "demo-<project>-<n>" (upsert, idempotent).
#   Blocking work (Gemini, store) runs in the threadpool (plain def endpoints or run_in_threadpool).
#   Middleware, outermost first: SecurityHeadersMiddleware (app/security_headers.py), BodySizeLimitMiddleware, GZip.
#   Gemini timeouts: REQUEST_TIMEOUT_MS = 25_000 per attempt, one SDK retry; Cloud Run --timeout 120.
```

## 7. Web modules

```ts
// src/session.ts
export const SESSION_KEY = 'truesite.session'
export function getSessionId(): string                   // crypto.randomUUID(), else a v4 built from crypto.getRandomValues
// src/router.ts
export type Route = { name: 'home' } | { name: 'viewer'; projectId?: string } | { name: 'live'; projectId: string; anchorId: string } | { name: 'samples' } | { name: 'issues' }
export function parseRoute(pathname: string, search = ''): Route   // unknown paths -> home; viewer projectId from ?project=
export function viewerPathFor(projectId: string): string // '/model?project=<id>'
export function navigate(path: string): void             // history.pushState + notify
export function useRoute(): Route                        // React hook (popstate + navigate); path and query
// src/api/client.ts
export class ApiError extends Error { status: number; code?: string; retryAfterS?: number }
export function getProject(projectId: string): Promise<ProjectManifest>
export function postCheck(photo: Blob, render: Blob, ctx: CheckContext): Promise<CheckResponse>   // 120 s timeout
export function getSavedResult(sampleId: string): Promise<CheckResult>
export function fetchRunImage(runId: string, name: 'photo.jpg' | 'render.png'): Promise<string>   // object URL
export function ask(req: AskRequest): Promise<AskAnswer>
export function draftIssue(req: IssueDraftRequest): Promise<IssueDraft>
export function createIssue(req: IssueIn): Promise<Issue>
export function listIssues(projectId?: string): Promise<{ issues: Issue[]; demo: Issue[] }>   // no projectId: every project
// src/pose/index.ts — verified public API, unchanged: Intrinsics {f,cx,cy}, Pose {R,t}, Anchor {position_m,normal,up,scale},
//   centredIntrinsics, focalFromHfov, estimatePose, PoseTracker (update(corners|null, tSec) -> TrackedPose {raw, smoothed, quality, provisional}),
//   projectionMatrixGL({K, videoW, videoH, viewW, viewH, near, far, fit}), modelMatrixIfc(anchor, pose), IFC_FROM_GLTF_MAT4,
//   selfCalibrateFocal(views, s, cx, cy, opts), viewTiltDeg, gradeQuality, codeWidthPx, PoseSmoother, ...
// src/camera/camera.ts — verified: CameraStart, CameraError, REAR_CAMERA_CONSTRAINTS, startRearCamera(video), stopCamera(cam, video?), grabFrame(video, ctx, w, h)
// src/camera/intrinsics.ts
export type StoredIntrinsics = { f: number; videoW: number; videoH: number; source: 'calibrated' | 'default'; at: string }
export const DEFAULT_HFOV_DEG = 63
export function intrinsicsKey(videoW: number, videoH: number): string     // includes orientation, e.g. "1920x1080"
export function loadIntrinsics(videoW: number, videoH: number): Intrinsics          // stored f, else focalFromHfov(63, max(W, H)): 63° across the long side; centred cx, cy
export function saveIntrinsics(videoW: number, videoH: number, f: number): void
export function loadQrSizeCorrection(anchorId: string): number           // multiplier from the check-bar step, default 1
export function saveQrSizeCorrection(anchorId: string, factor: number): void
// src/qr/protocol.ts + src/qr/zxing.worker.ts + src/qr/qrClient.ts — verified worker pattern; QrWorkerClient('zxing') is the only detector in core.
export interface QrDetection { text: string; corners: [Point, Point, Point, Point] }   // symbol order TL,TR,BR,BL, in the pixels of the ImageData sent
// src/qr/link.ts
export function parseAnchorLink(text: string, origin: string): { projectId: string; anchorId: string } | null   // accepts our /a/{p}/{a} URLs only
// src/scene/elements.ts — verified: IFC_GUID_RE, guidOf(obj, known?), idColor(i), decodeId(r,g,b), VisibleElement {index,pixels,coverage,box,centroid,anchor},
//   visibleFromIdBuffer(buf, width, height, minCoverage = 0.0005)
//   anchor (image px, top-down) is where the mark goes: the centroid when that pixel is the element's own, else its pixel furthest from the region's edge.
// src/scene/loadModel.ts
export type LoadedModel = { ifcRoot: THREE.Group; gltfScene: THREE.Group; meshes: THREE.Mesh[]; meshGuid: Map<THREE.Mesh, string>; byGuid: Map<string, THREE.Object3D> }
export function loadModel(url: string, knownGuids: ReadonlySet<string>): Promise<LoadedModel>
export const IFC_TO_THREE: THREE.Matrix4                  // makeRotationX(-Math.PI/2), viewer only
// src/scene/arCamera.ts
export function applyProjection(camera: THREE.PerspectiveCamera, colMajor: number[]): void   // sets projectionMatrix + projectionMatrixInverse
// src/scene/idBuffer.ts
export type IdRender = { buf: Uint8Array; width: number; height: number; indexToGuid: string[] }
export function renderIdBuffer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, model: LoadedModel, camera: THREE.Camera, width: number, height: number, clip?: readonly THREE.Plane[]): Promise<IdRender>
export function renderDesignImage(renderer, scene, model, camera, width, height, classOf: (guid) => string, clip?: readonly THREE.Plane[]): Promise<ImageData>   // opaque design render, rows top-down
//   Both judge what is shown: hidden meshes stay out, and `clip` (the view's cut, look.clipPlanes()) is applied to the override materials.
// src/scene/pins.ts
export function findingAnchorPoint(el: Element): [number, number, number]   // IFC coords: bbox centre
export function makePins(findings: Finding[], elements: Map<string, Element>): THREE.Group        // add under ifcRoot
// src/check/marks.ts
export const MAX_MARKS = 25
export function classPriority(ifcClass: string): number   // 0 structure, 1 openings/services, 2 other
export function selectMarks(visible: VisibleElement[], indexToGuid: string[], elements: Map<string, Element>, max?: number): MarkedElement[]
export function keyDims(el: Element): string
export function markCentres(marks, visible, indexToGuid, width, height): Map<number, [number, number]>   // fractions 0..1, from VisibleElement.anchor
export function drawMarks(ctx: CanvasRenderingContext2D, centres: Map<number, [number, number]>, width: number, height: number): void
// src/check/snapshot.ts
export type Snapshot = { photo: Blob; photoW: number; photoH: number; videoW: number; videoH: number; corners: Point[] | null }
export function captureSnapshot(video: HTMLVideoElement, qr?: QrWorkerClient): Promise<Snapshot>   // JPEG (long side <= 1600 px, quality 0.85); re-detects the code on the full frame
// src/check/runCheck.ts
export type CheckInput = { photo: Blob; photoW: number; photoH: number; videoW: number; videoH: number; K: Intrinsics; pose: Pose; anchor: Anchor;
                           poseQuality: PoseQuality; model: LoadedModel; scene: THREE.Scene; renderer: THREE.WebGLRenderer; elements: ReadonlyMap<string, Element>; sampleId?: string;
                           look?: ConstructionLook }   // live AR: hidden layers, cut and view distance apply at the snapshot pose
export function runCheck(input: CheckInput): Promise<{ response: CheckResponse | null; saved: CheckResult | null; error: ApiError | null; marks: MarkedElement[]; render: Blob | null;
                           viewNote: string | null }>   // "Checked as shown: Rebar hidden; cut above 3.3 m." or null
```

## 8. Samples

`web/public/samples/index.json` = `[{ "sample_id", "label", "project_id", "anchor_id" }]`. Each `<sample_id>/meta.json`:

```json
{ "sample_id": "room1-door", "project_id": "room1", "anchor_id": "A1", "label": "Room — door wall",
  "video_w": 1920, "video_h": 1080, "K": { "f": 1500.0, "cx": 960, "cy": 540 },
  "pose": { "R": [1,0,0,0,1,0,0,0,1], "t": [0, 0, 1.5] }, "captured_at": "2026-10-13T10:00:00Z" }
```

Samples are captured with the app itself (dev-only "Save as sample" button behind `?dev=1`). They are regenerated whenever the model's GUIDs change.

## 9. Commands

| What | Command |
|---|---|
| BIM tests | `cd bim && uv run pytest -q` |
| Rebuild models | `cd bim && uv run python -m truesite_bim.pipeline models/room1/model.ifc --out models/room1` |
| Server tests | `cd server && uv run pytest -q` |
| Server dev | `cd server && GEMINI_MODE=fake uv run uvicorn --factory app.main:create_app --reload --port 8000` |
| Web tests | `cd web && npx vitest run` · typecheck `npx tsc -b` · build `npm run build` |
| Web dev | `cd web && npm run dev` (proxy `/api` → `127.0.0.1:8000`) · phones: `npm run dev:https` |
| Everything | `make test` (bim + server + web) |

## 10. File ownership (so plan parts never collide)

**Server routing.** `app/main.py` (Part 1) builds the app and `app.state`:
- `settings`, `store`, `repo`, `client`, `now`
- `check_limiter` (CHECKS_PER_IP_PER_HOUR / 3600 s), `ask_limiter` (ASKS_PER_IP_PER_HOUR / 3600 s) and `issue_limiter` (ISSUES_PER_IP_PER_HOUR / 3600 s)

It then includes routers. Each router module exposes `router = APIRouter()` and gets everything through `app/deps.py` (Part 1):

```python
# app/deps.py
def get_settings(request: Request) -> Settings
def get_store(request: Request) -> Store
def get_repo(request: Request) -> ProjectRepo
def get_client(request: Request) -> Any
def get_now(request: Request) -> Callable[[], datetime]
SessionId = Annotated[str, Header(alias="X-Session-Id", pattern=SESSION_ID_PATTERN)]   # missing/malformed -> 422
SettingsDep, StoreDep, RepoDep, ClientDep = Annotated[...]                            # Depends(...) aliases
def enforce_rate_limit(request: Request, limiter_name: str) -> None
    # per-IP limiter only -> 429 rate_limited (+Retry-After); POST /api/issues ("issue_limiter")
def enforce_limits(request: Request, limiter_name: str, day_suffix: str, cap: int) -> None
    # per-IP limiter -> 429 rate_limited (+Retry-After); store.try_consume_daily(f"{day}{day_suffix}", cap) -> 429 daily_cap; store error -> 503 busy
```

| Router file | Part | Routes |
|---|---|---|
| `app/routes/projects.py` | 1 | `/api/projects/{project_id}`, `/api/projects/{project_id}/model.glb` |
| `app/routes/check.py` | 3 | `/api/check`, `/api/runs/{run_id}/{name}`, `/api/saved-results/{sample_id}` |
| `app/routes/ask.py` | 4 | `/api/ask` |
| `app/routes/issues.py` | 4 | `/api/issues/draft`, `/api/issues` (POST and GET) |

`/api/health` and `/api/whoami` live in `main.py`. Part 1's `main.py` already contains the `include_router` lines for all four routers. Parts 3 and 4 *create* their router files, and Part 1 ships each of them as a stub (`router = APIRouter()` with no routes), so `main.py` never changes after Part 1.

**Web pages.** Part 1's `App.tsx` routes to these pages:

| Page file | Created by | Replaced by |
|---|---|---|
| `src/ui/ViewerPage.tsx` | Part 1 | — |
| `src/ui/LivePage.tsx` | Part 1 (stub) | Part 2 |
| `src/ui/SamplesPage.tsx` | Part 1 (stub) | Part 3 |
| `src/ui/IssuesPage.tsx` | Part 1 (stub) | Part 4 |

`App.tsx` never changes after Part 1. Shared panels have one owner each:

| Panel | Owner |
|---|---|
| `src/ui/ElementPanel.tsx` (properties) | Part 1 |
| `src/ui/AskBox.tsx` | Part 4 (Part 1's ElementPanel renders `<AskBox …/>` from a stub file) |
| `src/ui/FindingsPanel.tsx`, `src/ui/EvidenceView.tsx` | Part 3 |
| `src/ui/IssueDialog.tsx` | Part 4 (Part 1 ships a stub with the final props type) |
| `src/ui/QualityBadge.tsx`, `src/ui/CalibrationPanel.tsx` | Part 2 |

A part that must change a file it does not own shows the exact old and new text in its plan step.
