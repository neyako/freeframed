# Plan 008 Hardware-Accelerated Transcode ULW Heavy Execution

## TL;DR
> Summary:      Execute `plans/008-hardware-accelerated-transcode.md` as a HEAVY ULW delivery: prove red-first unit contracts, add pure hardware encoder selection and HLS command building, thread settings through the API worker, preserve software behavior, and finish with focused/full verification plus reviewer approval.
> Deliverables:
> - `packages/transcoder/hwaccel.py` pure helper module for backend selection, encoder probing, and HLS command construction
> - `FFmpegTranscoder` support for `auto|nvenc|qsv|vaapi|software`, VAAPI device config, and one-shot software fallback on hardware encode failure
> - API settings and Celery task wiring for `TRANSCODE_HWACCEL` and `TRANSCODE_VAAPI_DEVICE`
> - `apps/api/tests/test_transcoder_hwaccel.py` with red-first proof and focused green coverage for selection, command builders, fallback, and wiring
> - `apps/api/.env.example` documentation and `plans/README.md` Plan 008 status update
> Effort:       Large
> Risk:         Medium - touches the core FFmpeg transcode command, but the change is isolated behind pure helpers, software fallback, and no-GPU unit tests.

## Scope
### Must have
- Treat `plans/008-hardware-accelerated-transcode.md` as the product contract; its scope is authoritative at `plans/008-hardware-accelerated-transcode.md:151`.
- Preserve the current video-only boundary: the inline software HLS command lives in `packages/transcoder/ffmpeg_transcoder.py:99` through `packages/transcoder/ffmpeg_transcoder.py:140`, while S3 upload and thumbnail generation start at `packages/transcoder/ffmpeg_transcoder.py:142` and must remain behaviorally unchanged.
- Add `packages/transcoder/hwaccel.py` as a standalone package helper with no `apps.api` imports, matching the package-boundary rule at `plans/008-hardware-accelerated-transcode.md:131`.
- Keep `FFmpegTranscoder.__init__` backward compatible: existing positional call sites must still work from `packages/transcoder/ffmpeg_transcoder.py:15` and `apps/api/tasks/transcode_tasks.py:89`.
- Add settings beside `transcoder_engine` in `apps/api/config.py:45` and pass them from `_process_video` in `apps/api/tasks/transcode_tasks.py:85`.
- Preserve HLS muxing flags, quality ladder values, S3 upload, and thumbnail generation per the out-of-scope rules at `plans/008-hardware-accelerated-transcode.md:162`.
- Update `apps/api/.env.example` after the existing transcode setting at `apps/api/.env.example:13`.
- Update only the Plan 008 row in `plans/README.md:40` after all verification passes.
- Capture all ULW evidence under `.omo/ulw-loop/evidence/`.
- Delegate implementation and QA work to right-sized workers during execution; root agent integrates, reruns, audits, and records evidence.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Do not modify `_process_audio`, `_process_image`, `packages/transcoder/image_processor.py`, HLS flags, quality ladder values, upload behavior, thumbnail behavior, Dockerfiles, deploy files, or Plan 009/010 assets.
- Do not import `apps.api.*` from `packages/transcoder/**`.
- Do not require a GPU, FFmpeg hardware encoder, Docker image change, or jellyfin-ffmpeg install for the code/tests in this plan.
- Do not ship an untested change if pytest cannot collect and dependencies cannot be installed with `pip install -r apps/api/requirements.txt`.
- Do not commit red tests.
- Do not rewrite or normalize unrelated pre-existing changes in `plans/README.md`; only update row 008 after verification.
- Do not add third-party dependencies; Plan 008 restricts implementation to stdlib `subprocess`/`os`/`shutil` at `plans/008-hardware-accelerated-transcode.md:136`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD + pytest. Task 2 captures RED before any production implementation; Tasks 6-9 turn the same contract GREEN.
- QA policy: every task has agent-executed scenarios.
- Evidence: `.omo/ulw-loop/evidence/task-<N>-<slug>.<ext>`
- HEAVY tier: required because Plan 008 adds a new helper module, touches the core transcode command, crosses app/task/package configuration boundaries, and changes external FFmpeg integration behavior.
- Worker policy: each implementation task is delegated to a high-rigor implementation worker with `TASK:`, `DELIVERABLE`, `SCOPE`, and `VERIFY`; root reruns evidence and rejects missing RED/GREEN proof.

Success criteria IDs:
- SC-008-RED: Red-first proof exists before production code.
  Scenario: `bash -lc 'mkdir -p .omo/ulw-loop/evidence; python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q 2>&1 | tee .omo/ulw-loop/evidence/SC-008-RED-red-pytest.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0; ! grep -E "SyntaxError|IndentationError" .omo/ulw-loop/evidence/SC-008-RED-red-pytest.txt'`
  Evidence: `.omo/ulw-loop/evidence/SC-008-RED-red-pytest.txt`
- SC-008-HAPPY: `auto` selects NVENC, QSV, VAAPI, then software in priority order and command builders emit the expected encoder args.
  Scenario: `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "select_backend or build_hls_command" | tee .omo/ulw-loop/evidence/SC-008-HAPPY-focused.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-HAPPY-focused.txt`
- SC-008-EDGE: forced `software` and forced hardware settings behave deterministically without host hardware.
  Scenario: `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "forced or software" | tee .omo/ulw-loop/evidence/SC-008-EDGE-forced.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-EDGE-forced.txt`
- SC-008-FALLBACK: a hardware encode `CalledProcessError` reruns once with software after partial HLS quality dirs are reset.
  Scenario: `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "fallback" | tee .omo/ulw-loop/evidence/SC-008-FALLBACK-runtime.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-FALLBACK-runtime.txt`
- SC-008-WIRING: API settings, `.env.example`, and `_process_video` constructor wiring are present.
  Scenario: `bash -lc 'grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py; grep -n "TRANSCODE_HWACCEL" apps/api/.env.example; DATABASE_URL=postgresql://user:pass@localhost:5432/freeframe_test REDIS_URL=redis://localhost:6379/0 JWT_SECRET=test python -c "from apps.api.config import settings; print(settings.transcode_hwaccel, settings.transcode_vaapi_device)"' | tee .omo/ulw-loop/evidence/SC-008-WIRING-settings.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-WIRING-settings.txt`
- SC-008-REGRESSION: software command invariants, import sanity, package boundary, and focused tests all pass.
  Scenario: `bash -lc 'python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q && python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend" && python -c "import packages.transcoder.ffmpeg_transcoder" && ! grep -n "libx264" packages/transcoder/ffmpeg_transcoder.py && ! grep -rn "apps.api" packages/transcoder' | tee .omo/ulw-loop/evidence/SC-008-REGRESSION-safety.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-REGRESSION-safety.txt`
- SC-008-FULL: full API pytest suite passes and Plan 008 row is marked DONE.
  Scenario: `bash -lc 'python -m pytest apps/api/tests -q && grep -n "| 008 |" plans/README.md' | tee .omo/ulw-loop/evidence/SC-008-FULL-suite-readme.txt`
  Evidence: `.omo/ulw-loop/evidence/SC-008-FULL-suite-readme.txt`
- SC-008-REVIEW: final code, QA, gate, and scope reviewers approve unconditionally.
  Scenario: final reviewer loop records reports under `.omo/ulw-loop/evidence/plan008-final-*.md` and a quality gate JSON at `.omo/ulw-loop/evidence/plan008-quality-gate.json`.
  Evidence: `.omo/ulw-loop/evidence/plan008-quality-gate.json`

Adversarial classes:
- stale_state: drift check must remain empty for `packages/transcoder/ffmpeg_transcoder.py`, `apps/api/tasks/transcode_tasks.py`, and `apps/api/config.py`.
- dirty_worktree: current `plans/README.md` has pre-existing edits; scope checks must stage only Plan 008 files and not revert unrelated work.
- malformed_input: tests cover unknown/forced backend settings through deterministic selection behavior.
- hardware_absent: tests must not require `/dev/dri`, `/dev/nvidiactl`, `nvidia-smi`, or real FFmpeg hardware encoders.
- partial_output: fallback test must prove partial HLS directories are reset before software retry.
- package_boundary: grep must prove no `apps.api` import inside `packages/transcoder`.
- misleading_success_output: every acceptance command writes concrete output and checks pass/fail, not just command invocation.
- hung_or_long_commands: `probe_encoders()` must keep the Plan 008 timeout contract and pytest commands must not invoke real transcodes.
- flaky_tests: focused pytest and full suite must both rerun after final code changes.
- repeated_interruptions: ULW ledger must preserve criterion evidence before checkpointing.

Stop conditions:
- Stop if the drift check from `plans/008-hardware-accelerated-transcode.md:10` produces output.
- Stop if `packages/transcoder/ffmpeg_transcoder.py:99` through `packages/transcoder/ffmpeg_transcoder.py:140` no longer matches the current inline command shape before implementation.
- Stop if the software-path HLS flags, var-stream map, segment filename pattern, or quality ladder cannot be preserved.
- Stop if implementation requires importing `apps.api.*` from `packages/transcoder/**`.
- Stop if pytest cannot collect and `pip install -r apps/api/requirements.txt` does not make collection possible.
- Stop after two failed attempts at the same verification/fix loop; report the exact commands and evidence paths.
- Stop if a worker returns without RED proof for behavior-changing code.
- Stop if final reviewers do not give unconditional approval.

## Execution strategy
### Parallel execution waves
> Target 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks to maximize parallelism.

Wave 1 (no dependencies):
- Task 1: Preflight drift, current-state, and dirty-worktree audit
- Task 2: Red-first hardware-transcode unit contract tests
- Task 3: FFmpeg hardware-command reference audit
- Task 4: Package-boundary and libx264 baseline audit
- Task 5: Delegation setup and worker handoff contract

Wave 2 (after Wave 1):
- Task 6: Add `packages/transcoder/hwaccel.py`; depends [1, 2, 3, 4, 5]
- Task 7: Add API settings and env documentation; depends [1, 2, 5]
- Task 8: Wire `_process_video` to pass settings; depends [1, 2, 5]

Wave 3 (after Wave 2):
- Task 9: Update `FFmpegTranscoder` to use helpers and fallback; depends [6]
- Task 10: Focused integration and static safety checks; depends [6, 7, 8, 9]

Wave 4 (after Wave 3):
- Task 11: Full API suite and Plan README status update; depends [10]
- Task 12: ULW ledger evidence, scoped commit, and cleanup receipts; depends [11]

Final wave (after Wave 4):
- F1-F4: parallel final reviewers and QA gate; depends [12]

Critical path: Task 2 -> Task 6 -> Task 9 -> Task 10 -> Task 11 -> Task 12 -> F1-F4

### Dependency matrix
| Task | Depends on | Blocks | Can parallelize with |
|------|------------|--------|----------------------|
| 1    | none       | 6, 7, 8 | 2, 3, 4, 5          |
| 2    | none       | 6, 7, 8, 9 | 1, 3, 4, 5       |
| 3    | none       | 6      | 1, 2, 4, 5          |
| 4    | none       | 6, 10  | 1, 2, 3, 5          |
| 5    | none       | 6, 7, 8, 9, 10 | 1, 2, 3, 4  |
| 6    | 1, 2, 3, 4, 5 | 9, 10 | 7, 8             |
| 7    | 1, 2, 5    | 10     | 6, 8                |
| 8    | 1, 2, 5    | 10     | 6, 7                |
| 9    | 6          | 10     | none                |
| 10   | 6, 7, 8, 9 | 11     | none                |
| 11   | 10         | 12     | none                |
| 12   | 11         | F1-F4  | none                |

## Todos
> Implementation + Test = ONE task. Never separate.
> Every task MUST have: References + Acceptance Criteria + QA Scenarios + Commit.

- [ ] 1. Preflight drift, current-state, and dirty-worktree audit

  What to do: Run the Plan 008 drift check, record the current source anchors, create `.omo/ulw-loop/evidence/`, and capture the dirty worktree before any source edit. Confirm current `FFmpegTranscoder.transcode()` still hard-codes `libx264`, `_process_video` still constructs `FFmpegTranscoder` without hardware settings, and `Settings` has no `transcode_hwaccel` field yet. Treat any mismatch as a STOP condition.
  Must NOT do: Do not edit files. Do not reset or clean the worktree. Do not treat unrelated existing changes as executor-owned.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6, 7, 8] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:10` - exact drift command and STOP behavior.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:15` - current constructor has no hardware params.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:99` - current inline HLS command construction starts here.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:140` - current hard-coded software FFmpeg run.
  - Pattern:  `apps/api/tasks/transcode_tasks.py:89` - current `_process_video` constructor call.
  - Pattern:  `apps/api/config.py:45` - setting insertion point.
  - Test:     `pytest.ini:1` - API tests are discovered under `apps/api/tests`.

  Acceptance criteria (agent-executable only):
  - [ ] `mkdir -p .omo/ulw-loop/evidence && git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- packages/transcoder/ffmpeg_transcoder.py apps/api/tasks/transcode_tasks.py apps/api/config.py | tee .omo/ulw-loop/evidence/task-1-drift.txt` creates a zero-byte evidence file.
  - [ ] `grep -n '"libx264"' packages/transcoder/ffmpeg_transcoder.py | tee .omo/ulw-loop/evidence/task-1-libx264-baseline.txt` shows the current hard-coded encoder.
  - [ ] `grep -n "FFmpegTranscoder(s3, settings.s3_bucket, settings.s3_endpoint)" apps/api/tasks/transcode_tasks.py | tee .omo/ulw-loop/evidence/task-1-task-baseline.txt` shows the current unwired constructor.
  - [ ] `git -C /Users/neyako/freeframed status --porcelain | tee .omo/ulw-loop/evidence/task-1-status.txt` records dirty state without changing it.

  QA scenarios (MANDATORY - task incomplete without these):
  > Name the exact tool AND its exact invocation - not "verify it works". Browser use: use Chrome to drive the page; if Chrome is not available, download and use agent-browser (https://github.com/vercel-labs/agent-browser). Computer use: OS-level GUI automation for a non-browser desktop app.
  ```
  Scenario: drift guard is clean
    Tool:     bash
    Steps:    mkdir -p .omo/ulw-loop/evidence && git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- packages/transcoder/ffmpeg_transcoder.py apps/api/tasks/transcode_tasks.py apps/api/config.py | tee .omo/ulw-loop/evidence/task-1-drift.txt
    Expected: .omo/ulw-loop/evidence/task-1-drift.txt exists and has zero bytes.
    Evidence: .omo/ulw-loop/evidence/task-1-drift.txt

  Scenario: current hard-coded software baseline is present
    Tool:     bash
    Steps:    grep -n '"libx264"' packages/transcoder/ffmpeg_transcoder.py | tee .omo/ulw-loop/evidence/task-1-libx264-baseline.txt
    Expected: Output contains one encoder argument line in `packages/transcoder/ffmpeg_transcoder.py`; absence means Plan 008 drifted and execution stops.
    Evidence: .omo/ulw-loop/evidence/task-1-libx264-baseline.txt
  ```

  Commit: NO | Message: `chore(transcoder): audit plan 008 preflight` | Files: []

- [ ] 2. Red-first hardware-transcode unit contract tests

  What to do: Delegate to a high-rigor test worker to create `apps/api/tests/test_transcoder_hwaccel.py` before any production code. The tests must cover: auto backend priority; forced backend behavior; software/nvenc/vaapi/qsv command flags; structure invariants for HLS output; settings/task wiring; and runtime fallback from a hardware backend to software after a `subprocess.CalledProcessError`. Run the focused test file and capture failure for the right reason before implementation.
  Must NOT do: Do not implement `packages/transcoder/hwaccel.py` or production changes in this task. Do not accept RED caused by syntax/import errors in the test file itself. Do not commit red tests.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6, 7, 8, 9] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:392` - required test file and no-GPU coverage list.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:396` - backend-selection cases.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:400` - software command assertions.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:404` - VAAPI command assertions.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:406` - QSV command assertions.
  - Pattern:  `apps/api/tests/conftest.py:15` - tests set required env vars before importing app config.
  - API/Type: `packages/transcoder/base.py:6` - `TranscodeJob` fields for fallback test setup.
  - Test:     `pytest.ini:1` - test discovery convention.

  Acceptance criteria (agent-executable only):
  - [ ] `test -f apps/api/tests/test_transcoder_hwaccel.py && grep -n "select_backend" apps/api/tests/test_transcoder_hwaccel.py | tee .omo/ulw-loop/evidence/task-2-test-anchors.txt` exits 0 after test creation.
  - [ ] `bash -lc 'python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q 2>&1 | tee .omo/ulw-loop/evidence/task-2-red-pytest.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0; ! grep -E "SyntaxError|IndentationError" .omo/ulw-loop/evidence/task-2-red-pytest.txt'` proves RED before production implementation.
  - [ ] `grep -n "fallback" apps/api/tests/test_transcoder_hwaccel.py | tee .omo/ulw-loop/evidence/task-2-fallback-test.txt` shows a runtime fallback test exists.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: red-first proof
    Tool:     bash
    Steps:    bash -lc 'python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q 2>&1 | tee .omo/ulw-loop/evidence/task-2-red-pytest.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0; ! grep -E "SyntaxError|IndentationError" .omo/ulw-loop/evidence/task-2-red-pytest.txt'
    Expected: Shell exits 0 because pytest failed before implementation, and the evidence contains no test syntax/import-format failure.
    Evidence: .omo/ulw-loop/evidence/task-2-red-pytest.txt

  Scenario: fallback contract exists
    Tool:     bash
    Steps:    grep -n "fallback" apps/api/tests/test_transcoder_hwaccel.py | tee .omo/ulw-loop/evidence/task-2-fallback-test.txt
    Expected: Output includes at least one fallback test anchor.
    Evidence: .omo/ulw-loop/evidence/task-2-fallback-test.txt
  ```

  Commit: NO | Message: `test(transcoder): add hardware transcode contract tests` | Files: [apps/api/tests/test_transcoder_hwaccel.py]

- [ ] 3. FFmpeg hardware-command reference audit

  What to do: Capture a short evidence note that the helper tests are grounded in official FFmpeg command behavior: VAAPI encoders need hardware surfaces, software frames need `hwupload`, and hardware devices are initialized through FFmpeg hardware-device options. Use this to constrain helper implementation and reviewer focus.
  Must NOT do: Do not expand scope into tuning quality targets, Docker image changes, or Plan 009. Do not block code delivery on real GPU hardware.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - External: `https://ffmpeg.org/ffmpeg-all.html` - FFmpeg hardware device options and VAAPI encoder documentation.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:227` - Plan 008 global hardware args.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:236` - Plan 008 filter suffixes.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:246` - Plan 008 encoder args.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:460` - maintenance note that VAAPI/QSV are best effort and fallback is the safety net.

  Acceptance criteria (agent-executable only):
  - [ ] `cat .omo/ulw-loop/evidence/task-3-ffmpeg-reference.md` exists and contains `VAAPI`, `hwupload`, `-init_hw_device`, and `software fallback`.
  - [ ] Evidence explicitly says real GPU validation is optional for this plan and belongs to hardware/manual deployment QA, not CI.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: command-reference note exists
    Tool:     bash
    Steps:    bash -lc 'test -s .omo/ulw-loop/evidence/task-3-ffmpeg-reference.md && grep -E "VAAPI|hwupload|-init_hw_device|software fallback" .omo/ulw-loop/evidence/task-3-ffmpeg-reference.md'
    Expected: Command exits 0 and prints all required command-risk anchors.
    Evidence: .omo/ulw-loop/evidence/task-3-ffmpeg-reference.md

  Scenario: hardware is not a CI prerequisite
    Tool:     bash
    Steps:    grep -n "GPU validation is optional" .omo/ulw-loop/evidence/task-3-ffmpeg-reference.md | tee .omo/ulw-loop/evidence/task-3-hardware-nonblocking.txt
    Expected: Output contains the non-blocking hardware statement.
    Evidence: .omo/ulw-loop/evidence/task-3-hardware-nonblocking.txt
  ```

  Commit: NO | Message: `docs(transcoder): record ffmpeg hardware command assumptions` | Files: []

- [ ] 4. Package-boundary and libx264 baseline audit

  What to do: Record the package-boundary baseline and the current encoder location before implementation. This gives reviewers a before/after proof that `libx264` moved out of `ffmpeg_transcoder.py` and that `packages/transcoder` stayed independent of `apps.api`.
  Must NOT do: Do not edit files. Do not broaden grep to tests when checking the package boundary; the boundary is `packages/transcoder/**`.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6, 10] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:131` - package boundary rule.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:441` - done criterion that `libx264` leaves `ffmpeg_transcoder.py`.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:442` - done criterion for no `apps.api` imports.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:118` - current `libx264` encoder line.

  Acceptance criteria (agent-executable only):
  - [ ] `bash -lc 'grep -rn "apps.api" packages/transcoder 2>&1 | tee .omo/ulw-loop/evidence/task-4-boundary-baseline.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0'` proves no current package-boundary violation.
  - [ ] `grep -n '"libx264"' packages/transcoder/ffmpeg_transcoder.py | tee .omo/ulw-loop/evidence/task-4-libx264-before.txt` shows pre-change encoder location.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: no current app import in transcoder package
    Tool:     bash
    Steps:    bash -lc 'grep -rn "apps.api" packages/transcoder 2>&1 | tee .omo/ulw-loop/evidence/task-4-boundary-baseline.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0'
    Expected: Shell exits 0 because grep found no matches.
    Evidence: .omo/ulw-loop/evidence/task-4-boundary-baseline.txt

  Scenario: pre-change encoder location is known
    Tool:     bash
    Steps:    grep -n '"libx264"' packages/transcoder/ffmpeg_transcoder.py | tee .omo/ulw-loop/evidence/task-4-libx264-before.txt
    Expected: Output contains the current `libx264` command line.
    Evidence: .omo/ulw-loop/evidence/task-4-libx264-before.txt
  ```

  Commit: NO | Message: `chore(transcoder): audit package boundary baseline` | Files: []

- [ ] 5. Delegation setup and worker handoff contract

  What to do: Before Wave 2, create an execution handoff note naming each worker lane, exact files it may touch, RED evidence it inherits, and verification it must return. Dispatch Task 6, Task 7, and Task 8 in parallel after Task 2 RED is captured. Require each worker to start with `WORKING: plan008-<task> - <phase>` and to return `BLOCKED: <reason>` only when blocked.
  Must NOT do: Do not hand off vague context. Do not let workers edit files outside their assigned task. Do not accept worker completion without command evidence and a diff summary.

  Parallelization: Can parallel: YES | Wave 1 | Blocks: [6, 7, 8, 9, 10] | Blocked by: []

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:151` - in-scope file list for worker assignments.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:169` - branch and commit workflow.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:446` - STOP conditions that must be forwarded to every worker.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - RED proof file from Task 2.

  Acceptance criteria (agent-executable only):
  - [ ] `.omo/ulw-loop/evidence/task-5-worker-handoff.md` exists and names worker lanes for Tasks 6, 7, 8, 9, 10, 11, and final reviewers.
  - [ ] The handoff includes each lane's allowed files and evidence paths.
  - [ ] The handoff includes `fork_context: false` and `WORKING:`/`BLOCKED:` response requirements for downstream worker messages.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: worker handoff covers all implementation lanes
    Tool:     bash
    Steps:    bash -lc 'test -s .omo/ulw-loop/evidence/task-5-worker-handoff.md && grep -E "Task 6|Task 7|Task 8|Task 9|Task 10|Task 11|final reviewer" .omo/ulw-loop/evidence/task-5-worker-handoff.md'
    Expected: Command exits 0 and prints all required lane names.
    Evidence: .omo/ulw-loop/evidence/task-5-worker-handoff.md

  Scenario: handoff enforces exact worker protocol
    Tool:     bash
    Steps:    bash -lc 'grep -E "fork_context: false|WORKING:|BLOCKED:" .omo/ulw-loop/evidence/task-5-worker-handoff.md'
    Expected: Command exits 0 and prints all protocol requirements.
    Evidence: .omo/ulw-loop/evidence/task-5-worker-handoff.md
  ```

  Commit: NO | Message: `chore(transcoder): prepare plan 008 worker handoff` | Files: []

- [ ] 6. Add `packages/transcoder/hwaccel.py`

  What to do: Delegate to a high-rigor implementation worker. Create `packages/transcoder/hwaccel.py` with the pure helper contract from Plan 008: backend constants, `select_backend`, `probe_encoders`, `resolve_backend`, `_global_args`, `_filter_suffix`, `_encoder_args`, and `build_hls_command`. Keep the helper dependency-free except stdlib. Make the Task 2 selection/command tests green without modifying app wiring or `FFmpegTranscoder`.
  Must NOT do: Do not import from `apps.api`. Do not execute real FFmpeg except `probe_encoders()` with the Plan 008 timeout. Do not touch `ffmpeg_transcoder.py`, `transcode_tasks.py`, `config.py`, or `.env.example` in this task.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [9, 10] | Blocked by: [1, 2, 3, 4, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:177` - helper module scope.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:197` - `select_backend` behavior.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:212` - `probe_encoders` behavior and timeout.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:260` - `build_hls_command` contract.
  - External: `https://ffmpeg.org/ffmpeg-all.html` - VAAPI encoders need hardware surfaces; software frames use `hwupload`.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - selection and command-builder tests from Task 2.

  Acceptance criteria (agent-executable only):
  - [ ] `python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend"` exits 0.
  - [ ] `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "select_backend or build_hls_command" | tee .omo/ulw-loop/evidence/task-6-helper-pytest.txt` exits 0.
  - [ ] `bash -lc 'grep -rn "apps.api" packages/transcoder 2>&1 | tee .omo/ulw-loop/evidence/task-6-boundary.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0'` exits 0.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: helper imports and focused tests pass
    Tool:     bash
    Steps:    python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "select_backend or build_hls_command" | tee .omo/ulw-loop/evidence/task-6-helper-pytest.txt
    Expected: pytest exits 0 and covers auto priority plus software/nvenc/vaapi/qsv command shapes.
    Evidence: .omo/ulw-loop/evidence/task-6-helper-pytest.txt

  Scenario: helper does not break package boundary
    Tool:     bash
    Steps:    bash -lc 'grep -rn "apps.api" packages/transcoder 2>&1 | tee .omo/ulw-loop/evidence/task-6-boundary.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0'
    Expected: Shell exits 0 because no `apps.api` import appears under `packages/transcoder`.
    Evidence: .omo/ulw-loop/evidence/task-6-boundary.txt
  ```

  Commit: NO | Message: `feat(transcoder): add hardware encoder command helpers` | Files: [packages/transcoder/hwaccel.py, apps/api/tests/test_transcoder_hwaccel.py]

- [ ] 7. Add API settings and env documentation

  What to do: Delegate to a focused implementation worker. Add `transcode_hwaccel: str = "auto"` and `transcode_vaapi_device: str = "/dev/dri/renderD128"` immediately after `transcoder_engine` in `apps/api/config.py`. Document `TRANSCODE_HWACCEL=auto` and `TRANSCODE_VAAPI_DEVICE=/dev/dri/renderD128` in `apps/api/.env.example`. Make settings/env tests green.
  Must NOT do: Do not validate hardware availability in `Settings`. Do not change unrelated settings or env placeholder values.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [10] | Blocked by: [1, 2, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:304` - exact config insertion requirement.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:379` - env example requirement.
  - Pattern:  `apps/api/config.py:21` - `Settings(BaseSettings)` class.
  - Pattern:  `apps/api/config.py:45` - `transcoder_engine` insertion point.
  - Pattern:  `apps/api/.env.example:13` - existing `TRANSCODER_ENGINE` env example.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - settings/env expectations from Task 2.

  Acceptance criteria (agent-executable only):
  - [ ] `DATABASE_URL=postgresql://user:pass@localhost:5432/freeframe_test REDIS_URL=redis://localhost:6379/0 JWT_SECRET=test python -c "from apps.api.config import settings; print(settings.transcode_hwaccel, settings.transcode_vaapi_device)" | tee .omo/ulw-loop/evidence/task-7-settings.txt` prints `auto /dev/dri/renderD128`.
  - [ ] `grep -n "TRANSCODE_HWACCEL" apps/api/.env.example | tee .omo/ulw-loop/evidence/task-7-env-hwaccel.txt` has one match.
  - [ ] `grep -n "TRANSCODE_VAAPI_DEVICE" apps/api/.env.example | tee .omo/ulw-loop/evidence/task-7-env-vaapi.txt` has one match.
  - [ ] `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "settings or env" | tee .omo/ulw-loop/evidence/task-7-settings-pytest.txt` exits 0.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: settings defaults import
    Tool:     bash
    Steps:    DATABASE_URL=postgresql://user:pass@localhost:5432/freeframe_test REDIS_URL=redis://localhost:6379/0 JWT_SECRET=test python -c "from apps.api.config import settings; print(settings.transcode_hwaccel, settings.transcode_vaapi_device)" | tee .omo/ulw-loop/evidence/task-7-settings.txt
    Expected: Output is exactly `auto /dev/dri/renderD128`.
    Evidence: .omo/ulw-loop/evidence/task-7-settings.txt

  Scenario: env example documents both knobs
    Tool:     bash
    Steps:    bash -lc 'grep -n "TRANSCODE_HWACCEL=auto" apps/api/.env.example && grep -n "TRANSCODE_VAAPI_DEVICE=/dev/dri/renderD128" apps/api/.env.example' | tee .omo/ulw-loop/evidence/task-7-env.txt
    Expected: Both grep commands print one matching line.
    Evidence: .omo/ulw-loop/evidence/task-7-env.txt
  ```

  Commit: NO | Message: `feat(api): add transcode hardware settings` | Files: [apps/api/config.py, apps/api/.env.example, apps/api/tests/test_transcoder_hwaccel.py]

- [ ] 8. Wire `_process_video` to pass settings

  What to do: Delegate to a focused implementation worker. Update `_process_video` so `FFmpegTranscoder` receives `hwaccel=settings.transcode_hwaccel` and `vaapi_device=settings.transcode_vaapi_device`. Make the wiring tests/greps green.
  Must NOT do: Do not touch `_process_audio`, `_process_image`, queue routing, database updates, or the `TranscodeJob` shape.

  Parallelization: Can parallel: YES | Wave 2 | Blocks: [10] | Blocked by: [1, 2, 5]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:365` - exact task wiring requirement.
  - Pattern:  `apps/api/tasks/transcode_tasks.py:85` - `_process_video` starts here.
  - Pattern:  `apps/api/tasks/transcode_tasks.py:89` - current `FFmpegTranscoder` construction.
  - API/Type: `packages/transcoder/base.py:6` - `TranscodeJob` shape must not change.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - wiring test from Task 2.

  Acceptance criteria (agent-executable only):
  - [ ] `grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py | tee .omo/ulw-loop/evidence/task-8-hwaccel-grep.txt` has one match.
  - [ ] `grep -n "vaapi_device=settings.transcode_vaapi_device" apps/api/tasks/transcode_tasks.py | tee .omo/ulw-loop/evidence/task-8-vaapi-grep.txt` has one match.
  - [ ] `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "task_wiring" | tee .omo/ulw-loop/evidence/task-8-wiring-pytest.txt` exits 0.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: constructor receives hardware settings
    Tool:     bash
    Steps:    bash -lc 'grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py && grep -n "vaapi_device=settings.transcode_vaapi_device" apps/api/tasks/transcode_tasks.py' | tee .omo/ulw-loop/evidence/task-8-wiring-grep.txt
    Expected: Both grep commands print one matching line.
    Evidence: .omo/ulw-loop/evidence/task-8-wiring-grep.txt

  Scenario: task wiring unit passes
    Tool:     bash
    Steps:    python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "task_wiring" | tee .omo/ulw-loop/evidence/task-8-wiring-pytest.txt
    Expected: pytest exits 0 and proves `_process_video` passes both new keyword arguments.
    Evidence: .omo/ulw-loop/evidence/task-8-wiring-pytest.txt
  ```

  Commit: NO | Message: `feat(api): pass transcode hardware settings to worker` | Files: [apps/api/tasks/transcode_tasks.py, apps/api/tests/test_transcoder_hwaccel.py]

- [ ] 9. Update `FFmpegTranscoder` to use helpers and fallback

  What to do: Delegate to a high-rigor implementation worker. Add `hwaccel` and `vaapi_device` constructor parameters while preserving existing positional args. Import `resolve_backend` and `build_hls_command` from `.hwaccel`. Replace only the inline HLS command construction and HLS `subprocess.run` with helper-based construction, backend resolution, and one retry with software on `subprocess.CalledProcessError` when the first backend is hardware. Before retrying, wipe and recreate per-quality HLS directories. Keep upload, thumbnail, result, and cleanup behavior unchanged.
  Must NOT do: Do not change metadata probing, S3 upload, thumbnail generation, content types, HLS flags, or quality ladder. Do not catch all exceptions for fallback; Plan 008 specifies `CalledProcessError`.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [10] | Blocked by: [6]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:317` - exact `FFmpegTranscoder` update steps.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:15` - constructor to extend.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:88` - quality ladder begins here and must remain.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:96` - HLS directory setup.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:99` - inline command block to replace.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:142` - upload behavior starts and must remain unchanged.
  - Pattern:  `packages/transcoder/ffmpeg_transcoder.py:155` - thumbnail behavior starts and must remain unchanged.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - fallback and software-invariant tests from Task 2.

  Acceptance criteria (agent-executable only):
  - [ ] `python -c "import packages.transcoder.ffmpeg_transcoder"` exits 0.
  - [ ] `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "fallback or software_command_invariant or constructor" | tee .omo/ulw-loop/evidence/task-9-transcoder-pytest.txt` exits 0.
  - [ ] `bash -lc '! grep -n "\"libx264\"" packages/transcoder/ffmpeg_transcoder.py' | tee .omo/ulw-loop/evidence/task-9-no-libx264.txt` exits 0.
  - [ ] `grep -n "CalledProcessError" packages/transcoder/ffmpeg_transcoder.py | tee .omo/ulw-loop/evidence/task-9-fallback-grep.txt` has one fallback handling block.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: fallback behavior is green
    Tool:     bash
    Steps:    python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k "fallback" | tee .omo/ulw-loop/evidence/task-9-fallback-pytest.txt
    Expected: pytest exits 0 and proves a hardware failure triggers exactly one software retry after resetting HLS quality dirs.
    Evidence: .omo/ulw-loop/evidence/task-9-fallback-pytest.txt

  Scenario: encoder string leaves transcoder class
    Tool:     bash
    Steps:    bash -lc '! grep -n "\"libx264\"" packages/transcoder/ffmpeg_transcoder.py' | tee .omo/ulw-loop/evidence/task-9-no-libx264.txt
    Expected: Shell exits 0 because `libx264` now lives in `packages/transcoder/hwaccel.py`, not `ffmpeg_transcoder.py`.
    Evidence: .omo/ulw-loop/evidence/task-9-no-libx264.txt
  ```

  Commit: NO | Message: `feat(transcoder): use hardware encoder helpers with fallback` | Files: [packages/transcoder/ffmpeg_transcoder.py, packages/transcoder/hwaccel.py, apps/api/tests/test_transcoder_hwaccel.py]

- [ ] 10. Focused integration and static safety checks

  What to do: Root agent integrates Wave 2/3 results, reads the diff, reruns all focused tests, and captures import/settings/grep checks. Reject any worker diff that changes out-of-scope files or lacks RED/GREEN evidence. This is the first gate where all implementation pieces must work together.
  Must NOT do: Do not update `plans/README.md` yet. Do not proceed to full suite if focused tests or static safety checks fail.

  Parallelization: Can parallel: NO | Wave 3 | Blocks: [11] | Blocked by: [6, 7, 8, 9]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:138` - required verification commands.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:432` - done criteria.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:441` - `libx264` grep criterion.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:442` - package-boundary grep criterion.
  - Test:     `apps/api/tests/test_transcoder_hwaccel.py` - focused test suite.

  Acceptance criteria (agent-executable only):
  - [ ] `python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q | tee .omo/ulw-loop/evidence/task-10-focused-pytest.txt` exits 0.
  - [ ] `python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend" | tee .omo/ulw-loop/evidence/task-10-hwaccel-import.txt` exits 0.
  - [ ] `DATABASE_URL=postgresql://user:pass@localhost:5432/freeframe_test REDIS_URL=redis://localhost:6379/0 JWT_SECRET=test python -c "from apps.api.config import settings; print(settings.transcode_hwaccel)" | tee .omo/ulw-loop/evidence/task-10-settings.txt` prints a value.
  - [ ] `grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py | tee .omo/ulw-loop/evidence/task-10-task-grep.txt` has one match.
  - [ ] `grep -n "TRANSCODE_HWACCEL" apps/api/.env.example | tee .omo/ulw-loop/evidence/task-10-env-grep.txt` has one match.
  - [ ] `bash -lc '! grep -n "\"libx264\"" packages/transcoder/ffmpeg_transcoder.py' | tee .omo/ulw-loop/evidence/task-10-no-libx264.txt` exits 0.
  - [ ] `bash -lc 'grep -rn "apps.api" packages/transcoder 2>&1 | tee .omo/ulw-loop/evidence/task-10-boundary.txt; status=${PIPESTATUS[0]}; test "$status" -ne 0'` exits 0.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: focused Plan 008 test suite is green
    Tool:     bash
    Steps:    python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q | tee .omo/ulw-loop/evidence/task-10-focused-pytest.txt
    Expected: pytest exits 0 with at least the Plan 008 required selection, command, structure, fallback, settings, and wiring tests.
    Evidence: .omo/ulw-loop/evidence/task-10-focused-pytest.txt

  Scenario: static safety checks pass
    Tool:     bash
    Steps:    bash -lc 'python -c "from packages.transcoder.hwaccel import select_backend, build_hls_command, resolve_backend" && DATABASE_URL=postgresql://user:pass@localhost:5432/freeframe_test REDIS_URL=redis://localhost:6379/0 JWT_SECRET=test python -c "from apps.api.config import settings; print(settings.transcode_hwaccel)" && grep -n "hwaccel=settings.transcode_hwaccel" apps/api/tasks/transcode_tasks.py && grep -n "TRANSCODE_HWACCEL" apps/api/.env.example && ! grep -n "\"libx264\"" packages/transcoder/ffmpeg_transcoder.py && ! grep -rn "apps.api" packages/transcoder' | tee .omo/ulw-loop/evidence/task-10-static-safety.txt
    Expected: Shell exits 0 and the evidence contains import/settings/grep outputs.
    Evidence: .omo/ulw-loop/evidence/task-10-static-safety.txt
  ```

  Commit: NO | Message: `test(transcoder): verify hardware transcode integration` | Files: [apps/api/tests/test_transcoder_hwaccel.py, packages/transcoder/hwaccel.py, packages/transcoder/ffmpeg_transcoder.py, apps/api/config.py, apps/api/tasks/transcode_tasks.py, apps/api/.env.example]

- [ ] 11. Full API suite and Plan README status update

  What to do: Run the full API suite. If collection fails due missing dependencies, run `pip install -r apps/api/requirements.txt` once and retry; if still failing, STOP. After full suite passes, update only Plan 008 row in `plans/README.md` from TODO to DONE with the repository's observed status wording. Capture scoped diff and status evidence.
  Must NOT do: Do not update `plans/README.md` before tests pass. Do not modify rows for other plans. Do not include unrelated `.omo`, `.playwright-cli`, `output`, `tools`, or untracked plan files in the commit.

  Parallelization: Can parallel: NO | Wave 4 | Blocks: [12] | Blocked by: [10]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:415` - full suite requirement.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:432` - done criteria.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:443` - only in-scope files modified criterion.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:444` - `plans/README.md` status update criterion.
  - Pattern:  `plans/README.md:40` - current Plan 008 status row.
  - Test:     `pytest.ini:1` - full suite discovery.

  Acceptance criteria (agent-executable only):
  - [ ] `python -m pytest apps/api/tests -q | tee .omo/ulw-loop/evidence/task-11-full-pytest.txt` exits 0.
  - [ ] `grep -n "| 008 |" plans/README.md | tee .omo/ulw-loop/evidence/task-11-readme-row.txt` shows Plan 008 as DONE.
  - [ ] `git diff --name-only | tee .omo/ulw-loop/evidence/task-11-diff-files.txt` lists only allowed implementation files plus `plans/README.md` and the test file.
  - [ ] `git diff --check | tee .omo/ulw-loop/evidence/task-11-diff-check.txt` exits 0.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: full API regression suite
    Tool:     bash
    Steps:    python -m pytest apps/api/tests -q | tee .omo/ulw-loop/evidence/task-11-full-pytest.txt
    Expected: pytest exits 0.
    Evidence: .omo/ulw-loop/evidence/task-11-full-pytest.txt

  Scenario: Plan README row updated after green suite
    Tool:     bash
    Steps:    grep -n "| 008 |" plans/README.md | tee .omo/ulw-loop/evidence/task-11-readme-row.txt
    Expected: Output contains Plan 008 row with `DONE` and no unrelated row status changes from this task.
    Evidence: .omo/ulw-loop/evidence/task-11-readme-row.txt
  ```

  Commit: NO | Message: `docs(plans): mark hardware transcode plan verified` | Files: [plans/README.md]

- [ ] 12. ULW ledger evidence, scoped commit, and cleanup receipts

  What to do: Record each SC-008 criterion through the ULW CLI with concrete evidence paths and cleanup receipts. Stage exactly the Plan 008 implementation files, run staged diff checks, and commit one atomic Conventional Commit with the plan footer. If this execution policy forbids committing, stage the exact files, write `.omo/ulw-loop/evidence/task-12-no-commit.md` with the reason, and do not claim commit completion.
  Must NOT do: Do not stage evidence files, unrelated untracked directories, previous plan artifacts, or user-owned dirty files outside Plan 008. Do not push or open a PR.

  Parallelization: Can parallel: NO | Wave 4 | Blocks: [F1, F2, F3, F4] | Blocked by: [11]

  References (executor has NO interview context - be exhaustive):
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:169` - branch and commit workflow.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:432` - done criteria to record.
  - Pattern:  `plans/008-hardware-accelerated-transcode.md:446` - STOP conditions.
  - Pattern:  `plans/README.md:40` - status row included in final commit.
  - Test:     `.omo/ulw-loop/evidence/task-10-focused-pytest.txt` - focused test evidence.
  - Test:     `.omo/ulw-loop/evidence/task-11-full-pytest.txt` - full suite evidence.

  Acceptance criteria (agent-executable only):
  - [ ] `git add packages/transcoder/hwaccel.py packages/transcoder/ffmpeg_transcoder.py apps/api/tasks/transcode_tasks.py apps/api/config.py apps/api/tests/test_transcoder_hwaccel.py apps/api/.env.example plans/README.md` stages only allowed files.
  - [ ] `git diff --cached --name-only | tee .omo/ulw-loop/evidence/task-12-staged-files.txt` output is exactly those seven files.
  - [ ] `git diff --cached --check | tee .omo/ulw-loop/evidence/task-12-staged-diff-check.txt` exits 0.
  - [ ] `git commit -m "feat(transcoder): add hardware encoder selection" -m "Plan: .omo/plans/008-hardware-accelerated-transcode-execution.md"` exits 0 if commits are authorized.
  - [ ] `git log -1 --format=%B | tee .omo/ulw-loop/evidence/task-12-commit-message.txt` contains the subject and plan footer if committed.

  QA scenarios (MANDATORY - task incomplete without these):
  ```
  Scenario: staged diff is scoped to Plan 008 files
    Tool:     bash
    Steps:    git diff --cached --name-only | tee .omo/ulw-loop/evidence/task-12-staged-files.txt
    Expected: Output is exactly `apps/api/.env.example`, `apps/api/config.py`, `apps/api/tasks/transcode_tasks.py`, `apps/api/tests/test_transcoder_hwaccel.py`, `packages/transcoder/ffmpeg_transcoder.py`, `packages/transcoder/hwaccel.py`, and `plans/README.md`.
    Evidence: .omo/ulw-loop/evidence/task-12-staged-files.txt

  Scenario: commit includes plan footer
    Tool:     bash
    Steps:    git log -1 --format=%B | tee .omo/ulw-loop/evidence/task-12-commit-message.txt
    Expected: Output contains `feat(transcoder): add hardware encoder selection` and `Plan: .omo/plans/008-hardware-accelerated-transcode-execution.md`.
    Evidence: .omo/ulw-loop/evidence/task-12-commit-message.txt
  ```

  Commit: YES | Message: `feat(transcoder): add hardware encoder selection` | Files: [apps/api/.env.example, apps/api/config.py, apps/api/tasks/transcode_tasks.py, apps/api/tests/test_transcoder_hwaccel.py, packages/transcoder/ffmpeg_transcoder.py, packages/transcoder/hwaccel.py, plans/README.md]

## Final verification wave (MANDATORY - after all implementation tasks)
> Runs in PARALLEL. ALL must APPROVE. Surface results to the caller and wait for an explicit "okay" before declaring complete.
- [ ] F1. Plan compliance audit - verify every `plans/008-hardware-accelerated-transcode.md:432` done criterion, every STOP condition at `plans/008-hardware-accelerated-transcode.md:446` remains false, and every SC-008 criterion has evidence under `.omo/ulw-loop/evidence/`.
- [ ] F2. Code quality review - inspect the final diff for minimality, unused imports, command-builder clarity, deterministic tests, no real FFmpeg/GPU dependency in tests, no dead code, and idioms matching the local Python style.
- [ ] F3. Real manual QA - rerun the auxiliary surfaces for SC-008-RED, SC-008-HAPPY, SC-008-EDGE, SC-008-FALLBACK, SC-008-WIRING, SC-008-REGRESSION, and SC-008-FULL; assert every evidence file exists and is non-empty.
- [ ] F4. Scope fidelity - confirm only the allowed Plan 008 files changed, `packages/transcoder/**` contains no `apps.api` import, `ffmpeg_transcoder.py` contains no `"libx264"` encoder string, and no Docker/Plan 009/deploy/audio/image code was touched.

Reviewer loop:
- Spawn reviewers in parallel for F1-F4 with `fork_context: false`; each reviewer must return `APPROVE` or `REJECT` plus evidence path.
- Treat timeout, missing deliverable, `BLOCKED:`, or "looks good but..." as rejection.
- Fix every reviewer concern, rerun focused and full QA, capture fresh evidence, and resubmit to the same reviewers until all return unconditional `APPROVE`.
- Store reports at `.omo/ulw-loop/evidence/plan008-final-compliance.md`, `.omo/ulw-loop/evidence/plan008-final-code-quality.md`, `.omo/ulw-loop/evidence/plan008-final-manual-qa.md`, `.omo/ulw-loop/evidence/plan008-final-scope.md`, and summary JSON at `.omo/ulw-loop/evidence/plan008-quality-gate.json`.

## Commit strategy
- One logical change per commit. Conventional Commits (`<type>(<scope>): <subject>` body + footer).
- Atomic: every commit builds and passes tests on its own.
- No "WIP" / "fix typo squash later" commits on the final branch - clean up before merge.
- Reference the plan file path in the final commit footer: `Plan: .omo/plans/008-hardware-accelerated-transcode-execution.md`.
- Because Task 2 intentionally creates red tests, do not commit until Task 12 after focused tests, full suite, static checks, and README status all pass.
- Do not push or open a PR unless separately instructed.

## Success criteria
- All Must-Have shipped; all QA scenarios pass with captured evidence; F1-F4 approved; commit history clean.
