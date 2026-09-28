import json
import logging
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional

from .base import TranscodeJob, TranscodeResult, VideoMetadata
from .hwaccel import build_hls_command, resolve_backend

logger = logging.getLogger(__name__)


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


def _reset_hls_dir(hls_dir: Path) -> None:
    # ffmpeg creates the per-rendition %v directories itself.
    for child in hls_dir.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


# Rendition ladder keyed by the frame's SHORT edge, so a vertical 9:16 source
# gets the same resolution as landscape (1080x1920 stays 1080x1920).
LADDER: dict[str, tuple[int, int]] = {"1080p": (1080, 20), "720p": (720, 22), "360p": (360, 26)}
# Used only when ffprobe couldn't read the dimensions.
_FALLBACK_BOXES = {"1080p": "1920:1080", "720p": "1280:720", "360p": "640:360"}


def _even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


def plan_renditions(qualities: list[str], width: int, height: int) -> dict[str, tuple[str, int]]:
    """Map requested rungs to exact "W:H" scales that keep the source aspect.

    Never upscales: a rung above the source's short edge is capped to the
    source size, and duplicate sizes are dropped (a 480p source yields 480 + 360).
    """
    rungs = [q for q in qualities if q in LADDER]
    if not width or not height:
        return {q: (_FALLBACK_BOXES[q], LADDER[q][1]) for q in rungs}
    short, long_ = min(width, height), max(width, height)
    plan: dict[str, tuple[str, int]] = {}
    seen: set[int] = set()
    for quality in rungs:
        target, crf = LADDER[quality]
        out_short = _even(min(target, short))
        if out_short in seen:
            continue
        seen.add(out_short)
        out_long = _even(long_ * out_short / short)
        w, h = (out_long, out_short) if width >= height else (out_short, out_long)
        plan[quality] = (f"{w}:{h}", crf)
    return plan


def _rotation(stream: dict) -> int:
    for side_data in stream.get("side_data_list") or []:
        if "rotation" in side_data:
            try:
                return int(float(side_data["rotation"]))
            except (TypeError, ValueError):
                return 0
    try:
        return int(float((stream.get("tags") or {}).get("rotate") or 0))
    except (TypeError, ValueError):
        return 0


def is_rotated_90(data: dict) -> bool:
    video = next((s for s in data.get("streams") or [] if s.get("codec_type", "video") == "video"), None)
    return video is not None and abs(_rotation(video)) % 180 == 90


def has_audio_stream(data: dict) -> bool:
    return any(s.get("codec_type") == "audio" for s in data.get("streams") or [])


def parse_probe_metadata(data: dict) -> Optional[VideoMetadata]:
    """Parse ffprobe JSON (-show_streams -show_format) into VideoMetadata.

    Returns None when there is no video stream. Guards r_frame_rate "0/0"
    (fps stays 0.0 — never fabricate a rate) and falls back to format-level
    duration when the stream lacks one (common for MKV/WebM). Width/height
    are display dimensions: phone footage stored landscape with a 90° rotation
    flag reports as portrait, matching what ffmpeg's autorotate decodes.
    """
    streams = data.get("streams") or []
    video_streams = [s for s in streams if s.get("codec_type", "video") == "video"]
    if not video_streams:
        return None
    stream = video_streams[0]
    fps = 0.0
    raw_rate = stream.get("r_frame_rate") or ""
    if "/" in raw_rate:
        num, _, den = raw_rate.partition("/")
        try:
            if float(den) != 0:
                fps = float(num) / float(den)
        except ValueError:
            fps = 0.0
    duration = float(stream.get("duration") or 0)
    if not duration:
        duration = float((data.get("format") or {}).get("duration") or 0)
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    if abs(_rotation(stream)) % 180 == 90:
        width, height = height, width
    return VideoMetadata(duration_seconds=duration, width=width, height=height, fps=fps)


class FFmpegTranscoder:
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
                "-show_format", "-show_streams", input_url,
            ]
            probe = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            meta = None
            # Assume audio when the probe fails, matching the old behavior.
            has_audio = True
            rotated = False
            try:
                probe_data = json.loads(probe.stdout)
                meta = parse_probe_metadata(probe_data)
                has_audio = has_audio_stream(probe_data)
                rotated = is_rotated_90(probe_data)
            except (ValueError, TypeError, IndexError, json.JSONDecodeError):
                meta = None
            duration = meta.duration_seconds if meta else 0.0

            # 3. Build the quality ladder from the source's display size
            quality_map = plan_renditions(
                job.qualities,
                meta.width if meta else 0,
                meta.height if meta else 0,
            )
            qualities = list(quality_map)

            hls_dir = work_dir / "hls"
            hls_dir.mkdir()

            backend = resolve_backend(self.hwaccel, self.vaapi_device)

            # ffmpeg doesn't autorotate VAAPI-decoded frames, so 90°-rotated
            # phone footage skips full-GPU decode and starts at hwupload.
            initial_hw_decode = backend == "vaapi" and not rotated
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
                ][0 if initial_hw_decode else 1:]
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
                    quality_map,
                    hls_dir,
                    attempt_backend,
                    self.vaapi_device,
                    hw_decode=hw_decode,
                    has_audio=has_audio,
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
                    _reset_hls_dir(hls_dir)
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

            # 5. Thumbnail: best effort — the HLS output is already uploaded, so
            # a thumbnail failure must not fail the transcode. Seek past frame 0,
            # which is often black.
            thumb_path = work_dir / "thumbnail.jpg"
            thumb_cmd = [
                "ffmpeg", "-y", "-ss", f"{min(1.0, duration / 2):.3f}", "-i", input_url,
                "-q:v", "2", "-frames:v", "1", str(thumb_path),
            ]
            thumbnail_keys: list[str] = []
            try:
                subprocess.run(thumb_cmd, capture_output=True, timeout=300)
            except subprocess.SubprocessError as error:
                logger.warning("Thumbnail generation failed: %s", error)
            if thumb_path.exists():
                thumbnail_key = f"{job.output_s3_prefix}/thumbnail.jpg"
                self.s3.upload_file(
                    str(thumb_path), self.bucket, thumbnail_key,
                    ExtraArgs={"ContentType": "image/jpeg", "CacheControl": "max-age=86400"},
                )
                thumbnail_keys.append(thumbnail_key)

            return TranscodeResult(
                success=True,
                hls_prefix=job.output_s3_prefix,
                thumbnail_keys=thumbnail_keys,
                duration_seconds=(meta.duration_seconds or None) if meta else None,
                width=(meta.width or None) if meta else None,
                height=(meta.height or None) if meta else None,
                fps=(meta.fps or None) if meta else None,
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
