# Plan 009: True all-in-one Docker image (one container: web + api + workers + postgres + redis + minio, GPU-ready)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index. This plan **builds a Docker image**; run the build/run
> verifications in your own worktree (they are disposable).
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat c6eb4db..HEAD -- apps/web/Dockerfile.prod apps/web/next.config.js apps/api/Dockerfile.prod docker-compose.prod.yml apps/api/alembic.ini`
> If any changed, compare the "Current state" facts below against the live files
> before proceeding; on a mismatch, treat it as a STOP condition.
> All files this plan **creates** are new (`Dockerfile.allinone`, `deploy/allinone/*`) — if any
> already exist, STOP and report.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: L (large; mostly Docker/ops glue, little app code)
- **Risk**: MED-HIGH (bundles stateful services in one container; first-boot init is the fragile part)
- **Depends on**: plans/008-hardware-accelerated-transcode.md (the image ships jellyfin-ffmpeg, and
  the transcode code from 008 is what turns that into HW encoding; 008 should land first so the
  image actually benefits — though the image builds regardless)
- **Category**: feature / deployment (DX)
- **Planned at**: commit `c6eb4db`, 2026-06-29

## Why this matters

Deploying FreeFrame today means an 8-service `docker compose` (traefik, postgres, redis, api,
worker, email_worker, beat, web) plus an external/MinIO object store and a hand-written `.env.prod`.
For a homelab / single-box self-hoster that is a lot of moving parts. This plan produces **one image
you launch with a single `docker run`** — everything (Next.js web, FastAPI api, all Celery workers,
Postgres, Redis, MinIO) runs inside under supervisord, with **all state in one `/data` volume** and
an internal nginx fronting it on port 80. Crucially it ships **jellyfin-ffmpeg** (NVENC + Intel QSV
+ VAAPI in one binary), so passing a GPU in (`--gpus all` and/or `--device /dev/dri`) gives hardware
transcode out of the box via Plan 008's `TRANSCODE_HWACCEL=auto`. The multi-container compose stays
as the scalable production option; this image is the "just run it" path.

This is a deliberate trade-off the maintainer chose: bundling the database in the app image
simplifies launch at the cost of harder backups/upgrades/scaling. Keep that boundary in mind — this
image is for single-box deployments, not horizontal scaling.

## Current state

### Web build — Next.js standalone (`apps/web/Dockerfile.prod`, `apps/web/next.config.js`)

`next.config.js` sets `output: 'standalone'`. The prod web image builds with pnpm and runs the
standalone server:

```dockerfile
# builder: pnpm install --frozen-lockfile ; pnpm build  (ARG NEXT_PUBLIC_API_URL=/api)
# runner copies and runs:
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
CMD ["node", "server.js"]     # listens on PORT (default 3000), HOSTNAME=0.0.0.0
```

So the web is `node server.js` from `.next/standalone`, serving on `:3000`. Built with
`NEXT_PUBLIC_API_URL=/api` so the browser calls `/api/...` (an internal proxy strips `/api`).

### API + workers (`apps/api/Dockerfile.prod`, `docker-compose.prod.yml`)

All four backend roles build the **same** image and differ only by command:

- api: `cd /workspace/apps/api && alembic upgrade head && cd /workspace && gunicorn apps.api.main:app -w $API_WORKERS -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000`
- worker: `celery -A apps.api.tasks.celery_app worker -Q transcoding -c $TRANSCODING_CONCURRENCY`
- email_worker: `celery -A apps.api.tasks.celery_app worker -Q email_high,email_low -c $EMAIL_CONCURRENCY`
- beat: `celery -A apps.api.tasks.celery_app beat -s /tmp/celerybeat-schedule`

The api image base installs `ffmpeg imagemagick curl` and `pip install -r apps/api/requirements.txt`
+ `gunicorn`. Migrations are Alembic (`apps/api/alembic.ini`, `apps/api/alembic/`). Health check:
`GET /health` on `:8000` (`apps/api/main.py:85`).

### Routing (prod uses traefik to split `/api` vs `/`)

Traefik strips the `/api` prefix and routes `/api/*` → api:8000, `/*` → web:3000. The all-in-one
must reproduce this with an internal reverse proxy (nginx) on `:80`.

### Object storage

Prod compose has **no MinIO** (expects external S3); dev compose runs MinIO at `:9000` with bucket
init via `mc`. Settings default `s3_storage="minio"`, `s3_endpoint="http://minio:9000"`,
`s3_access_key/secret="minioadmin"`, `s3_bucket="freeframe"` (`apps/api/config.py`). The all-in-one
runs MinIO internally at `127.0.0.1:9000`.

### Conventions

- Deploy/ops files live at the repo root (`docker-compose.*.yml`, `apps/*/Dockerfile*`). Put the new
  artifacts in a dedicated `deploy/allinone/` folder + `Dockerfile.allinone` at root.
- The image must work with **no app-code change** — it reuses `apps/api`, `packages/transcoder`, and
  the built web. Do not modify application code in this plan (transcode HW selection is Plan 008).

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`, in your worktree) | Expected |
|---------|------------------------------------------------------------|----------|
| Build the image | `docker build -f Dockerfile.allinone -t freeframe:allinone .` | exit 0 |
| Run it (CPU-only smoke) | `docker run -d --name ff -p 8080:80 -v ff_data:/data freeframe:allinone` | prints a container id |
| Wait + check services | `sleep 60 && docker exec ff supervisorctl status` | every program `RUNNING` (init may be `EXITED` with status 0) |
| Health via internal proxy | `curl -fsS http://localhost:8080/api/health` | HTTP 200 |
| Web served | `curl -fsS -o /dev/null -w '%{http_code}' http://localhost:8080/` | `200` |
| Cleanup | `docker rm -f ff && docker volume rm ff_data` | removes the smoke container/volume |
| Lint Dockerfile (if hadolint present) | `hadolint Dockerfile.allinone` | no error-level findings (warnings OK) |

If you have **no Docker daemon** available, STOP and report — this plan cannot be verified without
building/running the image. Do not mark it done unverified.

## Scope

**In scope** (create these only):
- `Dockerfile.allinone` (repo root)
- `deploy/allinone/supervisord.conf`
- `deploy/allinone/nginx.conf`
- `deploy/allinone/entrypoint.sh`
- `deploy/allinone/init-app.sh`
- `deploy/allinone/README.md`
- `.dockerignore` — create if absent, or extend to exclude `node_modules`, `.next`, `.git`,
  `**/__pycache__`, `output/`, `plans/` (verify it doesn't already exclude needed source).

**Out of scope** (do NOT touch):
- `apps/**`, `packages/**` application code — the image consumes them as-is.
- `apps/api/Dockerfile*`, `apps/web/Dockerfile*`, `docker-compose.*.yml` — the existing
  multi-container deploy stays. This plan *adds* a single-image option.
- CI/CD publishing of this image — that is Plan 010.

## Git workflow

- Branch: `advisor/009-all-in-one-docker-image`
- Conventional commits (e.g. `feat(deploy): add all-in-one GPU-ready Docker image`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: `Dockerfile.allinone` (multi-stage)

Stage 1 builds the web (mirroring `apps/web/Dockerfile.prod`); stage 2 assembles the runtime.

```dockerfile
# ── Stage 1: build the Next.js standalone web bundle ─────────────────────────
FROM node:20-bookworm AS web-builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ ./
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── Stage 2: runtime — all services in one image ─────────────────────────────
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# Base packages: process mgr, proxy, datastores, python, node runtime, tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg supervisor nginx \
      postgresql postgresql-client redis-server \
      python3 python3-venv python3-pip imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Node 20 runtime (to run the standalone web server.js)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# jellyfin-ffmpeg (NVENC + QSV + VAAPI in one binary). Symlink onto PATH as ffmpeg/ffprobe.
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian bookworm main" > /etc/apt/sources.list.d/jellyfin.list \
    && apt-get update && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 \
    && ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
    && ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe \
    && rm -rf /var/lib/apt/lists/*

# MinIO server + client
RUN curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio \
    && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/minio /usr/local/bin/mc

# Python deps in a venv (Debian bookworm is PEP-668 externally-managed)
ENV VENV=/opt/venv
RUN python3 -m venv $VENV
ENV PATH="$VENV/bin:$PATH"
COPY apps/api/requirements.txt /workspace/apps/api/requirements.txt
RUN $VENV/bin/pip install --no-cache-dir -r /workspace/apps/api/requirements.txt gunicorn

# App code
WORKDIR /workspace
COPY packages/transcoder /workspace/packages/transcoder
COPY apps/api /workspace/apps/api

# Built web bundle
COPY --from=web-builder /app/.next/standalone /app/web
COPY --from=web-builder /app/.next/static /app/web/.next/static
COPY --from=web-builder /app/public /app/web/public

# Service configs
COPY deploy/allinone/supervisord.conf /etc/supervisor/conf.d/freeframe.conf
COPY deploy/allinone/nginx.conf /etc/nginx/sites-available/default
COPY deploy/allinone/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploy/allinone/init-app.sh /usr/local/bin/init-app.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/init-app.sh

# Internal service defaults (override at runtime as needed)
ENV DATABASE_URL=postgresql://freeframe:freeframe@127.0.0.1:5432/freeframe \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    S3_STORAGE=minio \
    S3_ENDPOINT=http://127.0.0.1:9000 \
    S3_ACCESS_KEY=minioadmin \
    S3_SECRET_KEY=minioadmin \
    S3_BUCKET=freeframe \
    S3_REGION=us-east-1 \
    FRONTEND_URL=http://localhost \
    TRANSCODE_HWACCEL=auto \
    API_WORKERS=4 TRANSCODING_CONCURRENCY=2 EMAIL_CONCURRENCY=2 \
    NEXT_PUBLIC_API_URL=/api PORT=3000 HOSTNAME=0.0.0.0 PYTHONPATH=/workspace

VOLUME ["/data"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD curl -fsS http://127.0.0.1/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

**Verify**: `docker build -f Dockerfile.allinone -t freeframe:allinone .` → exit 0.
(If the `jellyfin-ffmpeg7` package name 404s for bookworm, see STOP conditions — do not silently swap
to a different ffmpeg.)

### Step 2: `deploy/allinone/entrypoint.sh`

First-boot init of Postgres into `/data`, secret persistence, then hand off to supervisord.

```bash
#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/postgres /data/minio /data/redis
chown -R postgres:postgres /data/postgres

PGBIN="$(ls -d /usr/lib/postgresql/*/bin | head -n1)"

# First boot: initialise the Postgres cluster and create the app role/db.
if [ ! -s /data/postgres/PG_VERSION ]; then
  echo "[entrypoint] initialising postgres in /data/postgres"
  su postgres -c "$PGBIN/initdb -D /data/postgres --auth=trust --encoding=UTF8"
  su postgres -c "$PGBIN/pg_ctl -D /data/postgres -o '-c listen_addresses=127.0.0.1 -p 5432' -w start"
  su postgres -c "psql -v ON_ERROR_STOP=1 --command \"CREATE ROLE freeframe WITH LOGIN PASSWORD 'freeframe' SUPERUSER;\""
  su postgres -c "createdb -O freeframe freeframe"
  su postgres -c "$PGBIN/pg_ctl -D /data/postgres -m fast -w stop"
fi

# Persist a generated JWT secret across restarts unless one was provided.
if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f /data/secrets.env ]; then
    echo "JWT_SECRET=$(head -c32 /dev/urandom | base64 | tr -d '/+=' )" > /data/secrets.env
  fi
  # shellcheck disable=SC1091
  set -a; . /data/secrets.env; set +a
fi
export JWT_SECRET

echo "[entrypoint] starting supervisord"
exec supervisord -c /etc/supervisor/conf.d/freeframe.conf
```

**Verify**: `bash -n deploy/allinone/entrypoint.sh` → exit 0 (syntax OK).

### Step 3: `deploy/allinone/init-app.sh` (one-shot, run by supervisord)

Waits for Postgres + MinIO, runs migrations, creates the bucket. Idempotent.

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[init] waiting for postgres"
until pg_isready -h 127.0.0.1 -p 5432 -U freeframe >/dev/null 2>&1; do sleep 1; done

echo "[init] running migrations"
cd /workspace/apps/api && /opt/venv/bin/alembic upgrade head

echo "[init] waiting for minio"
until curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do sleep 1; done

echo "[init] ensuring bucket ${S3_BUCKET:-freeframe}"
mc alias set local http://127.0.0.1:9000 "${S3_ACCESS_KEY:-minioadmin}" "${S3_SECRET_KEY:-minioadmin}"
mc mb --ignore-existing "local/${S3_BUCKET:-freeframe}"

echo "[init] done"
```

**Verify**: `bash -n deploy/allinone/init-app.sh` → exit 0.

### Step 4: `deploy/allinone/supervisord.conf`

Datastores first (priority 10), one-shot init (20), app services (30), nginx (40).

```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0
user=root

[program:postgres]
command=su postgres -c "%(ENV_PGBIN)s/postgres -D /data/postgres -c listen_addresses=127.0.0.1 -p 5432"
environment=PGBIN="/usr/lib/postgresql/15/bin"
priority=10
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:redis]
command=redis-server --dir /data/redis --appendonly yes --bind 127.0.0.1
priority=10
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:minio]
command=/usr/local/bin/minio server /data/minio --address 127.0.0.1:9000
priority=10
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:init]
command=/usr/local/bin/init-app.sh
priority=20
autorestart=false
startsecs=0
exitcodes=0
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=/opt/venv/bin/gunicorn apps.api.main:app -w %(ENV_API_WORKERS)s -k uvicorn.workers.UvicornWorker --bind 127.0.0.1:8000 --timeout 120 --graceful-timeout 30
directory=/workspace
priority=30
startretries=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:worker]
command=/opt/venv/bin/celery -A apps.api.tasks.celery_app worker -Q transcoding -c %(ENV_TRANSCODING_CONCURRENCY)s --loglevel=warning
directory=/workspace
priority=30
startretries=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:email_worker]
command=/opt/venv/bin/celery -A apps.api.tasks.celery_app worker -Q email_high,email_low -c %(ENV_EMAIL_CONCURRENCY)s --loglevel=warning
directory=/workspace
priority=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:beat]
command=/opt/venv/bin/celery -A apps.api.tasks.celery_app beat --loglevel=warning -s /tmp/celerybeat-schedule
directory=/workspace
priority=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:web]
command=node /app/web/server.js
directory=/app/web
environment=PORT="3000",HOSTNAME="0.0.0.0",NODE_ENV="production"
priority=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:nginx]
command=nginx -g "daemon off;"
priority=40
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

Note: `api`/`worker` use `startretries=30` so they keep retrying while `init` runs the first
migration — they go green once the DB schema exists. `%(ENV_PGBIN)s` resolves the Postgres bin dir;
if the installed Postgres major version is not 15, fix the `environment=PGBIN=...` path and the
entrypoint's `PGBIN` glob (Step 2 derives it dynamically; keep them consistent).

**Verify**: `python3 -c "import configparser; configparser.ConfigParser().read('deploy/allinone/supervisord.conf')"` → exit 0 (valid INI).

### Step 5: `deploy/allinone/nginx.conf`

Front web on `/`, api on `/api/` (strip prefix), with SSE-friendly buffering off for the API.

```nginx
server {
    listen 80 default_server;
    client_max_body_size 0;          # allow large uploads to pass through

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;   # trailing slash strips the /api prefix
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;                 # required for SSE (/api/events)
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Verify**: covered by the container smoke (Step 7) — nginx validates its config at startup; a syntax
error makes the `nginx` program fail and the smoke's health check fails.

### Step 6: `deploy/allinone/README.md` + `.dockerignore`

`README.md` must document:
- **Build**: `docker build -f Dockerfile.allinone -t freeframe:allinone .`
- **Run (CPU)**: `docker run -d -p 80:80 -v ff_data:/data freeframe:allinone`
- **Run (NVIDIA GPU)**: add `--gpus all` (requires the NVIDIA Container Toolkit on the host).
- **Run (Intel/AMD GPU)**: add `--device /dev/dri:/dev/dri`.
- **Env worth overriding**: `JWT_SECRET` (else one is generated and persisted to `/data/secrets.env`),
  `FRONTEND_URL` (set to the public origin so share links are correct), `TRANSCODE_HWACCEL`
  (`auto` by default), `API_WORKERS`/`TRANSCODING_CONCURRENCY`.
- **Data**: everything (Postgres, MinIO objects, Redis AOF) lives in the `/data` volume — back that
  up. **Caveat**: this image bundles the database; it is for single-box use, not horizontal scaling.
- **Verify GPU**: `docker exec <c> /usr/local/bin/ffmpeg -hide_banner -encoders | grep h264` should
  list `h264_nvenc`/`h264_qsv`/`h264_vaapi`.

`.dockerignore` (create if absent): ensure `node_modules`, `**/node_modules`, `.next`, `.git`,
`**/__pycache__`, `output/`, `.omo/`, `.playwright-cli/` are excluded so the build context is small
and host build artifacts don't leak in. Do NOT exclude `apps/`, `packages/`, or `deploy/`.

**Verify**: `test -f deploy/allinone/README.md && grep -q "gpus all" deploy/allinone/README.md` → exit 0.

### Step 7: Build + run smoke (CPU-only — proves the image, GPU not required in CI)

```
docker build -f Dockerfile.allinone -t freeframe:allinone .
docker run -d --name ff -p 8080:80 -v ff_smoke:/data freeframe:allinone
sleep 75
docker exec ff supervisorctl status
curl -fsS http://localhost:8080/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/
docker rm -f ff && docker volume rm ff_smoke
```

**Verify**:
- `supervisorctl status` shows `postgres`, `redis`, `minio`, `api`, `worker`, `web`, `nginx` as
  `RUNNING` and `init` as `EXITED` (status 0).
- `curl …/api/health` → HTTP 200.
- `curl …/` → `200`.

## Test plan

There is no unit-test harness for container images; verification is the **build + run smoke** (Step
7), which is the gate. Additionally, record (don't block on without hardware):
- **GPU smoke**: `docker run --gpus all …`, then
  `docker exec ff sh -c "ffmpeg -hide_banner -encoders | grep h264_nvenc"` returns a line; upload a
  video and confirm the worker log doesn't show the software fallback.
- **Persistence**: stop + start the container with the same `/data` volume → data survives and
  migrations are not re-applied destructively (`alembic upgrade head` is a no-op on an up-to-date DB).

## Done criteria

ALL must hold:

- [ ] `docker build -f Dockerfile.allinone -t freeframe:allinone .` exits 0
- [ ] Step 7 smoke passes: all services `RUNNING`, `init` exited 0, `/api/health` is 200, `/` is 200
- [ ] `docker exec ff sh -c "ffmpeg -hide_banner -encoders | grep -E 'h264_nvenc|h264_qsv|h264_vaapi'"` lists at least the three HW encoders (proves jellyfin-ffmpeg is installed; encoders are *present* even without a GPU)
- [ ] `bash -n deploy/allinone/entrypoint.sh && bash -n deploy/allinone/init-app.sh` exit 0
- [ ] Only new files created: `Dockerfile.allinone`, `deploy/allinone/*`, and `.dockerignore` (created/extended). No `apps/**` or `packages/**` changes (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `jellyfin-ffmpeg7` apt package (or the Jellyfin repo for `bookworm`) is unavailable/renamed at
  build time. Report the exact apt error. Do NOT silently substitute stock `ffmpeg` (that drops QSV)
  or a random third-party build — the maintainer chose jellyfin-ffmpeg for full HW coverage.
- The installed Postgres major version is not 15 — adjust the `PGBIN` path in `supervisord.conf`
  (`environment=PGBIN=...`) to match (the entrypoint already derives it dynamically); report it.
- `apps/web/next.config.js` no longer sets `output: 'standalone'` (the web run command would change).
- The smoke's `api` program never reaches `RUNNING` (check `docker logs ff` / `docker exec ff cat`
  the api stderr): likely the DB/migration init ordering. Report the log; do not paper over it by
  removing the init step.
- You have no Docker daemon to build/run with — report that this plan needs a builder.

## Maintenance notes

- **Stateful-in-app trade-off**: Postgres/MinIO live inside the container with data in `/data`. This
  is intentional for single-box use. For scaling, the existing `docker-compose.prod.yml` (external/
  separate services) remains the right tool — keep both.
- **First-boot ordering** is the fragile part: `api`/`worker` rely on `startretries` to survive until
  `init` finishes `alembic upgrade head`. If you raise worker counts or add a service that needs the
  DB at import time, make sure it tolerates the brief pre-migration window.
- **jellyfin-ffmpeg path**: encoders are symlinked to `/usr/local/bin/ffmpeg|ffprobe` so Plan 008's
  `subprocess.run(["ffmpeg", ...])` finds them. If a future jellyfin-ffmpeg changes its install path,
  update the two `ln -sf` lines.
- **GPU runtime**: NVENC needs the host's NVIDIA Container Toolkit + `--gpus all`; QSV/VAAPI need
  `--device /dev/dri`. None are baked into the image — they're runtime flags (documented in the
  README). The image works CPU-only with no flags (software transcode via Plan 008's fallback).
- **Secrets**: a random `JWT_SECRET` is generated to `/data/secrets.env` on first boot if unset.
  Production deployers should pass their own `JWT_SECRET` and `FRONTEND_URL`. The README says so.
- Reviewer should scrutinise: no real secret is baked into the image (defaults are the well-known
  dev `minioadmin`; JWT is generated at runtime), `/data` is the single source of state, and the
  build context excludes host `node_modules`/`.next` via `.dockerignore`.
