# Plan 008 Code-Quality Review

codeQualityStatus: CLEAR
recommendation: APPROVE
reportPath: .omo/evidence/code-review-plan008-code-review.md
blockers: []

## Scope Reviewed

- `packages/transcoder/hwaccel.py`
- `packages/transcoder/ffmpeg_transcoder.py`
- `apps/api/config.py`
- `apps/api/tasks/transcode_tasks.py`
- `apps/api/.env.example`
- `apps/api/tests/test_transcoder_hwaccel.py`
- `plans/README.md` row 008
- Evidence:
  - `.omo/ulw-loop/evidence/plan008-final-diff-and-files.txt`
  - `.omo/ulw-loop/evidence/008-c001-focused-red-green.txt`
  - `.omo/ulw-loop/evidence/008-c002-full-regression-gates.txt`
  - `.omo/ulw-loop/evidence/008-c003-cli-done-criteria.txt`

Notepad path was not provided in the review prompt. The discovered ULW state for this task is `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/brief.md`, `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/goals.json`, and `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/ledger.jsonl`.

## Skill Perspective Check

Ran. I loaded and applied `omo:remove-ai-slops` and `omo:programming`, including the Python reference, before judging tests and maintainability. I also consulted the injected RTK, caveman, and karpathy-guidelines instructions.

Result: no blocking violations of either perspective. The diff does not add deletion-only tests, removal-only tests, brittle prompt tests, needless production parsing/normalization, untyped public escape hatches, or speculative abstractions. `FFmpegTranscoder.__init__` now has more than three parameters, but that shape is explicitly required by Plan 008 to keep existing positional construction working while threading the two settings; I do not count that as needless abstraction or parameter smuggling.

## Verification Performed

- `PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -p no:cacheprovider` passed: 14 tests.
- `PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests -q -p no:cacheprovider` passed: 87 tests, 1 pre-existing Pydantic MagicMock warning in `apps/api/tests/test_projects.py::test_get_project`.
- `rtk uvx ruff check packages/transcoder/hwaccel.py packages/transcoder/ffmpeg_transcoder.py apps/api/config.py apps/api/tasks/transcode_tasks.py apps/api/tests/test_transcoder_hwaccel.py` passed.
- `DATABASE_URL=sqlite:///tmp.db REDIS_URL=redis://localhost:6379 JWT_SECRET=test PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend; from apps.api.config import settings; print(settings.transcode_hwaccel, settings.transcode_vaapi_device)"` printed `auto /dev/dri/renderD128`.
- `PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m py_compile packages/transcoder/hwaccel.py packages/transcoder/ffmpeg_transcoder.py apps/api/config.py apps/api/tasks/transcode_tasks.py apps/api/tests/test_transcoder_hwaccel.py` passed.
- `rtk git diff --check -- ...` passed for the scoped files.
- `rtk rg -n "apps\.api|from apps|import apps" packages/transcoder` returned no matches.
- `rtk rg -n "libx264" packages/transcoder/ffmpeg_transcoder.py` returned no matches.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Review Notes

- Software command behavior is preserved in the extracted helper: `packages/transcoder/hwaccel.py:89` builds the command, `packages/transcoder/hwaccel.py:117` keeps the original HLS muxing tail, and `apps/api/tests/test_transcoder_hwaccel.py:202` asserts the software filter, `libx264` args, and HLS tail.
- `libx264` is isolated to the helper's software encoder branch at `packages/transcoder/hwaccel.py:59`; `packages/transcoder/ffmpeg_transcoder.py` no longer contains the encoder name.
- Runtime fallback is implemented at `packages/transcoder/ffmpeg_transcoder.py:114`: hardware `CalledProcessError` clears existing HLS children at `packages/transcoder/ffmpeg_transcoder.py:120` before rebuilding quality directories and retrying software at `packages/transcoder/ffmpeg_transcoder.py:129`.
- Fallback cleanup is covered by `apps/api/tests/test_transcoder_hwaccel.py:64`, which creates a partial numeric HLS output during the hardware failure and asserts it is gone before the software retry proceeds.
- Settings are defined at `apps/api/config.py:46` and threaded into `FFmpegTranscoder` at `apps/api/tasks/transcode_tasks.py:89`.
- Plan 008 row is marked done at `plans/README.md:40`.
- The broader `plans/README.md` diff includes pre-existing/out-of-scope planning and reconcile text. Per the review prompt, I reviewed only row 008 and did not treat unrelated dirty planning state as a Plan 008 blocker.

## Recommendation

APPROVE.
