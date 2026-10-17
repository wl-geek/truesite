"""Property tests for uploads.read_image: the size limit first (413), then the magic bytes (415)."""
from __future__ import annotations

import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile
from hypothesis import given, settings, strategies as st

from app.uploads import JPEG_MAGIC, PNG_MAGIC, read_image

MAGIC = {"jpeg": JPEG_MAGIC, "png": PNG_MAGIC}


def read(data: bytes, kind: str, limit: int, size_known: bool) -> bytes:
    # A browser upload has a size; a chunked one may not. Both paths must give the same answer.
    upload = UploadFile(io.BytesIO(data), size=len(data) if size_known else None)
    return asyncio.run(read_image(upload, field="photo", kind=kind, limit=limit))


@settings(max_examples=200, deadline=None)
@given(st.sampled_from(["jpeg", "png"]), st.sampled_from(["jpeg", "png", None]), st.binary(max_size=40),
       st.integers(0, 48), st.booleans())
def test_read_image_checks_the_size_then_the_type(kind, prefix, tail, limit, size_known):
    data = (MAGIC[prefix] if prefix else b"") + tail
    if len(data) > limit:
        expected = 413
    elif data.startswith(MAGIC[kind]):
        assert read(data, kind, limit, size_known) == data
        return
    else:
        expected = 415
    with pytest.raises(HTTPException) as exc:
        read(data, kind, limit, size_known)
    assert exc.value.status_code == expected
    assert exc.value.detail.startswith("photo ")
