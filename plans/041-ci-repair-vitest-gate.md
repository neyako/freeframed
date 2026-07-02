# Plan 041: Repair CI — remove stale critical-file entry, run vitest, enforce typecheck

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39bdfc6..HEAD -- .github/workflows/ci.yml`
> If the file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The `frontend-build` CI job fails on **every push and PR** right now: its
"Verify critical frontend files exist" step requires
`apps/web/components/layout/sidebar.tsx`, but that file was deliberately
deleted when the nav moved into the header (plan 025, commit `1f405e7`).
Separately, the web app has a green vitest suite (136 tests across 19 files)
that CI **never runs** — the job only builds. And the `tsc --noEmit` step runs
with `continue-on-error: true`, so type errors can't fail CI even though the
current baseline is 0 errors. Net effect: CI is simultaneously red for a bogus
reason and blind to real regressions. This plan makes CI green and makes it
actually gate.

## Current state

- `.github/workflows/ci.yml` — the only file this plan touches.

The stale critical-file list (`.github/workflows/ci.yml:132-148`):

```yaml
      - name: Verify critical frontend files exist
        run: |
          for f in \
            package.json \
            app/layout.tsx \
            app/share/\[token\]/page.tsx \
            components/layout/sidebar.tsx \
            components/review/review-provider.tsx \
            components/review/comment-panel.tsx \
            components/share/folder-share-viewer.tsx \
          ; do
            if [ ! -f "$f" ]; then
              echo "::error::Critical file missing: apps/web/$f"
              exit 1
            fi
          done
          echo "All critical frontend files present"
```

Facts verified at planning time: `components/layout/sidebar.tsx` does **not**
exist; `components/layout/header.tsx` (10 KB, now carries the nav) **does**
exist, as do all other listed files.

The typecheck step (`.github/workflows/ci.yml:153-155`):

```yaml
      - name: Type check
        run: pnpm exec tsc --noEmit
        continue-on-error: true
```

There is no test step anywhere in `ci.yml` for the frontend (grep for
`vitest` or `pnpm test` returns nothing). The `lint` job's
"Lint frontend" step (lines 211-214) also has `continue-on-error: true` —
that one stays as-is in this plan (see Out of scope).

Baseline verified at planning time on commit `39bdfc6`:
`pnpm exec tsc --noEmit` → 0 errors; `pnpm test` (vitest) → 136 passed (136).

This critical-file check is a deliberate anti-gutting tripwire (protects
against automated edits deleting core files) — keep the pattern, fix the
entry.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate YAML | `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"` | prints `ok` |
| Web tests (run from `apps/web/`) | `pnpm test` | `136 passed` (or more), exit 0 |
| Web typecheck (run from `apps/web/`) | `pnpm exec tsc --noEmit` | exit 0, no output |

Note: system `python3` on this machine lacks PyYAML — use the ruby one-liner
for YAML validation. You cannot run GitHub Actions locally; verification is
YAML validity + grep anchors + the local test/typecheck baseline.

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`

**Out of scope** (do NOT touch, even though they look related):
- `.github/workflows/release.yml` — release pipeline, independent.
- The `lint` job's `continue-on-error: true` — `next lint` currently exits 0
  with warnings, but leaving the escape hatch is a deliberate choice for now
  (recorded in Maintenance notes).
- The backend-test job — plan 045 modifies it; touching it here creates a
  merge conflict between plans.
- Any file under `apps/web/` — the app itself is correct; only CI is wrong.

## Git workflow

- Branch: `advisor/041-ci-repair`
- Commit style: conventional commits with scope, matching the log (e.g.
  `ci: repair frontend gate — drop deleted sidebar.tsx, run vitest, enforce tsc`)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the deleted file in the critical-file list

In `.github/workflows/ci.yml`, in the "Verify critical frontend files exist"
step, replace the line:

```yaml
            components/layout/sidebar.tsx \
```

with:

```yaml
            components/layout/header.tsx \
```

**Verify**: `grep -n "sidebar.tsx" .github/workflows/ci.yml` → no matches, and
`grep -n "components/layout/header.tsx" .github/workflows/ci.yml` → exactly 1 match.

### Step 2: Add a vitest step to the frontend-build job

In the `frontend-build` job, immediately **after** the "Install dependencies"
step (`run: pnpm install --frozen-lockfile`) and **before** the "Type check"
step, insert:

```yaml
      - name: Test
        run: pnpm test
```

(`pnpm test` maps to `vitest run` per `apps/web/package.json`. The job's
`defaults.run.working-directory` is already `apps/web`, so no `cd` needed.)

**Verify**: `grep -n "pnpm test" .github/workflows/ci.yml` → 1 match inside the
frontend-build job (between the install and typecheck steps).

### Step 3: Enforce the typecheck

Delete the `continue-on-error: true` line from the "Type check" step in the
`frontend-build` job (the step at former lines 153-155). Do NOT delete the
`continue-on-error` in the `lint` job — that one is out of scope.

**Verify**: `grep -c "continue-on-error" .github/workflows/ci.yml` → exactly `1`
(the remaining one in the lint job).

### Step 4: Validate the workflow file and confirm the local baseline is green

**Verify** (all three):
1. `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"` → `ok`
2. `cd apps/web && pnpm test` → exit 0, `136 passed` or more
3. `cd apps/web && pnpm exec tsc --noEmit` → exit 0

## Test plan

No new test files — this plan changes CI configuration only. The verification
is that the local commands CI will now run are green (Step 4), so the first
CI run after this lands goes green instead of red.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "sidebar.tsx" .github/workflows/ci.yml` → no matches
- [ ] `grep -n "components/layout/header.tsx" .github/workflows/ci.yml` → 1 match
- [ ] `grep -n "pnpm test" .github/workflows/ci.yml` → 1 match (frontend-build job)
- [ ] `grep -c "continue-on-error" .github/workflows/ci.yml` → `1`
- [ ] `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"` → `ok`
- [ ] `cd apps/web && pnpm test` → exit 0
- [ ] `cd apps/web && pnpm exec tsc --noEmit` → exit 0
- [ ] `git status` shows only `.github/workflows/ci.yml` (+ `plans/README.md`) modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `components/layout/header.tsx` does not exist (the header rework has been
  reverted or moved — the replacement entry would be wrong).
- `cd apps/web && pnpm test` fails on the **unmodified** tree — the green
  baseline this plan assumes is gone; adding the CI gate would hard-red CI.
- `cd apps/web && pnpm exec tsc --noEmit` reports errors on the unmodified
  tree — same reason; do not enforce a red typecheck.
- The "Verify critical frontend files exist" step is no longer present in
  `ci.yml` (someone restructured CI since planning).

## Maintenance notes

- The critical-file list is a tripwire, not documentation — whenever a listed
  file is renamed/deleted on purpose (as happened with `sidebar.tsx`), the CI
  entry must move in the same commit. Reviewers of shell-rework PRs should
  check this list.
- The `lint` job still has `continue-on-error: true`. `next lint` exits 0 with
  warnings today, so enforcing it is near-free — flip it in a follow-up once
  someone confirms no error-level rules are violated on a fresh clone.
- Plan 045 adds a Postgres service and integration tests to the
  `backend-test` job in this same file. Execute 041 before 045 (both edit
  `ci.yml`; 045's plan assumes 041's version of the file).
