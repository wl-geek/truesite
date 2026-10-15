# Reference code (verified 11 Oct 2026, now ported)

This code ran and passed tests in the research workspace. It has since been ported into the paths in the "Goes to" column (see the [contract](../../plans/2026-10-11-truesite-contract.md)); the copies here are the originals, kept for the record. Edit the app's files, not these. Build tools ignore this folder.

| File | Goes to | Notes |
|---|---|---|
| `web/camera.ts` | `web/src/camera/camera.ts` | `startRearCamera`, `stopCamera`, `grabFrame`, `CameraError`. Written to the iOS/Android requirements but **not yet run on a phone** |
| `web/protocol.ts`, `web/zxing.worker.ts`, `web/qrClient.ts` | `web/src/qr/` | zxing-wasm module worker; the wasm is served from our own origin. `qrClient.ts` also has a jsQR branch; drop it (and `qr.worker.ts`) when porting, since the contract uses zxing only |
| `web/jsqrDetect.ts`, `web/qr.worker.ts` | not needed in core | jsQR path, kept for the comparison test and as an optional sub-pixel refiner |
| `web/synthQr.ts`, `web/qrPng.ts` | `web/src/test-support/synthQr.ts`, `web/src/test-support/qrPng.ts` | Synthetic QR rendering through a known camera and pose, with exact ground-truth corners, for tests. The ported copy leaves out `degrade`, `downsample2x` and `rotZ`, which only the optional comparison tests and `selftest.ts` use |
| `web/detectorCompare.test.ts`, `web/jsqrCorners.test.ts` | optional | Detector accuracy and speed comparisons |
| `web/selftest.ts` | optional | In-browser self-test page (worker speed, BarcodeDetector, WebGL ID colours) |
| `server/main_with_check_route.py` | pattern for `server/app/routes/check.py` | The verified `/api/check` flow: limits, daily cap, threadpool checker, best-effort persistence, `/api/runs/...`, `/api/saved-results/...` |
| `server/test_upload.py` | pattern for `server/tests/test_check_route.py` | 413/415/422 and saved-result tests |
