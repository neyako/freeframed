import json
import logging
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Callable, TypedDict

from .base import BaseTranscoder, TranscodeJob, TranscodeResult, VideoMetadata
from .hwaccel import build_hls_command, resolve_backend

logger = logging.getLogger(__name__)


class WaveformData(TypedDict):
    samples: list[float]
    peak: float
    source: str


def _parse_progress_percent(line: str, duration: float) -> float | None:
    """Parse one line of `ffmpeg -progress pipe:1` output into a 0-99 percent.

    Only the playback-position keys carry a timestamp: `out_time_us=<microseconds>`,
    and `out_time_ms=` which — despite its name — ffmpeg also reports in
    microseconds. Every other progress key, and anything unparsable, returns None.
    Returns None (rather than dividing by zero) when duration is 0/unknown.
    """
    if not duration:
        return None
    key, _, value = line.strip().partition("=")
    if key not in ("out_time_us", "out_time_ms"):
        return None
    try:
        out_time_us = int(value)
    except ValueError:
        return None
    percent = (out_time_us / 1_000_000) / duration * 100
    return max(0.0, min(99.0, percent))


def _stderr_tail(stderr: str | bytes | None, sensitive_url: str) -> str:
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    return (stderr or "").replace(sensitive_url, "<redacted input URL>")[-2000:]


def _reset_hls_dir(hls_dir: Path, qualities: list[str]) -> None:
    for child in hls_dir.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)

    for quality in qualities:
        (hls_dir / quality).mkdir(exist_ok=True)


class FFmpegTranscoder(BaseTranscoder):
    def __init__(
        self,
        s3_client,
        bucket: str,
        s3_endpoint: str = None,
        hwaccel: str = "auto",
        vaapi_device: str = "/dev/dri/renderD128",
    ):
        self.s3 = s3_client
        self.bucket = bucket
        self.s3_endpoint = s3_endpoint
        self.hwaccel = hwaccel
        self.vaapi_device = vaapi_device
    
    def _get_presigned_url(self, s3_key: str, expires_in: int = 7200) -> str:
        """Generate a presigned URL for streaming input to FFmpeg."""
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": s3_key},
            ExpiresIn=expires_in,
        )

    async def get_video_metadata(self, s3_key: str) -> VideoMetadata:
        """Get video metadata using streaming (no full download)."""
        input_url = self._get_presigned_url(s3_key)
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", "-select_streams", "v:0", input_url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        fps_parts = stream.get("r_frame_rate", "30/1").split("/")
        fps = float(fps_parts[0]) / float(fps_parts[1])
        return VideoMetadata(
            duration_seconds=float(stream.get("duration", 0)),
            width=int(stream.get("width", 0)),
            height=int(stream.get("height", 0)),
            fps=fps,
        )

    async def generate_thumbnails(self, s3_key: str, count: int) -> list[str]:
        """Generate thumbnails at 1 per 10 seconds using streaming input."""
        input_url = self._get_presigned_url(s3_key)
        thumb_dir = tempfile.mkdtemp()
        try:
            cmd = [
                "ffmpeg", "-i", input_url,
                "-vf", "fps=0.1",
                "-q:v", "2",
                f"{thumb_dir}/thumb_%04d.jpg",
            ]
            subprocess.run(cmd, capture_output=True, check=True, timeout=600)
            return [str(p) for p in sorted(Path(thumb_dir).glob("thumb_*.jpg"))]
        finally:
            shutil.rmtree(thumb_dir, ignore_errors=True)

    async def generate_waveform(self, s3_key: str) -> WaveformData:
        """Generate waveform data for audio visualization using streaming."""
        # Simplified waveform: just return peak data (full waveform extraction is complex)
        return {"samples": [], "peak": 1.0, "source": s3_key}

    async def transcode(
        self,
        job: TranscodeJob,
        progress_callback: Callable[[float], None] | None = None,
    ) -> TranscodeResult:
        """
        Transcode video using streaming input from S3.
        FFmpeg reads directly from presigned URL - no full download needed.
        Only output files are written to disk, reducing disk usage by ~2/3.
        """
        work_dir = Path(tempfile.mkdtemp(prefix=f"transcode_{job.version_id}_"))

        # Generate presigned URL for streaming input (2 hour expiry for large files)
        input_url = self._get_presigned_url(job.input_s3_key, expires_in=7200)

        try:
            # 1. Get metadata via streaming (no download); also sizes progress %.
            cmd = [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", "-show_streams", "-select_streams", "v:0", input_url,
            ]
            probe = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            duration = 0.0
            try:
                probe_data = json.loads(probe.stdout)
                duration = float(probe_data.get("streams", [{}])[0].get("duration", 0) or 0)
                if not duration:
                    duration = float(probe_data.get("format", {}).get("duration", 0) or 0)
            except (ValueError, TypeError, IndexError, json.JSONDecodeError):
                duration = 0.0

            # 3. Build quality ladder based on available qualities
            QUALITY_MAP = {
                "1080p": ("1920:1080", 20),
                "720p": ("1280:720", 22),
                "360p": ("640:360", 26),
            }
            qualities = [q for q in job.qualities if q in QUALITY_MAP]

            hls_dir = work_dir / "hls"
            hls_dir.mkdir()

            backend = resolve_backend(self.hwaccel, self.vaapi_device)

            for q in qualities:
                (hls_dir / q).mkdir(exist_ok=True)

            initial_hw_decode = backend == "vaapi"
            logger.info(
                "Starting HLS transcode: backend=%s hw_decode=%s",
                backend,
                initial_hw_decode,
            )
            if backend == "vaapi":
                attempts = [
                    ("vaapi", True, "vaapi-full-hw"),
                    ("vaapi", False, "vaapi-hwupload"),
                    ("software", False, "software"),
                ]
            elif backend == "software":
                attempts = [("software", False, "software")]
            else:
                attempts = [
                    (backend, False, backend),
                    ("software", False, "software"),
                ]

            # Timeout scales with expected duration - 4 hours for very large files
            for attempt_index, (attempt_backend, hw_decode, mode_name) in enumerate(attempts):
                ffmpeg_cmd = build_hls_command(
                    input_url,
                    qualities,
                    QUALITY_MAP,
                    hls_dir,
                    attempt_backend,
                    self.vaapi_device,
                    hw_decode=hw_decode,
                )
                try:
                    self._run_ffmpeg_with_progress(ffmpeg_cmd, duration, progress_callback)
                except subprocess.CalledProcessError as error:
                    if attempt_index == len(attempts) - 1:
                        raise
                    logger.warning(
                        "FFmpeg transcode mode failed: mode=%s stderr_tail=%s",
                        mode_name,
                        _stderr_tail(error.stderr, input_url),
                    )
                    _reset_hls_dir(hls_dir, qualities)
                else:
                    break

            # 4. Upload HLS files to S3
            uploaded_keys = []
            for f in hls_dir.rglob("*"):
                if f.is_file():
                    relative = f.relative_to(hls_dir)
                    s3_key = f"{job.output_s3_prefix}/{relative}"
                    content_type, cache_control = self._get_content_type(f.name)
                    self.s3.upload_file(
                        str(f), self.bucket, s3_key,
                        ExtraArgs={"ContentType": content_type, "CacheControl": cache_control},
                    )
                    uploaded_keys.append(s3_key)

            # 5. Generate and upload thumbnail (using streaming URL)
            thumb_path = work_dir / "thumb_0001.jpg"
            thumb_cmd = [
                "ffmpeg", "-y", "-i", input_url,
                "-vf", "fps=0.1", "-q:v", "2", "-frames:v", "1",
                str(work_dir / "thumb_%04d.jpg"),
            ]
            subprocess.run(thumb_cmd, check=True, capture_output=True)
            thumbnail_key = f"{job.output_s3_prefix}/thumbnail.jpg"
            if thumb_path.exists():
                self.s3.upload_file(
                    str(thumb_path), self.bucket, thumbnail_key,
                    ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "max-age=86400"},
                )

            return TranscodeResult(
                success=True,
                hls_prefix=job.output_s3_prefix,
                thumbnail_keys=[thumbnail_key],
            )

        except Exception as e:  # noqa  # noqa: BROAD_EXCEPT_OK - boundary converts failure to result.
            return TranscodeResult(success=False, error=str(e))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def _run_ffmpeg_with_progress(
        self,
        ffmpeg_cmd: list[str],
        duration: float,
        progress_callback: Callable[[float], None] | None,
    ) -> None:
        """Run ffmpeg_cmd to completion, reporting integer-percent progress.

        Falls back to a plain `subprocess.run` — identical to the pre-progress
        behavior, including check=True raising CalledProcessError on failure —
        when there's no callback or the source duration is unknown, since
        percent-complete is meaningless without a duration to divide by.
        """
        if not progress_callback or not duration:
            subprocess.run(ffmpeg_cmd, check=True, capture_output=True, timeout=14400)
            return

        cmd = [ffmpeg_cmd[0], "-progress", "pipe:1", "-nostats", *ffmpeg_cmd[1:]]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Drain stderr on a thread: ffmpeg can fill the pipe buffer with warnings
        # mid-encode, and reading only stdout here would then deadlock against it.
        stderr_chunks: list[str] = []
        stderr_reader = threading.Thread(target=lambda: stderr_chunks.append(proc.stderr.read()))
        stderr_reader.start()

        last_percent = -1
        stdout_chunks: list[str] = []
        try:
            for line in proc.stdout:
                stdout_chunks.append(line)
                percent = _parse_progress_percent(line, duration)
                if percent is None:
                    continue
                int_percent = int(percent)
                if int_percent > last_percent:
                    last_percent = int_percent
                    try:
                        progress_callback(percent)
                    except Exception:  # noqa  # noqa: BROAD_EXCEPT_OK - callback errors must not break transcode.
                        pass
            proc.wait(timeout=14400)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise
        finally:
            stderr_reader.join(timeout=14400)

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(
                proc.returncode, cmd, output="".join(stdout_chunks), stderr="".join(stderr_chunks)
            )

    @staticmethod
    def _get_content_type(filename: str) -> tuple[str, str]:
        ext = Path(filename).suffix.lower()
        MAP = {
            ".m3u8": ("application/vnd.apple.mpegurl", "no-cache"),
            ".ts": ("video/mp2t", "max-age=31536000"),
            ".jpg": ("image/jpeg", "max-age=86400"),
        }
        return MAP.get(ext, ("application/octet-stream", "no-cache"))
