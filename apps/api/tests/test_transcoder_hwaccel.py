from __future__ import annotations

import hashlib
import logging
import subprocess
from pathlib import Path
from types import SimpleNamespace

import anyio
import pytest

from packages.transcoder import hwaccel
from packages.transcoder.base import TranscodeJob, TranscodeResult
from packages.transcoder.ffmpeg_transcoder import _parse_progress_percent, _stderr_tail
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


def _build(backend: str, hls_dir: Path, *, hw_decode: bool = False) -> list[str]:
    return build_hls_command(
        "https://example.test/input.mp4",
        QUALITIES,
        QUALITY_MAP,
        hls_dir,
        backend,
        hw_decode=hw_decode,
    )


def _filter_complex(cmd: list[str]) -> str:
    return cmd[cmd.index("-filter_complex") + 1]


class TestSelectBackend:
    def test_select_backend_auto_prefers_backends_when_available(self) -> None:
        assert select_backend("auto", "h264_nvenc h264_qsv h264_vaapi", True, True) == "nvenc"
        assert select_backend("auto", "h264_qsv h264_vaapi", True, False) == "vaapi"
        assert select_backend("auto", "h264_vaapi", True, False) == "vaapi"
        assert select_backend("auto", "h264_qsv", True, False) == "qsv"
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
    @pytest.mark.parametrize(
        ("resolved_backend", "failed_modes", "expected_build_modes"),
        [
            (
                "nvenc",
                [("nvenc", b"nvenc stderr")],
                [("nvenc", False), ("software", False)],
            ),
            (
                "vaapi",
                [
                    ("vaapi-full-hw", b"full-hw bytes stderr"),
                    ("vaapi-hwupload", "hwupload string stderr"),
                ],
                [
                    ("vaapi", True),
                    ("vaapi", False),
                    ("software", False),
                ],
            ),
        ],
    )
    def test_transcode_logs_and_falls_back_through_expected_modes(
        self,
        caplog: pytest.LogCaptureFixture,
        monkeypatch: pytest.MonkeyPatch,
        resolved_backend: str,
        failed_modes: list[tuple[str, str | bytes]],
        expected_build_modes: list[tuple[str, bool]],
    ) -> None:
        from packages.transcoder import ffmpeg_transcoder

        build_modes: list[tuple[str, bool]] = []
        hls_dirs: list[Path] = []
        partial_outputs: list[Path] = []
        stderr_by_mode = dict(failed_modes)

        def fake_build_hls_command(
            input_url: str,
            qualities: list[str],
            quality_map: dict[str, tuple[str, int]],
            hls_dir: Path,
            backend: str,
            device: str,
            hw_decode: bool = False,
        ) -> list[str]:
            build_modes.append((backend, hw_decode))
            hls_dirs.append(hls_dir)
            if backend == "vaapi":
                mode = "vaapi-full-hw" if hw_decode else "vaapi-hwupload"
            else:
                mode = backend
            return ["ffmpeg-hls", mode]

        def fake_run(
            cmd: list[str],
            **kwargs: bool | int | str,
        ) -> subprocess.CompletedProcess[str]:
            if cmd[:1] != ["ffmpeg-hls"]:
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            if partial_outputs:
                previous_output = partial_outputs[-1]
                assert not previous_output.exists()
                assert not previous_output.parent.exists()
            for quality in QUALITIES:
                assert (hls_dirs[-1] / quality).is_dir()

            mode = cmd[1]
            if mode == "software":
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            partial_output = hls_dirs[-1] / str(len(partial_outputs)) / "seg_000.ts"
            partial_output.parent.mkdir()
            partial_output.write_text(f"partial {mode} segment", encoding="utf-8")
            partial_outputs.append(partial_output)
            raise subprocess.CalledProcessError(1, cmd, stderr=stderr_by_mode[mode])

        monkeypatch.setattr(
            ffmpeg_transcoder,
            "resolve_backend",
            lambda setting, device: resolved_backend,
        )
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

        with caplog.at_level(logging.INFO, logger=ffmpeg_transcoder.__name__):
            result = anyio.run(transcoder.transcode, job)

        assert result.success is True
        assert build_modes == expected_build_modes
        info_messages = [
            record.getMessage()
            for record in caplog.records
            if record.name == ffmpeg_transcoder.__name__ and record.levelno == logging.INFO
        ]
        assert any(
            f"backend={resolved_backend}" in message
            and f"hw_decode={resolved_backend == 'vaapi'}" in message
            for message in info_messages
        )
        warnings = [
            record.getMessage()
            for record in caplog.records
            if record.name == ffmpeg_transcoder.__name__ and record.levelno == logging.WARNING
        ]
        assert len(warnings) == len(failed_modes)
        for warning, (mode, stderr) in zip(warnings, failed_modes, strict=True):
            stderr_text = stderr.decode("utf-8") if isinstance(stderr, bytes) else stderr
            assert mode in warning
            assert stderr_text in warning


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

            async def transcode(
                self,
                job: TranscodeJob,
                progress_callback=None,
            ) -> TranscodeResult:
                captured["job"] = job
                captured["progress_callback"] = progress_callback
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
        assert callable(captured["progress_callback"])
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

    def test_build_hls_command_vaapi_hw_decode_uses_gpu_decode_and_scale(
        self,
        tmp_path: Path,
    ) -> None:
        cmd = build_hls_command(
            "https://example.test/input.mp4",
            QUALITIES,
            QUALITY_MAP,
            tmp_path,
            "vaapi",
            hw_decode=True,
        )
        filter_complex = _filter_complex(cmd)

        input_index = cmd.index("-i")
        assert cmd[input_index - 4 : input_index] == [
            "-hwaccel",
            "vaapi",
            "-hwaccel_output_format",
            "vaapi",
        ]
        assert "scale_vaapi=" in filter_complex
        assert "scale_vaapi=w=1920:h=1080" in filter_complex
        assert "force_divisible_by=2" in filter_complex
        assert ":format=nv12" in filter_complex
        assert "hwupload" not in filter_complex
        assert "pad=" not in filter_complex

    def test_build_hls_command_vaapi_hw_decode_false_matches_legacy_argv(self) -> None:
        cmd = build_hls_command(
            "https://example.test/input.mp4",
            QUALITIES,
            QUALITY_MAP,
            "/tmp/hls",
            "vaapi",
            hw_decode=False,
        )

        assert hashlib.sha256("\0".join(cmd).encode()).hexdigest() == (
            "19a71a171d80477df52217bd97fbabd92eeddaba5081d23439970688fa84648e"
        )

    @pytest.mark.parametrize("backend", ["software", "nvenc", "qsv"])
    def test_build_hls_command_hw_decode_is_ignored_for_non_vaapi_backends(
        self,
        backend: str,
        tmp_path: Path,
    ) -> None:
        assert build_hls_command(
            "https://example.test/input.mp4",
            QUALITIES,
            QUALITY_MAP,
            tmp_path,
            backend,
            hw_decode=True,
        ) == _build(backend, tmp_path)

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


class TestParseProgressPercent:
    def test_out_time_us_computes_percent_of_duration(self) -> None:
        assert _parse_progress_percent("out_time_us=5000000", 10) == 50.0

    def test_out_time_ms_field_is_also_microseconds(self) -> None:
        # ffmpeg's out_time_ms is, confusingly, also microseconds.
        assert _parse_progress_percent("out_time_ms=5000000", 10) == 50.0

    def test_malformed_line_returns_none(self) -> None:
        assert _parse_progress_percent("not a progress line", 10) is None
        assert _parse_progress_percent("out_time_us=not-a-number", 10) is None

    def test_zero_duration_returns_none(self) -> None:
        assert _parse_progress_percent("out_time_us=5000000", 0) is None

    def test_percent_is_capped_at_99(self) -> None:
        assert _parse_progress_percent("out_time_us=20000000", 10) == 99.0

    def test_unrelated_progress_key_returns_none(self) -> None:
        assert _parse_progress_percent("frame=120", 10) is None


class TestStderrTail:
    @pytest.mark.parametrize("as_bytes", [False, True])
    def test_stderr_tail_limits_output_and_redacts_presigned_url(self, as_bytes: bool) -> None:
        sensitive_url = "https://example.test/input.mp4?X-Amz-Signature=secret"
        stderr_text = f"{'x' * 2100} {sensitive_url} final diagnostic"
        stderr = stderr_text.encode("utf-8") if as_bytes else stderr_text

        tail = _stderr_tail(stderr, sensitive_url)

        assert len(tail) == 2000
        assert "secret" not in tail
        assert "<redacted input URL>" in tail
        assert tail.endswith("final diagnostic")
