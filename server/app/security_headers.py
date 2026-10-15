"""Security response headers on every response, SPA and API alike (audit A-25).

- nosniff, a strict-origin referrer, and no framing by other sites (X-Frame-Options DENY).
- Permissions-Policy: the camera, the motion sensors (look-around) and WebXR stay on for this
  origin only; the microphone and geolocation, which the app never uses, are off.
- The CSP is sent as Content-Security-Policy-Report-Only for now: browsers log what it would
  block in the console and block nothing. Switch to the enforcing header once a phone session
  (QR worker + wasm, camera, AR, Quick Look, issues) shows no reports.
- /api responses that set no Cache-Control get no-store (session-scoped JSON). Routes that set
  their own keep it: model.glb revalidates (no-cache), run images are private.

No COOP or COEP: the app needs no cross-origin isolation.
"""
from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

CSP_REPORT_ONLY = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",  # zxing-wasm compiles in the QR module worker
    "worker-src 'self' blob:",
    "img-src 'self' blob: data:",  # URL.createObjectURL photos, glb textures
    "media-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

PERMISSIONS_POLICY = ", ".join([
    "camera=(self)",
    "gyroscope=(self)",
    "accelerometer=(self)",
    "magnetometer=(self)",
    "xr-spatial-tracking=(self)",
    "microphone=()",
    "geolocation=()",
])

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
}


def _is_api(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


class SecurityHeadersMiddleware:
    """Pure ASGI, so it also covers responses sent by inner middleware (e.g. the early 413)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        api = _is_api(scope.get("path", ""))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in HEADERS.items():
                    headers.setdefault(name, value)
                if api:
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_with_headers)
