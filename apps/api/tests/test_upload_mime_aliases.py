"""Browsers spell the same container differently; each spelling must be accepted."""
import pytest

from apps.api.models.asset import AssetType
from apps.api.schemas.upload import ALLOWED_MIME_TYPES, mime_to_asset_type


@pytest.mark.parametrize(
    "mime, expected",
    [
        ("audio/wav", AssetType.audio),  # Chrome
        ("audio/x-wav", AssetType.audio),  # Safari
        ("audio/vnd.wave", AssetType.audio),  # .bwf
        ("audio/aiff", AssetType.audio),
        ("audio/x-aiff", AssetType.audio),
        ("audio/x-flac", AssetType.audio),
        ("audio/mp4", AssetType.audio),  # .m4a in some browsers
        ("video/x-m4v", AssetType.video),
        ("video/avi", AssetType.video),
        ("video/matroska", AssetType.video),
    ],
)
def test_browser_spellings_are_accepted_and_typed(mime, expected):
    assert mime in ALLOWED_MIME_TYPES
    assert mime_to_asset_type(mime) == expected


def test_original_types_still_pass():
    for mime in ("audio/mpeg", "video/mp4", "video/quicktime", "video/x-matroska", "image/png"):
        assert mime in ALLOWED_MIME_TYPES
