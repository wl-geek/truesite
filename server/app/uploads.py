"""Upload size limits and image sniffing.

Two layers, because Starlette's multipart parser has no limit on *file* parts
(its `max_part_size` only applies to plain form fields) and spools large
files to disk -- which on Cloud Run is RAM:

1. BodySizeLimitMiddleware caps the whole request body. It rejects early on
   Content-Length and, for chunked bodies with no Content-Length, counts bytes
   as they arrive and aborts with 413.
2. read_image() caps each file part (4 MiB by default) and checks magic bytes.
"""

from __future__ import annotations

import json

from fastapi import HTTPException, UploadFile
from starlette.types import ASGIApp, Message, Receive, Scope, Send

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class BodyTooLarge(HTTPException):
    """A FastAPI HTTPException, so FastAPI's body reader re-raises it as-is
    (it turns any *other* exception raised while parsing into a 400)."""

    def __init__(self, limit: int) -> None:
        super().__init__(status_code=413, detail=f"Request body larger than {limit} bytes")


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope["headers"]:
            if name == b"content-length":
                if not value.isdigit():
                    await _send_json(send, 400, {"detail": "Invalid Content-Length"})
                    return
                if int(value) > self.max_bytes:
                    await _send_json(send, 413, {"detail": f"Request body larger than {self.max_bytes} bytes"})
                    return

        received = 0
        response_started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BodyTooLarge(self.max_bytes)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except BodyTooLarge:
            # Normally FastAPI's exception handler has already answered 413;
            # this covers code paths that read the body outside FastAPI.
            if response_started:
                raise
            await _send_json(send, 413, {"detail": f"Request body larger than {self.max_bytes} bytes"})


async def _send_json(send: Send, status: int, body: dict) -> None:
    payload = json.dumps(body, separators=(",", ":")).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": payload})


async def read_image(upload: UploadFile, *, field: str, kind: str, limit: int) -> bytes:
    """Read one uploaded image part; 413 if over `limit`, 415 if not `kind`."""
    if upload.size is not None and upload.size > limit:
        raise HTTPException(status_code=413, detail=f"{field} is larger than {limit} bytes")
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"{field} is larger than {limit} bytes")
    magic = JPEG_MAGIC if kind == "jpeg" else PNG_MAGIC
    if not data.startswith(magic):
        raise HTTPException(status_code=415, detail=f"{field} must be a {kind.upper()} image")
    return data
