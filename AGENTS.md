# AGENTS.md — FreeFrame

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
