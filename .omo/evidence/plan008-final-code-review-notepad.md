# Plan 008 Final Code Review Notepad

Tier: HEAVY

Justification: User requested rigorous final code review for hardware-accelerated transcoding work across transcoder, API config, task wiring, tests, and evidence artifacts.

Skills:
- omo:programming: Required for Python code review; Python README and code-smell references loaded.
- omo:remove-ai-slops: Required by review instructions for slop/overfit pass over production and test code.
- karpathy-guidelines: Loaded from AGENTS.md for simplicity, surgical scope, assumptions, and verifiable criteria.
- caveman: Loaded from AGENTS.md; not applied to report body because formal code-review artifact needs normal clarity.

Context7: Skipped because this is code review, and AGENTS.md says Context7 is not for code review.

Success Criteria:
- Final report written to `.omo/evidence/plan008-final-code-review.md`.
- Current worktree diff and focus files reviewed against `plans/008-hardware-accelerated-transcode.md`.
- Required evidence artifacts checked for existence and substance.
- Requested `rtk` verification commands run or existing output inspected: focused backend slice, focused Plan 008 tests, full API tests, ruff, py_compile/import, package-boundary grep, `git diff --check`, artifact existence.
- Slop/programming review applied to production and tests.

Stop Condition:
- Return APPROVE only if no CRITICAL/HIGH blocker remains and verification artifacts are concrete.

Final Result:
- Report: `.omo/evidence/plan008-final-code-review.md`
- Recommendation: APPROVE
- codeQualityStatus: WATCH
- Blockers: none
- Residual watch item: `apps/api/tests/test_transcoder_hwaccel.py` is 259 pure LOC, slightly over the programming threshold but not a blocking slop/test-quality issue.
