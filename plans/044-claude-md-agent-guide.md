# Plan 044: Author a root CLAUDE.md agent guide

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `ls CLAUDE.md AGENTS.md 2>/dev/null`
> If either file already exists at the repo root, STOP — someone wrote one
> since this plan; reconcile instead of overwriting.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but if plan 041 has landed, CI enforces tsc + vitest — reflect that; the template below already assumes 041)
- **Category**: dx
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

This repository is developed almost entirely by AI executor agents working
from `plans/` — 40+ plans executed to date — yet there is no root `CLAUDE.md`.
Every session re-derives the same facts (which package manager, how to run
tests, that the API tests use a mocked DB, that soft delete is a hard
convention, where the plans workflow lives) and periodically gets them wrong
(e.g. running `npm install`, which creates the lockfile drift plan 043 cleans
up). A ~90-line guide read automatically at session start eliminates that
re-derivation and encodes the tripwires.

## Current state

- No `CLAUDE.md` or `AGENTS.md` at the repo root (verified at planning time).
- Facts the guide must encode were all verified during the 2026-07-02 audit
  and are restated inline in the template in Step 1 — the executor does not
  need to re-verify them, only keep the template faithful.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm commands in the guide are real | `cd apps/web && pnpm test` | exit 0, 136+ passed |
| Confirm typecheck command | `cd apps/web && pnpm exec tsc --noEmit` | exit 0 |

## Scope

**In scope** (the only file you create):
- `CLAUDE.md` (repo root)

**Out of scope**:
- `docs/**` — human-facing docs; plan 043 fixes their staleness.
- `.claude/` directory or settings — no harness config changes.
- Per-app CLAUDE.md files — one root file is enough at this repo size.

## Git workflow

- Branch: `advisor/044-claude-md`
- Commit style: `docs: add root CLAUDE.md agent guide`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write CLAUDE.md

Create `CLAUDE.md` at the repo root with exactly this content (you may fix
typos or adjust formatting, but keep every factual claim):

```markdown
# CLAUDE.md — FreeFrame

Self-hosted media review platform (Frame.io alternative). Monorepo:

- `apps/api` — FastAPI + SQLAlchemy 2 + Pydantic v2. Postgres, Redis,
  S3/MinIO (presigned multipart uploads), Celery workers (transcode via
  ffmpeg → HLS, email). Routers in `routers/`, business logic in `services/`,
  Celery in `tasks/`, ORM in `models/`, Pydantic in `schemas/`.
- `apps/web` — Next.js 14 App Router + React 18 + Tailwind. Zustand for
  client state, SWR for server state, hls.js for video. Components in
  `components/`, API client in `lib/api.ts`, stores in `stores/`.
- `packages/transcoder` — Python ffmpeg pipeline (HLS ladder, thumbnails,
  waveforms, hwaccel selection in `hwaccel.py`).
- `tools/resolve` — stdlib-only DaVinci Resolve scripts (no pip installs —
  they run inside Resolve's bundled interpreter).
- `deploy/` + `Dockerfile.allinone` — single-container deployment
  (supervisord + bundled Postgres/Redis/MinIO). Deliberate tradeoff.

## Package manager: pnpm ONLY

Never run `npm install` — it creates a divergent `package-lock.json`
(gitignored for this reason). CI uses pnpm 10 + Node 20.

## Verification commands

Web (run in `apps/web/`):

- `pnpm test` — vitest, must stay green (CI-gated)
- `pnpm exec tsc --noEmit` — must be 0 errors (CI-gated)
- `pnpm lint` — warnings exist; don't add errors
- `pnpm build` — production build (CI-gated)

API:

- `python -m pytest apps/api/tests/ -v` — needs
  `pip install -r apps/api/requirements.txt` (Python 3.12 in CI). No venv on
  the maintainer's machine — CI is the gate; use
  `python3 -m py_compile <files>` for a local syntax check.
- **The API test suite mocks the DB session** (`tests/conftest.py`,
  MagicMock). It exercises routing/validation/authz wiring, NOT SQL. Don't
  trust it to catch query bugs; integration tests (real Postgres) live in
  `apps/api/tests/integration/` if present.

Full stack: `docker compose -f docker-compose.dev.yml up --build`
(web :3000, api :8000, MinIO console :9001, Postgres :5433).

## Hard conventions

- **Soft delete everywhere**: every entity query must filter
  `deleted_at IS NULL`. Forgetting the filter is a bug, not a style issue.
- **Timezone-aware datetimes**: columns are `DateTime(timezone=True)`;
  compare against `datetime.now(timezone.utc)`, never naive `utcnow()`.
- Alembic migrations are append-only — never edit an applied migration; new
  migration files chain onto the current head (check with
  `grep -rn "down_revision" apps/api/alembic/versions/`).
- Commits: conventional style with scope — `fix(web): …`, `feat(share): …`,
  `docs(plans): …`, `chore: …` (see `git log --oneline`).
- Branches for plan work: `advisor/NNN-slug`. Executors never push or merge —
  the maintainer merges.
- CI has anti-gutting tripwires (critical-file existence checks, minimum test
  counts) in `.github/workflows/ci.yml`. If you intentionally delete/rename a
  listed file, update the tripwire in the same commit.

## Plans workflow

`plans/README.md` is the index of audit findings and implementation plans
(improve-skill lane). Before starting work: read your plan file fully, honor
its STOP conditions, and update your status row when done. Plans 034–040 are
a pending visual retheme (monochrome design system) — don't restyle
components ad hoc; that territory is claimed.

## Gotchas

- Share links: guest access flows through `routers/share.py` +
  `validate_share_link_with_session`; every new share sub-endpoint must call
  `validate_asset_in_share` and respect `link.permission` /
  `link.show_versions` / `link.allow_download`.
- HLS playback in the app goes through `/stream/hls/*` proxy with a JWT
  (`routers/hls_proxy.py`), not raw S3 URLs; the web player is
  `hooks/use-video-player.ts` (hls.js) — reuse it, don't add `<video src>`.
- `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` in the web app.
- Uploads: browser → presigned S3 multipart → `/upload/complete` → Celery
  `process_asset`. The upload UI state machine lives in
  `stores/upload-store.ts`.
```

**Verify**: `test -f CLAUDE.md && wc -l CLAUDE.md` → file exists, roughly
80–110 lines.

### Step 2: Confirm the factual anchors still hold

Run these greps; every one must match, proving the guide points at real code:

```bash
grep -n "deleted_at" apps/api/services/permissions.py | head -1
grep -n "use-video-player" apps/web/components/share/share-video-player.tsx
grep -n "validate_asset_in_share" apps/api/routers/share.py | head -1
grep -n "pnpm" .github/workflows/ci.yml | head -1
test -f stores/upload-store.ts || test -f apps/web/stores/upload-store.ts && echo ok
```

**Verify**: all greps return a match / `ok`.

## Test plan

Not applicable (documentation file). The verification is Step 2's anchor
greps plus the command table's live runs.

## Done criteria

- [ ] `CLAUDE.md` exists at repo root with all sections from the template
- [ ] Step 2 anchor greps all match
- [ ] `cd apps/web && pnpm test` exits 0 (commands in the guide are honest)
- [ ] `git status` shows only `CLAUDE.md` (+ `plans/README.md`) added/modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `CLAUDE.md` or `AGENTS.md` already exists (drift check).
- Any Step 2 anchor grep fails — a factual claim in the template is stale;
  report which one rather than shipping a wrong guide.
- Plan 041 turned out NOT to be landed AND you are told CI gates differ —
  then soften the two "(CI-gated)" annotations to "(should be CI-gated —
  see plan 041)" instead of stating something false.

## Maintenance notes

- This file goes stale the same way `docs/architecture.md` did — whenever a
  verification command, convention, or the plans workflow changes, update
  CLAUDE.md in the same PR. Reviewers of infra PRs should ask "does CLAUDE.md
  still tell the truth?"
- Deliberately kept to one root file; add `apps/api/CLAUDE.md` /
  `apps/web/CLAUDE.md` only if the root file outgrows ~150 lines.
