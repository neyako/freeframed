from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

BACKENDS: tuple[str, ...] = ("nvenc", "qsv", "vaapi", "software")


@dataclass(frozen=True, slots=True)
class UnknownBackendError(Exception):
    backend: str

    def __str__(self) -> str:
        return f"Unknown backend: {self.backend}"


def select_backend(setting: str, encoders_text: str, has_dri: bool, has_nvidia: bool) -> str:
    selected = (setting or "auto").strip().lower()
    if selected in BACKENDS:
        return selected
    if has_nvidia and "h264_nvenc" in encoders_text:
        return "nvenc"
    if has_dri and "h264_qsv" in encoders_text:
        return "qsv"
    if has_dri and "h264_vaapi" in encoders_text:
        return "vaapi"
    return "software"


def probe_encoders() -> str:
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout or ""


def resolve_backend(setting: str, vaapi_device: str = "/dev/dri/renderD128") -> str:
    device_dir = os.path.dirname(vaapi_device) or "/dev/dri"
    has_dri = os.path.isdir(device_dir)
    has_nvidia = os.path.exists("/dev/nvidiactl") or shutil.which("nvidia-smi") is not None
    return select_backend(setting, probe_encoders(), has_dri, has_nvidia)


def _global_args(backend: str, device: str) -> list[str]:
    if backend == "vaapi":
        return ["-vaapi_device", device]
    if backend == "qsv":
        return ["-init_hw_device", f"qsv=hw:{device}", "-filter_hw_device", "hw"]
    return []


def _filter_suffix(backend: str) -> str:
    if backend == "vaapi":
        return ",format=nv12,hwupload"
    if backend == "qsv":
        return ",hwupload=extra_hw_frames=64,format=qsv"
    return ""


def _encoder_args(backend: str, index: int, quality: int) -> list[str]:
    if backend == "software":
        return [f"-c:v:{index}", "libx264", "-crf", str(quality), "-preset", "fast"]
    if backend == "nvenc":
        return [
            f"-c:v:{index}",
            "h264_nvenc",
            "-rc",
            "vbr",
            "-cq",
            str(quality),
            "-b:v",
            "0",
            "-preset",
            "p5",
        ]
    if backend == "vaapi":
        return [f"-c:v:{index}", "h264_vaapi", "-rc_mode", "CQP", "-qp", str(quality)]
    if backend == "qsv":
        return [
            f"-c:v:{index}",
            "h264_qsv",
            "-global_quality",
            str(quality),
            "-preset",
            "medium",
        ]
    raise UnknownBackendError(backend)


def build_hls_command(
    input_url: str,
    qualities: list[str],
    quality_map: dict[str, tuple[str, int]],
    hls_dir: str | os.PathLike[str],
    backend: str,
    device: str = "/dev/dri/renderD128",
) -> list[str]:
    hls_path = os.fspath(hls_dir)
    split_outputs = "".join(f"[v{index}]" for index in range(len(qualities)))
    suffix = _filter_suffix(backend)
    filter_complex = f"[v:0]split={len(qualities)}{split_outputs};"
    filter_complex += ";".join(
        f"[v{index}]scale={quality_map[quality][0]}:force_original_aspect_ratio=decrease,"
        f"pad=ceil(iw/2)*2:ceil(ih/2)*2{suffix}[{quality}]"
        for index, quality in enumerate(qualities)
    )

    cmd = ["ffmpeg", "-y"]
    cmd += _global_args(backend, device)
    cmd += ["-i", input_url, "-filter_complex", filter_complex]

    for index, quality in enumerate(qualities):
        _scale, quality_target = quality_map[quality]
        cmd += ["-map", f"[{quality}]", "-map", "a:0"]
        cmd += _encoder_args(backend, index, quality_target)
        cmd += ["-force_key_frames", "expr:gte(t,n_forced*2)"]

    cmd += [
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
        " ".join(f"v:{index},a:{index}" for index in range(len(qualities))),
        "-hls_segment_filename",
        os.path.join(hls_path, "%v", "seg_%03d.ts"),
        os.path.join(hls_path, "%v", "playlist.m3u8"),
    ]
    return cmd
