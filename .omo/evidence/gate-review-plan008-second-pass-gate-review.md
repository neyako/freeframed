recommendation: REJECT

## blockers

1. Missing Plan 008 final QA / quality-gate artifacts.
   - Artifact paths checked:
     - `.omo/ulw-loop/evidence/plan008-final-compliance.md`
     - `.omo/ulw-loop/evidence/plan008-final-code-quality.md`
     - `.omo/ulw-loop/evidence/plan008-final-manual-qa.md`
     - `.omo/ulw-loop/evidence/plan008-final-scope.md`
     - `.omo/ulw-loop/evidence/plan008-quality-gate.json`
     - `.omo/evidence/plan008-qa-matrix.md`
     - `.omo/evidence/plan008-qa-review.md`
   - Evidence: `rtk bash -lc 'for f in ...; do test -e "$f" ...; done'` reported all paths above as `MISSING`.
   - Why blocking: `.omo/plans/008-hardware-accelerated-transcode-execution.md` requires SC-008-REVIEW with final reviewer reports under `.omo/ulw-loop/evidence/plan008-final-*.md` and quality gate JSON at `.omo/ulw-loop/evidence/plan008-quality-gate.json`. The user prompt asserts QA APPROVE, but no Plan 008 QA artifact is present to inspect.
   - Remediation command:
     `rtk bash -lc 'test -s .omo/ulw-loop/evidence/plan008-final-manual-qa.md && test -s .omo/ulw-loop/evidence/plan008-final-scope.md && test -s .omo/ulw-loop/evidence/plan008-quality-gate.json && test -s .omo/evidence/plan008-qa-review.md'`
     Parent must first run the Plan 008 final QA/reviewer wave and produce those artifacts; this command is the required post-fix readiness check.

2. Direct `remove-ai-slops` pass found unresolved tautological test coverage.
   - File/path: `apps/api/tests/test_transcoder_hwaccel.py:58`
   - Evidence: `TestResolveBackend.test_resolve_backend_is_importable` only asserts `callable(resolve_backend)` and pins `BACKENDS == ("nvenc", "qsv", "vaapi", "software")`. That is import/constant-pinning coverage, not behavior. It should be a CLI import sanity check or real `resolve_backend` behavior coverage.
   - Why blocking: the gate instructions require rejecting unresolved overfit/slop. This test creates false confidence and is exactly the kind of tautological test the slop pass must catch.
   - Remediation command:
     `PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -k 'resolve_backend or select_backend' -p no:cacheprovider`
     Parent must replace the tautological test with behavior coverage that monkeypatches `os.path.isdir`, `os.path.exists`, `shutil.which`, and `probe_encoders`, or remove it if `resolve_backend` remains covered by CLI import sanity only.

3. Failing-first evidence is not behavioral RED proof.
   - Artifact path: `.omo/ulw-loop/evidence/008-c001-focused-red-green.txt`
   - Evidence: the RED section is `ERROR: file or directory not found: apps/api/tests/test_transcoder_hwaccel.py`.
   - Why blocking: ULW/programming criteria require a failing test that proves the missing behavior. A missing test file only proves the file was absent.
   - Remediation command:
     `PYTHONDONTWRITEBYTECODE=1 rtk uv run --with-requirements apps/api/requirements.txt --python 3.11 --no-project python -m pytest apps/api/tests/test_transcoder_hwaccel.py -q -p no:cacheprovider`
     Parent must run that command in a pre-implementation/temp worktree where `apps/api/tests/test_transcoder_hwaccel.py` exists but the production helper/wiring is absent, capture failure for missing behavior/module, then capture GREEN on the final branch.

4. Scope evidence still shows out-of-scope dirty paths without a supporting baseline.
   - Artifact paths: `.omo/ulw-loop/evidence/008-c003-cli-done-criteria.txt`, `.omo/ulw-loop/evidence/plan008-final-diff-and-files.txt`, `plans/README.md`
   - Evidence: `git status` in the artifacts lists out-of-scope untracked paths such as `.playwright-cli/`, `output/`, `tools/`, and plans `001` through `010`; `plans/README.md` diff changes rows/sections beyond Plan 008.
   - Why blocking: Plan 008 done criteria include only in-scope files modified. Code review says the broader planning diff is pre-existing, but the artifact set lacks a baseline receipt proving that claim.
   - Remediation command:
     `rtk bash -lc 'git status --porcelain && git diff -- plans/README.md && test -s .omo/ulw-loop/evidence/plan008-preexisting-dirty-baseline.txt'`
     Parent must either provide the missing baseline receipt proving those paths/hunks predate Plan 008, or split/revert unrelated dirty state so Plan 008 evidence shows only in-scope changes plus the Plan 008 row.

## originalIntent

Execute `plans/008-hardware-accelerated-transcode.md` end-to-end under ULW in `/Users/neyako/freeframed`: implement hardware H.264 encoder selection for FFmpeg (`nvenc`, `qsv`, `vaapi`, `software`), software fallback on hardware encode failure, settings/env/task wiring, tests, evidence, Plan 008 row DONE, all subagents waited, and reviewer approval.

## desiredOutcome

The user-visible result should be a checkpoint-ready Plan 008 delivery where the transcoder selects the configured/auto hardware backend, falls back to software safely, preserves software HLS output shape, keeps `packages/transcoder` independent of `apps.api`, has focused/full tests and lint passing, has complete QA/review artifacts, and has no unresolved slop or scope evidence gaps. No commit is required.

## userOutcomeReview

Direct code/test verification is mostly healthy, but the shipped artifact does not yet satisfy the final gate from the user's perspective. Focused tests, full API tests, ruff, import/settings, package-boundary, env, task wiring, and Plan 008 DONE checks pass. The gate still fails because required QA/final-gate artifacts are missing, one test is tautological, the RED proof is file-absence rather than behavior failure, and scope evidence still depends on an unsupported pre-existing-dirt claim.

## checkedArtifactPaths

- `plans/008-hardware-accelerated-transcode.md`
- `.omo/plans/008-hardware-accelerated-transcode-execution.md`
- `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/brief.md`
- `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/goals.json`
- `.omo/ulw-loop/019f127d-c44f-7092-8f4f-4c5611acaf26/ledger.jsonl`
- `.omo/ulw-loop/evidence/plan008-final-diff-and-files.txt`
- `.omo/ulw-loop/evidence/008-c001-focused-red-green.txt`
- `.omo/ulw-loop/evidence/008-c002-full-regression-gates.txt`
- `.omo/ulw-loop/evidence/008-c003-cli-done-criteria.txt`
- `.omo/evidence/code-review-plan008-code-review.md`
- `.omo/evidence/plan008-gate-review.md`
- `packages/transcoder/hwaccel.py`
- `packages/transcoder/ffmpeg_transcoder.py`
- `apps/api/tasks/transcode_tasks.py`
- `apps/api/config.py`
- `apps/api/.env.example`
- `apps/api/tests/test_transcoder_hwaccel.py`
- `plans/README.md`

## directVerification

- PASS: focused tests: `14 passed in 0.31s`.
- PASS: full API tests: `87 passed, 1 warning in 0.99s`.
- PASS: ruff on changed Python files: `All checks passed!`.
- PASS: import/settings command printed `auto /dev/dri/renderD128`.
- PASS: `git diff --check` on scoped files.
- PASS: package-boundary grep found no `apps.api` imports under `packages/transcoder`.
- PASS: `libx264` absent from `packages/transcoder/ffmpeg_transcoder.py`.
- PASS: task wiring, env var, and Plan 008 DONE row greps.
- PASS: code review report exists at `.omo/evidence/code-review-plan008-code-review.md` and explicitly claims `remove-ai-slops` and `programming` coverage.
- FAIL: no Plan 008 QA/final quality gate artifacts found.
- FAIL: direct slop pass found tautological import/constant-pinning test.
- FAIL: RED evidence is missing-test-file failure, not behavioral failure.
- FAIL: scope evidence lacks baseline for out-of-scope dirty paths and README hunks.

## exactEvidenceGaps

- Missing: `.omo/ulw-loop/evidence/plan008-final-compliance.md`
- Missing: `.omo/ulw-loop/evidence/plan008-final-code-quality.md`
- Missing: `.omo/ulw-loop/evidence/plan008-final-manual-qa.md`
- Missing: `.omo/ulw-loop/evidence/plan008-final-scope.md`
- Missing: `.omo/ulw-loop/evidence/plan008-quality-gate.json`
- Missing: `.omo/evidence/plan008-qa-matrix.md`
- Missing: `.omo/evidence/plan008-qa-review.md`
- Missing: behavior-level RED artifact for Plan 008.
- Missing: dirty-worktree baseline proving unrelated plans/README/output/tools changes pre-existed Plan 008.
