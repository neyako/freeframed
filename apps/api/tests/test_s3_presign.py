"""Presigned URLs must be path-style on the configured public endpoint.

The all-in-one image serves object storage same-origin: nginx routes
/<bucket>/ to the bundled MinIO, and entrypoint.sh defaults
S3_PUBLIC_ENDPOINT to FRONTEND_URL. That only works if boto3 presigns
path-style (/<bucket>/<key>) instead of virtual-host style
(<bucket>.<host>), which would mint a subdomain the deployment doesn't
have.
"""

from unittest.mock import patch

from apps.api.config import settings
from apps.api.services import s3_service


def _presign(key: str) -> str:
    with (
        patch.object(settings, "s3_storage", "minio"),
        patch.object(settings, "s3_bucket", "freeframe"),
        patch.object(settings, "s3_public_endpoint", "http://nas.example.com:8080"),
    ):
        return s3_service.generate_presigned_get_url(key)


def test_presigned_get_is_path_style_on_public_endpoint():
    url = _presign("processed/abc/720p/segment_000.ts")
    assert url.startswith(
        "http://nas.example.com:8080/freeframe/processed/abc/720p/segment_000.ts?"
    ), f"expected same-origin path-style URL, got: {url}"
    assert "Signature=" in url  # matches both SigV2 and SigV4 query auth


def test_presigned_upload_part_is_path_style_on_public_endpoint():
    with (
        patch.object(settings, "s3_storage", "minio"),
        patch.object(settings, "s3_bucket", "freeframe"),
        patch.object(settings, "s3_public_endpoint", "http://nas.example.com:8080"),
    ):
        url = s3_service.presign_upload_part("raw/abc/video.mp4", "upload-1", 1)
    assert url.startswith("http://nas.example.com:8080/freeframe/raw/abc/video.mp4?")
    assert "partNumber=1" in url
