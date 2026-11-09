"""HLS output is uploaded several files at a time, and a failed upload fails the transcode."""
import threading
import time
from pathlib import Path

import pytest

from packages.transcoder.ffmpeg_transcoder import FFmpegTranscoder


class _FakeS3:
    def __init__(self, fail_on: str | None = None):
        self.fail_on = fail_on
        self.keys: list[str] = []
        self.in_flight = 0
        self.peak = 0
        self._lock = threading.Lock()

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        with self._lock:
            self.in_flight += 1
            self.peak = max(self.peak, self.in_flight)
        time.sleep(0.02)  # a round trip
        try:
            if self.fail_on and self.fail_on in key:
                raise RuntimeError("PUT refused")
            with self._lock:
                self.keys.append(key)
        finally:
            with self._lock:
                self.in_flight -= 1


def _hls_tree(root: Path, segments: int = 12) -> None:
    (root / "0").mkdir()
    (root / "0" / "playlist.m3u8").write_text("#EXTM3U")
    for i in range(segments):
        (root / "0" / f"seg_{i:03d}.ts").write_bytes(b"ts")
    (root / "master.m3u8").write_text("#EXTM3U")


def test_uploads_every_file_with_its_prefix_and_overlaps_the_puts(tmp_path):
    _hls_tree(tmp_path)
    s3 = _FakeS3()

    keys = FFmpegTranscoder(s3, "bucket")._upload_directory(tmp_path, "processed/a/v1")

    assert sorted(s3.keys) == keys
    assert "processed/a/v1/master.m3u8" in keys
    assert "processed/a/v1/0/seg_011.ts" in keys
    assert len(keys) == 14
    assert s3.peak > 1  # a serial loop would never exceed one


def test_a_failed_upload_fails_the_transcode(tmp_path):
    _hls_tree(tmp_path)

    with pytest.raises(RuntimeError, match="PUT refused"):
        FFmpegTranscoder(_FakeS3(fail_on="seg_005"), "bucket")._upload_directory(tmp_path, "p")


def test_an_empty_directory_uploads_nothing(tmp_path):
    assert FFmpegTranscoder(_FakeS3(), "bucket")._upload_directory(tmp_path, "p") == []
