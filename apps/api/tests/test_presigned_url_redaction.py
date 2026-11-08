"""A transcode error must not carry the presigned input URL, and must say why ffmpeg failed."""
import asyncio
import json
import subprocess
from unittest.mock import MagicMock, patch

from packages.transcoder.base import TranscodeJob
from packages.transcoder.ffmpeg_transcoder import FFmpegTranscoder
from packages.transcoder.redact import redact_presigned_urls

SIGNED = (
    "https://nas.local/freeframe/raw/p/a/v/original.mp4"
    "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20261108%2Fus-east-1%2Fs3%2Faws4_request"
    "&X-Amz-Date=20261108T000000Z&X-Amz-Expires=7200&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef"
)


def test_signed_query_goes_but_the_object_path_stays():
    out = redact_presigned_urls(f"{SIGNED}: Server returned 403 Forbidden")
    assert out == "https://nas.local/freeframe/raw/p/a/v/original.mp4?<redacted>: Server returned 403 Forbidden"


def test_host_less_request_lines_and_sigv2_are_covered_and_ordinary_queries_are_not():
    assert "deadbeef" not in redact_presigned_urls("request: GET /b/k?X-Amz-Signature=deadbeef HTTP/1.1")
    assert "abc" not in redact_presigned_urls("https://s3.test/k?AWSAccessKeyId=AKIA&Signature=abc&Expires=1")
    assert redact_presigned_urls("see https://example.com/page?tab=2.") == "see https://example.com/page?tab=2."


def _failing_transcode(error: Exception) -> str:
    s3 = MagicMock()
    s3.generate_presigned_url.return_value = SIGNED
    job = TranscodeJob(media_id="m", version_id="v", input_s3_key="raw/k", output_s3_prefix="processed/k")
    probe = MagicMock(stdout=json.dumps({"streams": [{"codec_type": "video", "width": 1920, "height": 1080}]}))
    with (
        patch("packages.transcoder.ffmpeg_transcoder.subprocess.run", return_value=probe),
        patch("packages.transcoder.ffmpeg_transcoder.resolve_backend", return_value="software"),
        patch.object(FFmpegTranscoder, "_run_ffmpeg_with_progress", side_effect=error),
    ):
        result = asyncio.run(FFmpegTranscoder(s3, "bucket").transcode(job))
    assert result.success is False
    return result.error


def test_failed_ffmpeg_reports_its_stderr_without_the_signed_url():
    error = subprocess.CalledProcessError(
        1, ["ffmpeg", "-y", "-i", SIGNED], stderr=f"{SIGNED}: Server returned 403 Forbidden\n".encode(),
    )
    message = _failing_transcode(error)

    assert message.startswith("ffmpeg exited 1: ")
    assert "Server returned 403 Forbidden" in message
    assert "X-Amz-Signature" not in message and "AKIAEXAMPLE" not in message


def test_timeout_quotes_no_signed_url():
    message = _failing_transcode(subprocess.TimeoutExpired(["ffmpeg", "-i", SIGNED], 14400))

    assert "timed out" in message
    assert "X-Amz-Signature" not in message
