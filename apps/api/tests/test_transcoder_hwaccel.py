from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

import anyio
import pytest

from packages.transcoder import hwaccel
from packages.transcoder.base import TranscodeJob, TranscodeResult
from packages.transcoder.hwaccel import (
    BACKENDS,
    build_hls_command,
    resolve_backend,
    select_backend,
)


QUALITY_MAP = {
    "1080p": ("1920:1080", 20),
    "720p": ("1280:720", 22),
    "360p": ("640:360", 26),
}

QUALITIES = ["1080p", "720p", "360p"]


def _build(backend: str, hls_dir: Path) -> list[str]:
    return build_hls_command(
        "https://example.test/input.mp4",
        QUALITIES,
        QUALITY_MAP,
        hls_dir,
        backend,
    )


def _filter_complex(cmd: list[str]) -> str:
    return cmd[cmd.index("-filter_complex") + 1]


class TestSelectBackend:
    def test_select_backend_auto_prefers_backends_when_available(self) -> None:
        assert select_backend("auto", "h264_nvenc h264_qsv h264_vaapi", True, True) == "nvenc"
        assert select_backend("auto", "h264_qsv h264_vaapi", True, False) == "qsv"
        assert select_backend("auto", "h264_vaapi", True, False) == "vaapi"
        assert select_backend("auto", "", False, False) == "software"

    def test_select_backend_forced_backend_ignores_probe(self) -> None:
        assert select_backend("vaapi", "", False, False) == "vaapi"
        assert select_backend("software", "", False, False) == "software"


class TestResolveBackend:
    def test_resolve_backend_auto_selects_nvenc_from_probe_and_device_state(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        checked_dirs = []
        checked_paths = []
        def fake_isdir(path: str) -> bool:
            checked_dirs.append(path)
            return False

        def fake_exists(path: str) -> bool:
            checked_paths.append(path)
            return path == "/dev/nvidiactl"

        monkeypatch.setattr(hwaccel.os.path, "isdir", fake_isdir)
        monkeypatch.setattr(hwaccel.os.path, "exists", fake_exists)
        monkeypatch.setattr(hwaccel.shutil, "which", lambda name: None)
        monkeypatch.setattr(hwaccel, "probe_encoders", lambda: "V..... h264_nvenc")

        assert resolve_backend("auto", "/dev/dri/renderD128") == "nvenc"
        assert checked_dirs == ["/dev/dri"]
        assert checked_paths == ["/dev/nvidiactl"]


class TestRuntimeFallback:
    def test_transcode_retries_with_software_after_hardware_failure(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from packages.transcoder import ffmpeg_transcoder

        build_backends = []
        run_commands = []
        hls_dirs: list[Path] = []
        partial_numeric_outputs: list[Path] = []

        def fake_build_hls_command(
            input_url: str,
            qualities: list[str],
            quality_map: dict[str, tuple[str, int]],
            hls_dir: Path,
            backend: str,
            device: str,
        ) -> list[str]:
            build_backends.append(backend)
            hls_dirs.append(hls_dir)
            return ["ffmpeg-hls", backend]

        def fake_run(cmd: list[str], **kwargs: bool | int | str) -> subprocess.CompletedProcess[str]:
            run_commands.append(cmd)
            if cmd == ["ffmpeg-hls", "nvenc"]:
                partial_output = hls_dirs[-1] / "0" / "seg_000.ts"
                partial_output.parent.mkdir()
                partial_output.write_text("partial hardware segment", encoding="utf-8")
                partial_numeric_outputs.append(partial_output)
                raise subprocess.CalledProcessError(1, cmd)
            if cmd == ["ffmpeg-hls", "software"]:
                partial_output = partial_numeric_outputs[-1]
                assert not partial_output.exists()
                assert not partial_output.parent.exists()
                for quality in QUALITIES:
                    assert (hls_dirs[-1] / quality).is_dir()
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        monkeypatch.setattr(ffmpeg_transcoder, "resolve_backend", lambda setting, device: "nvenc")
        monkeypatch.setattr(ffmpeg_transcoder, "build_hls_command", fake_build_hls_command)
        monkeypatch.setattr(ffmpeg_transcoder.subprocess, "run", fake_run)

        s3 = SimpleNamespace(
            generate_presigned_url=lambda *args, **kwargs: "https://example.test/input.mp4",
            upload_file=lambda *args, **kwargs: None,
        )
        transcoder = ffmpeg_transcoder.FFmpegTranscoder(s3, "freeframe-test")
        job = TranscodeJob(
            media_id="asset-1",
            version_id="version-1",
            input_s3_key="raw/input.mp4",
            output_s3_prefix="processed/asset-1/version-1",
        )

        result = anyio.run(transcoder.transcode, job)

        assert result.success is True
        assert build_backends == ["nvenc", "software"]
        assert ["ffmpeg-hls", "software"] in run_commands


class TestTaskSettingsWiring:
    def test_process_video_passes_settings_to_transcoder(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from apps.api.tasks import transcode_tasks
        from packages.transcoder import ffmpeg_transcoder

        captured = {}

        class RecordingTranscoder:
            def __init__(
                self,
                s3_client: SimpleNamespace,
                bucket: str,
                s3_endpoint: str | None = None,
                *,
                hwaccel: str,
                vaapi_device: str,
            ) -> None:
                captured["s3_client"] = s3_client
                captured["bucket"] = bucket
                captured["s3_endpoint"] = s3_endpoint
                captured["hwaccel"] = hwaccel
                captured["vaapi_device"] = vaapi_device

            async def transcode(self, job: TranscodeJob) -> TranscodeResult:
                captured["job"] = job
                return TranscodeResult(
                    success=True,
                    hls_prefix="processed/asset-1/version-1",
                    thumbnail_keys=["processed/asset-1/version-1/thumbnail.jpg"],
                )

        class FakeDb:
            flushed = False

            def flush(self) -> None:
                self.flushed = True

        monkeypatch.setattr(ffmpeg_transcoder, "FFmpegTranscoder", RecordingTranscoder)
        monkeypatch.setattr(transcode_tasks.settings, "s3_bucket", "freeframe-test")
        monkeypatch.setattr(transcode_tasks.settings, "s3_endpoint", "http://minio:9000")
        monkeypatch.setattr(transcode_tasks.settings, "transcode_hwaccel", "vaapi")
        monkeypatch.setattr(
            transcode_tasks.settings,
            "transcode_vaapi_device",
            "/dev/dri/renderD129",
        )

        db = FakeDb()
        media_file = SimpleNamespace(s3_key_raw="raw/input.mp4")
        s3 = SimpleNamespace()

        transcode_tasks._process_video(
            db,
            SimpleNamespace(id="asset-1"),
            SimpleNamespace(id="version-1"),
            media_file,
            s3,
            "processed/asset-1/version-1",
        )

        assert captured["s3_client"] is s3
        assert captured["bucket"] == "freeframe-test"
        assert captured["s3_endpoint"] == "http://minio:9000"
        assert captured["hwaccel"] == "vaapi"
        assert captured["vaapi_device"] == "/dev/dri/renderD129"
        assert captured["job"].input_s3_key == "raw/input.mp4"
        assert media_file.s3_key_processed == "processed/asset-1/version-1"
        assert media_file.s3_key_thumbnail == "processed/asset-1/version-1/thumbnail.jpg"
        assert db.flushed is True


class TestBuildHlsCommand:
    def test_build_hls_command_software_preserves_hls_flags_and_x264_args(
        self,
        tmp_path: Path,
    ) -> None:
        cmd = _build("software", tmp_path)
        expected_filter = (
            "[v:0]split=3[v0][v1][v2];"
            "[v0]scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=ceil(iw/2)*2:ceil(ih/2)*2[1080p];"
            "[v1]scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=ceil(iw/2)*2:ceil(ih/2)*2[720p];"
            "[v2]scale=640:360:force_original_aspect_ratio=decrease,"
            "pad=ceil(iw/2)*2:ceil(ih/2)*2[360p]"
        )
        expected_hls_tail = [
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_playlist_type",
            "vod",
            "-hls_flags",
            "independent_segments",
            "-hls_segment_type",
            "mpegts",
            "-master_pl_name",
            "master.m3u8",
            "-var_stream_map",
            "v:0,a:0 v:1,a:1 v:2,a:2",
            "-hls_segment_filename",
            str(tmp_path / "%v" / "seg_%03d.ts"),
            str(tmp_path / "%v" / "playlist.m3u8"),
        ]

        assert "libx264" in cmd
        assert cmd[cmd.index("-crf") + 1] == "20"
        assert _filter_complex(cmd) == expected_filter
        assert "-vaapi_device" not in cmd
        assert cmd[-len(expected_hls_tail) :] == expected_hls_tail

    def test_build_hls_command_nvenc_uses_nvenc_without_hwupload_or_vaapi_device(
        self,
        tmp_path: Path,
    ) -> None:
        cmd = _build("nvenc", tmp_path)

        assert "h264_nvenc" in cmd
        assert "-cq" in cmd
        assert "hwupload" not in _filter_complex(cmd)
        assert "-vaapi_device" not in cmd

    def test_build_hls_command_vaapi_adds_device_encoder_and_upload_filter(
        self,
        tmp_path: Path,
    ) -> None:
        cmd = _build("vaapi", tmp_path)

        assert "-vaapi_device" in cmd
        assert "h264_vaapi" in cmd
        assert ",format=nv12,hwupload" in _filter_complex(cmd)

    def test_build_hls_command_qsv_adds_device_encoder_and_upload_filter(
        self,
        tmp_path: Path,
    ) -> None:
        cmd = _build("qsv", tmp_path)

        assert "-init_hw_device" in cmd
        assert "h264_qsv" in cmd
        assert "hwupload=extra_hw_frames=64,format=qsv" in _filter_complex(cmd)

    @pytest.mark.parametrize("backend", BACKENDS)
    def test_build_hls_command_structure_invariant_for_every_backend(
        self,
        backend: str,
        tmp_path: Path,
    ) -> None:
        cmd = _build(backend, tmp_path)

        assert cmd[0] == "ffmpeg"
        assert cmd[-1].endswith("playlist.m3u8")
        assert cmd.count("a:0") == len(QUALITIES)
