"""Attachments render inline only when a browser can't execute them (#same-origin bucket)."""
import pytest

from apps.api.routers.comments import _renders_inline_safely


@pytest.mark.parametrize("content_type", ["image/png", "video/mp4", "audio/wav", "IMAGE/JPEG"])
def test_media_types_render_inline(content_type):
    assert _renders_inline_safely(content_type)


@pytest.mark.parametrize(
    "content_type",
    ["text/html", "image/svg+xml", "IMAGE/SVG+XML", "image/svg+xml; charset=utf-8", "application/pdf"],
)
def test_executable_or_unknown_types_download(content_type):
    assert not _renders_inline_safely(content_type)
