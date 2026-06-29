# Plan 008: Hardware-accelerated video transcode (NVENC / QSV / VAAPI with software fallback)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- packages/transcoder/ffmpeg_transcoder.py apps/api/tasks/transcode_tasks.py apps/api/config.py`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: L
- **Risk**: MED (touches the core transcode command; mitigated by a software fallback + unit tests)
- **Depends on**: none (the all-in-one image, Plan 009, ships the ffmpeg that makes the HW paths
  actually fire; this plan is the encoder-selection *code* and works with any ffmpeg, falling back
  to software when HW encoders are absent)
- **Category**: perf / feature
- **Planned at**: commit `c6eb4db`, 2026-06-29

## Why this matters

All video review uploads are transcoded to an HLS ladder (1080p/720p/360p) by FFmpeg in a Celery
worker. Today the encoder is **hard-coded to `libx264`** (CPU). On a box with a GPU, software H.264
is 5–20× slower and pins every core, so a few concurrent uploads starve the worker and reviewers
wait minutes for a cut to become playable. This plan makes the transcoder pick a **hardware H.264
encoder** when one is available — `h264_nvenc` (NVIDIA), `h264_qsv` (Intel), or `h264_vaapi`
(Intel/AMD) — and fall back to `libx264` automatically when no GPU is present or a HW encode fails
at runtime. The selection is a config knob (`TRANSCODE_HWACCEL=auto|nvenc|qsv|vaapi|software`) with
`auto` detecting the best available. Net effect: GPU boxes transcode in a fraction of the time and
free their CPUs, while CPU-only deployments behave exactly as before.

## Current state

### `packages/transcoder/ffmpeg_transcoder.py` — the encoder is hard-coded

The `transcode()` method builds one FFmpeg command. The relevant excerpt (lines ~88–140):

```python
            QUALITY_MAP = {
                "1080p": ("1920:1080", 20),
                "720p": ("1280:720", 22),
                "360p": ("640:360", 26),
            }
            qualities = [q for q in job.qualities if q in QUALITY_MAP]

            hls_dir = work_dir / "hls"
            hls_dir.mkdir()

            split_outputs = "".join(f"[v{i}]" for i in range(len(qualities)))
            filter_complex = f"[v:0]split={len(qualities)}{split_outputs};"
            filter_complex += ";".join(
                f"[v{i}]scale={QUALITY_MAP[q][0]}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2[{q}]"
                for i, q in enumerate(qualities)
            )

            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", input_url,
                "-filter_complex", filter_complex,
            ]

            for i, quality in enumerate(qualities):
                scale, crf = QUALITY_MAP[quality]
                ffmpeg_cmd += [
                    "-map", f"[{quality}]", "-map", "a:0",
                    f"-c:v:{i}", "libx264", f"-crf", str(crf), "-preset", "fast",
                    "-force_key_frames", "expr:gte(t,n_forced*2)",
                ]

            segment_dir = hls_dir / "%v"
            ffmpeg_cmd += [
                "-f", "hls",
                "-hls_time", "2",
                "-hls_playlist_type", "vod",
                "-hls_flags", "independent_segments",
                "-hls_segment_type", "mpegts",
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", " ".join(f"v:{i},a:{i}" for i in range(len(qualities))),
                "-hls_segment_filename", str(hls_dir / "%v" / "seg_%03d.ts"),
                str(hls_dir / "%v" / "playlist.m3u8"),
            ]

            for q in qualities:
                (hls_dir / q).mkdir(exist_ok=True)

            subprocess.run(ffmpeg_cmd, check=True, capture_output=True, timeout=14400)
```

`FFmpegTranscoder.__init__(self, s3_client, bucket, s3_endpoint=None)` — no encoder/accel params yet.

### `apps/api/tasks/transcode_tasks.py` — constructs the transcoder

```python
def _process_video(db, asset, version, media_file, s3, output_prefix):
    from packages.transcoder.ffmpeg_transcoder import FFmpegTranscoder
    from packages.transcoder.base import TranscodeJob

    transcoder = FFmpegTranscoder(s3, settings.s3_bucket, settings.s3_endpoint)
    job = TranscodeJob(
        media_id=str(asset.id), version_id=str(version.id),
        input_s3_key=media_file.s3_key_raw, output_s3_prefix=output_prefix,
        qualities=["1080p", "720p", "360p"],
    )
    result = _run_async(transcoder.transcode(job))
    ...
```

### `apps/api/config.py` — settings style (add a knob here)

`Settings(BaseSettings)` with `model_config = SettingsConfigDict(env_file=..., extra="ignore")`.
Existing transcode-adjacent settings (lines ~45–48):

```python
    transcoder_engine: str = "ffmpeg"

    # Worker concurrency settings
    transcoding_concurrency: int = 2  # Number of concurrent video transcoding jobs
```

Field names map to UPPER_SNAKE env vars (`transcoding_concurrency` ← `TRANSCODING_CONCURRENCY`).

### Conventions

- `packages/transcoder/` is a **standalone package** — it must NOT import from `apps.api.*`. The
  HW-accel *setting* is read in `apps/api/tasks/transcode_tasks.py` (which may import `settings`) and
  **passed into** the transcoder constructor. Keep `packages/transcoder` free of `apps.api` imports.
- Tests live in `apps/api/tests/test_*.py` and run via `python -m pytest apps/api/tests` (see
  `pytest.ini`, `testpaths = apps/api/tests`). A test there may `from packages.transcoder... import`.
- No new third-party dependency — stdlib `subprocess`/`os`/`shutil` only.

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| New unit tests | `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q` | all pass |
| Full API suite (no regressions) | `python -m pytest apps/api/tests -q` | all pass |
| Import sanity | `python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command"` | exit 0 |
| Settings field exists | `python -c "from apps.api.config import settings; print(settings.transcode_hwaccel)"` | prints a value |

If `pytest` can't collect because deps aren't installed, install with
`pip install -r apps/api/requirements.txt` first. If you cannot run pytest at all, STOP — do not
ship an untested change to the core transcode path.

## Scope

**In scope**:
- `packages/transcoder/hwaccel.py` (create) — pure encoder-selection + command-builder helpers.
- `packages/transcoder/ffmpeg_transcoder.py` — use the helpers; add `hwaccel`/`vaapi_device`
  constructor params; software fallback on HW failure.
- `apps/api/tasks/transcode_tasks.py` — pass `settings.transcode_hwaccel` / `settings.transcode_vaapi_device` into the transcoder.
- `apps/api/config.py` — add `transcode_hwaccel` + `transcode_vaapi_device` settings.
- `apps/api/tests/test_transcoder_hwaccel.py` (create) — unit tests.
- `apps/api/.env.example` — document `TRANSCODE_HWACCEL` (and `TRANSCODE_VAAPI_DEVICE`).

**Out of scope** (do NOT touch):
- `_process_audio` / `_process_image` / `image_processor.py` — only the video H.264 path changes.
- The HLS muxing flags, quality ladder values, S3 upload, thumbnail generation — preserve them
  exactly; this plan changes the **video encoder selection only**, not the output format.
- The Dockerfiles / ffmpeg build — that is Plan 009. This plan's code must run with whatever ffmpeg
  is installed (falling back to software when HW encoders are missing).

## Git workflow

- Branch: `advisor/008-hardware-accelerated-transcode`
- Conventional commits (e.g. `feat(transcoder): select hardware H.264 encoder when available`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create `packages/transcoder/hwaccel.py`

Pure helpers — no FFmpeg execution except the optional `probe_encoders()`. Reproduce faithfully:

```python
"""Hardware-accelerated H.264 encoder selection for the FFmpeg transcoder.

Pure, dependency-free helpers so the command construction is unit-testable
without a GPU. `packages.transcoder` must not import from apps.api.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from typing import Dict, List, Tuple

BACKENDS = ("nvenc", "qsv", "vaapi", "software")


def select_backend(setting: str, encoders_text: str, has_dri: bool, has_nvidia: bool) -> str:
    """Resolve a concrete backend. `setting` in {auto, nvenc, qsv, vaapi, software}.
    For 'auto', prefer NVENC, then QSV, then VAAPI, then software."""
    setting = (setting or "auto").lower()
    if setting in ("nvenc", "qsv", "vaapi", "software"):
        return setting
    if has_nvidia and "h264_nvenc" in encoders_text:
        return "nvenc"
    if has_dri and "h264_qsv" in encoders_text:
        return "qsv"
    if has_dri and "h264_vaapi" in encoders_text:
        return "vaapi"
    return "software"


def probe_encoders() -> str:
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=30)
        return out.stdout or ""
    except Exception:
        return ""


def resolve_backend(setting: str, vaapi_device: str = "/dev/dri/renderD128") -> str:
    has_dri = os.path.isdir("/dev/dri")
    has_nvidia = os.path.exists("/dev/nvidiactl") or shutil.which("nvidia-smi") is not None
    return select_backend(setting, probe_encoders(), has_dri, has_nvidia)


def _global_args(backend: str, device: str) -> List[str]:
    """Args placed right after `ffmpeg -y` to initialise the hw device."""
    if backend == "vaapi":
        return ["-vaapi_device", device]
    if backend == "qsv":
        return ["-init_hw_device", "qsv=hw:%s" % device, "-filter_hw_device", "hw"]
    return []  # software / nvenc need nothing pre-input for encode-only


def _filter_suffix(backend: str) -> str:
    """Extra filter appended to each scaled branch so frames land in the
    encoder's expected format/memory."""
    if backend == "vaapi":
        return ",format=nv12,hwupload"
    if backend == "qsv":
        return ",hwupload=extra_hw_frames=64,format=qsv"
    return ""  # software / nvenc accept system-memory frames


def _encoder_args(backend: str, index: int, q: int) -> List[str]:
    """Video encoder + rate-control for output stream `index`, quality target `q`."""
    if backend == "software":
        return ["-c:v:%d" % index, "libx264", "-crf", str(q), "-preset", "fast"]
    if backend == "nvenc":
        return ["-c:v:%d" % index, "h264_nvenc", "-rc", "vbr", "-cq", str(q),
                "-b:v", "0", "-preset", "p5"]
    if backend == "vaapi":
        return ["-c:v:%d" % index, "h264_vaapi", "-rc_mode", "CQP", "-qp", str(q)]
    if backend == "qsv":
        return ["-c:v:%d" % index, "h264_qsv", "-global_quality", str(q), "-preset", "medium"]
    raise ValueError("Unknown backend: %s" % backend)


def build_hls_command(input_url: str, qualities: List[str],
                      quality_map: Dict[str, Tuple[str, int]], hls_dir,
                      backend: str, device: str = "/dev/dri/renderD128") -> List[str]:
    """Build the full FFmpeg arg list for the HLS ladder using `backend`'s encoder.

    Mirrors the original software command exactly except for the per-branch
    filter suffix, the hw-device init args, and the per-output encoder flags.
    """
    hls_dir = str(hls_dir)
    split_outputs = "".join("[v%d]" % i for i in range(len(qualities)))
    suffix = _filter_suffix(backend)
    filter_complex = "[v:0]split=%d%s;" % (len(qualities), split_outputs)
    filter_complex += ";".join(
        "[v%d]scale=%s:force_original_aspect_ratio=decrease,"
        "pad=ceil(iw/2)*2:ceil(ih/2)*2%s[%s]" % (i, quality_map[q][0], suffix, q)
        for i, q in enumerate(qualities)
    )

    cmd: List[str] = ["ffmpeg", "-y"]
    cmd += _global_args(backend, device)
    cmd += ["-i", input_url, "-filter_complex", filter_complex]

    for i, quality in enumerate(qualities):
        _scale, q = quality_map[quality]
        cmd += ["-map", "[%s]" % quality, "-map", "a:0"]
        cmd += _encoder_args(backend, i, q)
        cmd += ["-force_key_frames", "expr:gte(t,n_forced*2)"]

    cmd += [
        "-f", "hls",
        "-hls_time", "2",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_type", "mpegts",
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", " ".join("v:%d,a:%d" % (i, i) for i in range(len(qualities))),
        "-hls_segment_filename", os.path.join(hls_dir, "%v", "seg_%03d.ts"),
        os.path.join(hls_dir, "%v", "playlist.m3u8"),
    ]
    return cmd
```

**Verify**: `python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend"` → exit 0.

### Step 2: Add the config settings in `apps/api/config.py`

After `transcoder_engine: str = "ffmpeg"` add:

```python
    # Hardware-accelerated transcode. "auto" picks the best available encoder
    # (nvenc > qsv > vaapi > software); force a specific one or "software" to disable HW.
    transcode_hwaccel: str = "auto"  # auto | nvenc | qsv | vaapi | software
    transcode_vaapi_device: str = "/dev/dri/renderD128"
```

**Verify**: `python -c "from apps.api.config import settings; print(settings.transcode_hwaccel, settings.transcode_vaapi_device)"` → prints `auto /dev/dri/renderD128`.

### Step 3: Use the helpers in `ffmpeg_transcoder.py`

1. Add constructor params (keep existing positional args working):

   ```python
   def __init__(self, s3_client, bucket: str, s3_endpoint: str = None,
                hwaccel: str = "auto", vaapi_device: str = "/dev/dri/renderD128"):
       self.s3 = s3_client
       self.bucket = bucket
       self.s3_endpoint = s3_endpoint
       self.hwaccel = hwaccel
       self.vaapi_device = vaapi_device
   ```

2. Add the import near the top: `from .hwaccel import resolve_backend, build_hls_command`.

3. Replace the inline command construction (the `split_outputs = …` block through the
   `subprocess.run(ffmpeg_cmd, …, timeout=14400)` call) with:

   ```python
            backend = resolve_backend(self.hwaccel, self.vaapi_device)

            for q in qualities:
                (hls_dir / q).mkdir(exist_ok=True)

            ffmpeg_cmd = build_hls_command(
                input_url, qualities, QUALITY_MAP, hls_dir, backend, self.vaapi_device
            )
            try:
                subprocess.run(ffmpeg_cmd, check=True, capture_output=True, timeout=14400)
            except subprocess.CalledProcessError:
                if backend == "software":
                    raise
                # HW encode failed at runtime (driver/device mismatch) — fall back once.
                for q in qualities:
                    shutil.rmtree(hls_dir / q, ignore_errors=True)
                    (hls_dir / q).mkdir(exist_ok=True)
                ffmpeg_cmd = build_hls_command(
                    input_url, qualities, QUALITY_MAP, hls_dir, "software", self.vaapi_device
                )
                subprocess.run(ffmpeg_cmd, check=True, capture_output=True, timeout=14400)
   ```

   Keep everything after that (HLS upload to S3, thumbnail generation, `TranscodeResult`) unchanged.
   `QUALITY_MAP` stays defined where it is. `shutil` is already imported at the top of the file.

**Verify**: `python -c "import packages.transcoder.ffmpeg_transcoder"` → exit 0.

### Step 4: Thread the setting through `transcode_tasks.py`

In `_process_video`, pass the settings into the constructor:

```python
    transcoder = FFmpegTranscoder(
        s3, settings.s3_bucket, settings.s3_endpoint,
        hwaccel=settings.transcode_hwaccel,
        vaapi_device=settings.transcode_vaapi_device,
    )
```

**Verify**: `grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py` → one match.

### Step 5: Document the env var in `apps/api/.env.example`

Add:

```
# Hardware-accelerated transcode. "auto" detects nvenc/qsv/vaapi, else software.
# Force one of: nvenc | qsv | vaapi | software. Requires GPU device passthrough at runtime.
TRANSCODE_HWACCEL=auto
TRANSCODE_VAAPI_DEVICE=/dev/dri/renderD128
```

**Verify**: `grep -n "TRANSCODE_HWACCEL" apps/api/.env.example` → one match.

### Step 6: Unit tests — `apps/api/tests/test_transcoder_hwaccel.py`

No GPU and no ffmpeg execution. Test the pure builders. Cover:

1. **select_backend (auto)**: nvidia present + `h264_nvenc` in encoders → `"nvenc"`; no nvidia, dri
   present + `h264_qsv` → `"qsv"`; dri present, only `h264_vaapi` → `"vaapi"`; nothing → `"software"`.
2. **select_backend (forced)**: `"vaapi"` returns `"vaapi"` regardless of probe; `"software"` →
   `"software"`.
3. **build_hls_command (software)**: contains `libx264`, `-crf 20` (for 1080p), NO `hwupload`, NO
   `-vaapi_device`, and the HLS flags (`-f hls`, `-master_pl_name master.m3u8`).
4. **build_hls_command (nvenc)**: contains `h264_nvenc` and `-cq`, but NO `hwupload` and NO
   `-vaapi_device`.
5. **build_hls_command (vaapi)**: contains `-vaapi_device`, `h264_vaapi`, and `,format=nv12,hwupload`
   inside the filter_complex string.
6. **build_hls_command (qsv)**: contains `-init_hw_device`, `h264_qsv`, and
   `hwupload=extra_hw_frames=64,format=qsv`.
7. **structure invariant**: for every backend, the command starts with `ffmpeg` and ends with a
   `playlist.m3u8` path, and has exactly `len(qualities)` `-map a:0` audio maps.

Use the same `QUALITY_MAP` shape: `{"1080p": ("1920:1080", 20), "720p": ("1280:720", 22), "360p": ("640:360", 26)}`.

**Verify**: `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q` → all pass (≥7 tests).

### Step 7: Full suite

**Verify**: `python -m pytest apps/api/tests -q` → all pass (existing tests + new; no regressions).

## Test plan

- **Automated (gate)**: `test_transcoder_hwaccel.py` covers backend selection and per-backend command
  construction without a GPU or ffmpeg execution — the entire decision surface. The existing suite
  guards against regressions in the rest of the pipeline.
- **Manual (needs real hardware; record results, don't block without GPU)**:
  - On an NVIDIA box: `TRANSCODE_HWACCEL=auto` + `--gpus all`, upload a video, confirm the worker
    log shows it didn't fall back and that `nvidia-smi` shows an encode session during transcode.
  - On a CPU-only box: confirm `auto` resolves to `software` and transcode still succeeds (identical
    output to before this plan).
  - Force `TRANSCODE_HWACCEL=vaapi` on a box without `/dev/dri` → the HW run fails and the software
    fallback produces a valid HLS ladder (no failed asset).

## Done criteria

ALL must hold:

- [ ] `python -m pytest apps/api/tests -q` exits 0; `test_transcoder_hwaccel.py` exists with ≥7 passing tests
- [ ] `python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend"` exits 0
- [ ] `python -c "from apps.api.config import settings; print(settings.transcode_hwaccel)"` prints a value
- [ ] `grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py` → match
- [ ] `grep -n "TRANSCODE_HWACCEL" apps/api/.env.example` → match
- [ ] `grep -n "libx264" packages/transcoder/ffmpeg_transcoder.py` → **no match** (the encoder name now lives only in `hwaccel.py`)
- [ ] `packages/transcoder/` contains no `import apps.api` (`grep -rn "apps.api" packages/transcoder` → no match)
- [ ] Only in-scope files modified (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `packages/transcoder/ffmpeg_transcoder.py`'s `transcode()` no longer matches the "Current state"
  excerpt (the command construction was refactored since `c6eb4db`).
- Extracting `build_hls_command` would change the HLS output flags, var_stream_map, or quality ladder
  — those must stay byte-identical for the software path; if you can't preserve them, STOP.
- A verification fails twice after a reasonable fix.
- You find yourself needing to import `apps.api.*` inside `packages/transcoder/` — that violates the
  package boundary; thread the value through the constructor instead.

## Maintenance notes

- **The VAAPI and QSV command strings are best-effort** and should be validated on real Intel/AMD
  hardware. The runtime **software fallback** (Step 3) is the safety net: if a HW command is slightly
  wrong for a given driver, the asset still transcodes via libx264 rather than failing. When tuning,
  change only `_encoder_args` / `_filter_suffix` / `_global_args` in `hwaccel.py` — they are isolated
  and unit-tested.
- **NVENC and software are the high-confidence paths** (NVENC accepts system-memory frames, so it
  reuses the exact CPU scaling pipeline). Prefer NVENC for NVIDIA boxes.
- Quality targets reuse the libx264 CRF numbers as `-cq`/`-qp`/`-global_quality`. These are roughly
  comparable but not identical perceptually; retune per backend if reviewers report quality drift.
- This plan is the *code*. Plan 009 (all-in-one image) ships **jellyfin-ffmpeg**, which provides
  `h264_nvenc`/`h264_qsv`/`h264_vaapi` in one binary, and documents the `--gpus all` / `--device
  /dev/dri` passthrough that makes `auto` resolve to a HW backend.
- Reviewer should scrutinise: the software output is unchanged (diff the generated command for the
  `software` backend against the old inline command), and the fallback wipes partial HLS dirs before
  re-running so no half-written segments leak into the upload.
