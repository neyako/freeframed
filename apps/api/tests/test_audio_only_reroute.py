"""An audio-only file in a video container is audio, not a failed transcode."""
import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from apps.api.models.asset import AssetType, FileType
from apps.api.tasks import transcode_tasks
from packages.transcoder.base import TranscodeJob, TranscodeResult
from packages.transcoder.ffmpeg_transcoder import FFmpegTranscoder


def _job() -> TranscodeJob:
    return TranscodeJob(
        media_id="m", version_id="v", input_s3_key="raw/a/original.mp4", output_s3_prefix="processed/a",
    )


def test_transcoder_reports_a_source_with_audio_but_no_video():
    s3 = MagicMock()
    s3.generate_presigned_url.return_value = "https://s3.test/raw?X-Amz-Signature=abc"
    probe = MagicMock(stdout=json.dumps({"streams": [{"codec_type": "audio"}], "format": {"duration": "12"}}))

    with patch("packages.transcoder.ffmpeg_transcoder.subprocess.run", return_value=probe) as run:
        result = asyncio.run(FFmpegTranscoder(s3, "bucket").transcode(_job()))

    assert result.no_video_stream and not result.success
    assert run.call_count == 1  # ffprobe only: no ffmpeg run was attempted


def test_task_processes_such_an_asset_as_audio():
    asset = MagicMock(id=uuid.uuid4(), project_id=uuid.uuid4(), asset_type=AssetType.video)
    version = MagicMock(id=uuid.uuid4())
    media_file = MagicMock(file_type=FileType.video, s3_key_raw="raw/a/original.mp4")
    db = MagicMock()
    result = TranscodeResult(success=False, no_video_stream=True, error="No video stream")

    with (
        patch("packages.transcoder.ffmpeg_transcoder.FFmpegTranscoder") as transcoder,
        patch.object(transcode_tasks, "_process_audio") as process_audio,
    ):
        transcoder.return_value.transcode = AsyncMock(return_value=result)
        transcode_tasks._process_video(db, asset, version, media_file, MagicMock(), "processed/a")

    assert asset.asset_type == AssetType.audio
    assert media_file.file_type == FileType.audio
    process_audio.assert_called_once()
