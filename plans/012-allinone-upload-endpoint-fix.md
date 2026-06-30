# Plan 012: Fix browser uploads in the all-in-one image (MinIO reachable + correct presigned/CORS origin)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index. This plan **rebuilds and runs the Docker image**; do it
> in your own disposable worktree.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- Dockerfile.allinone deploy/allinone/supervisord.conf deploy/allinone/README.md deploy/allinone/nginx.conf apps/api/services/s3_service.py apps/api/config.py`
> If any changed since this plan was written, compare the "Current state"
> excerpts below against the live files before editing; on a mismatch, treat it
> as a STOP condition.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1 (the single-box image's upload path is broken — a headline feature does not work)
- **Effort**: S–M (image config + docs; no app code)
- **Risk**: LOW-MED (changes a service bind address + adds a published port; verified by the existing
  image smoke plus a new upload-path check)
- **Depends on**: plans/009-all-in-one-docker-image.md (this edits that image's own files). 009 is DONE.
- **Category**: bug / deployment
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

Uploads in the **all-in-one image (Plan 009)** fail in the browser with `Failed to fetch`. Confirmed
root cause (two defects):

1. **MinIO is unreachable from the browser.** FreeFrame uploads are **presigned multipart PUTs sent
   directly from the browser to the S3/MinIO endpoint** (`apps/api/services/s3_service.py`
   `_get_presign_client` / `create_multipart_upload`). The all-in-one runs MinIO bound to
   `127.0.0.1:9000` (loopback **inside** the container) and only publishes port 80. So even with
   `-p 9000:9000`, Docker forwards the host port to the container's external interface, which MinIO is
   **not** listening on → connection reset. The browser can never reach the object store.
2. **The presigned/CORS origin is wrong.** `_get_presign_client` falls back to `s3_endpoint`
   (`http://127.0.0.1:9000`) when `s3_public_endpoint` is unset, so presigned URLs point at an
   internal address. And the bucket CORS allow-list is built from `frontend_url`
   (`s3_service.py` ~line 108: `AllowedOrigins: [settings.frontend_url, "http://localhost:3000"]`),
   which the image defaults to `http://localhost` — fine only if the browser origin is exactly
   `http://localhost` (port 80).

The application **already has the lever**: `s3_public_endpoint` (config.py) exists precisely so
presigned URLs use a browser-reachable host, and CORS already derives from `frontend_url`. This plan
makes the image **bind MinIO on all interfaces, publish + expose 9000, default
`S3_PUBLIC_ENDPOINT=http://localhost:9000`, and document the `FRONTEND_URL` / `S3_PUBLIC_ENDPOINT`
overrides for non-localhost hosts.** No application code changes — the fix is entirely in the image's
own config + docs. (This was proven live: rebinding MinIO to `0.0.0.0:9000`, publishing 9000, and
setting `S3_PUBLIC_ENDPOINT=http://localhost:9000` + `FRONTEND_URL=http://localhost:8080` made the
CORS preflight return `204` with `Access-Control-Allow-Origin: http://localhost:8080` and uploads work.)

**This same root cause also breaks guest video playback.** HLS playback is served via the
`/stream/hls` proxy (`apps/api/routers/hls_proxy.py`): the API rewrites the `.m3u8` manifest so each
`.ts` **segment becomes a presigned S3 URL** (`hls_proxy.py:78`, the same `generate_presigned_get_url`
the upload path uses). With `S3_PUBLIC_ENDPOINT` unset / MinIO on loopback, the browser fetches the
manifest through `/api` (reachable) but every segment URL points at `http://127.0.0.1:9000/…`
(unreachable) → the video never plays for a guest reviewer. Fixing the endpoint + reachability here
fixes **both** uploads and HLS playback in one change; Step 4 adds a stream-path check.

## Current state

### MinIO binds loopback only — `deploy/allinone/supervisord.conf` (line ~37)

```ini
[program:minio]
command=/usr/local/bin/minio server /data/minio --address 127.0.0.1:9000
priority=10
autorestart=true
```

### Image env + ports — `Dockerfile.allinone` (lines ~65–85)

```dockerfile
ENV DATABASE_URL=postgresql://freeframe:freeframe@127.0.0.1:5432/freeframe \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    S3_STORAGE=minio \
    S3_ENDPOINT=http://127.0.0.1:9000 \
    S3_ACCESS_KEY=minioadmin \
    S3_SECRET_KEY=minioadmin \
    S3_BUCKET=freeframe \
    S3_REGION=us-east-1 \
    FRONTEND_URL=http://localhost \
    DISABLE_DOCS=true \
    TRANSCODE_HWACCEL=auto \
    API_WORKERS=4 \
    TRANSCODING_CONCURRENCY=2 \
    EMAIL_CONCURRENCY=2 \
    NEXT_PUBLIC_API_URL=/api \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PYTHONPATH=/workspace

VOLUME ["/data"]
EXPOSE 80
```

There is **no `S3_PUBLIC_ENDPOINT`** and only port 80 is exposed.

### The lever already exists — `apps/api/config.py` (lines ~36–38) and `apps/api/services/s3_service.py`

**Read-only — do NOT edit these.** They already do the right thing when configured:

```python
# config.py
s3_public_endpoint: str | None = (
    None  # External URL for presigned URLs (e.g. http://localhost:9000 when S3_ENDPOINT is http://minio:9000)
)
```

```python
# s3_service.py  _get_presign_client()
endpoint = settings.s3_public_endpoint or (None if _is_aws_s3() else settings.s3_endpoint)
```

```python
# s3_service.py  ensure_bucket_exists() — CORS set at API startup (main.py:33 calls it)
"AllowedOrigins": [settings.frontend_url, "http://localhost:3000"],
```

So: set `S3_PUBLIC_ENDPOINT` to a browser-reachable URL and the presigned PUT targets it; set
`FRONTEND_URL` to the exact browser origin and CORS allows it. Both are pure configuration.

### Why the default works for the documented localhost run

The README's run command is `-p 80:80` (browser origin `http://localhost`, no port). The image already
defaults `FRONTEND_URL=http://localhost`, which then **matches** that origin in the CORS list. Adding
`-p 9000:9000` + default `S3_PUBLIC_ENDPOINT=http://localhost:9000` (with MinIO on `0.0.0.0`) makes the
presigned PUT reach MinIO at `http://localhost:9000`. So the out-of-the-box localhost experience works
with no overrides. Non-localhost hosts override both vars (documented in Step 3).

### Conventions

- These are the **009 image's own files** (`Dockerfile.allinone`, `deploy/allinone/*`). Editing them is
  in scope. **Application code (`apps/api/**`, `apps/web/**`) is out of scope** — the fix is config only.
- Keep the existing single-`docker run` ergonomics; this adds **one published port**, not a new service.

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`, in your worktree) | Expected |
|---------|------------------------------------------------------------|----------|
| Build image | `docker build -f Dockerfile.allinone -t freeframe:allinone .` | exit 0 |
| Run with both ports | `docker run -d --name ff -p 8080:80 -p 9000:9000 -e FRONTEND_URL=http://localhost:8080 -e S3_PUBLIC_ENDPOINT=http://localhost:9000 -v ff_smoke:/data freeframe:allinone` | container id |
| Wait + services | `sleep 75 && docker exec ff supervisorctl status` | all `RUNNING`, `init` EXITED(0) |
| API health | `curl -fsS http://localhost:8080/api/health` | `{"status":"ok"}` |
| **MinIO reachable from host** | `curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:9000/minio/health/live` | `200` |
| **Upload CORS preflight** | see Step 4 | `204` + `Access-Control-Allow-Origin: http://localhost:8080` |
| Cleanup | `docker rm -f ff && docker volume rm ff_smoke` | removed |

If you have **no Docker daemon**, STOP and report — the upload fix cannot be verified without
building/running the image.

## Scope

**In scope**:
- `deploy/allinone/supervisord.conf` — bind MinIO on `0.0.0.0:9000`.
- `Dockerfile.allinone` — add `S3_PUBLIC_ENDPOINT=http://localhost:9000` to the `ENV` block; change
  `EXPOSE 80` → `EXPOSE 80 9000`.
- `deploy/allinone/README.md` — publish `-p 9000:9000` in the run commands; add an "Uploads & object
  storage" section explaining the `S3_PUBLIC_ENDPOINT` + `FRONTEND_URL` overrides for non-localhost
  hosts and how bucket CORS derives from `FRONTEND_URL`.

**Out of scope** (do NOT touch):
- `apps/api/**`, `apps/web/**` — no application code change. In particular do **not** edit
  `s3_service.py` CORS or the upload routers; the fix is configuration.
- `deploy/allinone/nginx.conf` — do **not** add an `/s3` proxy (see STOP conditions / Maintenance:
  proxying presigned S3 through nginx breaks SigV4 signatures; that single-port approach is a separate,
  deliberate design and is rejected for this plan).
- `docker-compose.*.yml` and the api/web Dockerfiles — the multi-container deploy is unaffected.

## Git workflow

- Branch: `advisor/012-allinone-upload-endpoint-fix`
- Conventional commit (e.g. `fix(deploy): make all-in-one MinIO reachable for browser uploads`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Bind MinIO on all interfaces

In `deploy/allinone/supervisord.conf`, change the `[program:minio]` command (line ~37) from:

```ini
command=/usr/local/bin/minio server /data/minio --address 127.0.0.1:9000
```

to:

```ini
command=/usr/local/bin/minio server /data/minio --address 0.0.0.0:9000
```

`0.0.0.0` still includes loopback, so the api/worker/init that talk to `127.0.0.1:9000` keep working;
it additionally lets the published port reach MinIO.

**Verify**: `grep -n "address 0.0.0.0:9000" deploy/allinone/supervisord.conf` → one match; and
`grep -n "address 127.0.0.1:9000" deploy/allinone/supervisord.conf` → **no** match.

### Step 2: Default the public presigned endpoint + expose 9000

In `Dockerfile.allinone`, add `S3_PUBLIC_ENDPOINT` to the `ENV` block. Put it right after the
`S3_ENDPOINT=...` line (line ~68):

```dockerfile
    S3_ENDPOINT=http://127.0.0.1:9000 \
    S3_PUBLIC_ENDPOINT=http://localhost:9000 \
```

And change `EXPOSE 80` (line ~85) to:

```dockerfile
EXPOSE 80 9000
```

**Verify**:
- `grep -n "S3_PUBLIC_ENDPOINT=http://localhost:9000" Dockerfile.allinone` → one match
- `grep -n "EXPOSE 80 9000" Dockerfile.allinone` → one match

### Step 3: Document the new port + the override rules

In `deploy/allinone/README.md`:

(a) Add `-p 9000:9000` to **every** `docker run` example in the "Run" and "Environment" sections, e.g.:

```bash
docker run -d --name freeframe -p 80:80 -p 9000:9000 -v ff_data:/data freeframe:allinone
```

(b) Add a new section (place it after "Run", before "Data And Backups"):

```markdown
## Uploads & Object Storage

Uploads go **directly from the browser to the bundled MinIO object store**, so MinIO must be reachable
from the browser. Publish its port and tell the app the browser-facing URL:

- Always run with `-p 9000:9000` (in addition to the app port). MinIO listens on `0.0.0.0:9000` inside
  the container.
- `S3_PUBLIC_ENDPOINT` is the URL the **browser** uses for presigned uploads/downloads. It defaults to
  `http://localhost:9000`, which is correct for local testing. **On a remote host you MUST override it**
  to the public MinIO URL, e.g. `-e S3_PUBLIC_ENDPOINT=https://media.example.com:9000`.
- Bucket CORS is derived from `FRONTEND_URL`. The browser's page origin must equal `FRONTEND_URL`
  exactly (scheme + host + port). For local testing on a non-default port use, e.g.,
  `-e FRONTEND_URL=http://localhost:8080`. If uploads fail with `Failed to fetch`, a `FRONTEND_URL`
  that does not match the page origin (or an unpublished `9000`) is the usual cause.

Remote-host example:

​```bash
docker run -d --name freeframe \
  -p 80:80 -p 9000:9000 \
  -e FRONTEND_URL='https://review.example.com' \
  -e S3_PUBLIC_ENDPOINT='https://review.example.com:9000' \
  -v ff_data:/data \
  freeframe:allinone
​```
```

(Remove the zero-width spaces / use normal backticks when you write the file — they are only here to
keep this plan's code fence intact.)

**Verify**:
- `grep -n "S3_PUBLIC_ENDPOINT" deploy/allinone/README.md` → ≥ 1 match
- `grep -n "9000:9000" deploy/allinone/README.md` → ≥ 1 match
- `grep -niE "Uploads.*Object Storage|Object Storage" deploy/allinone/README.md` → match

### Step 4: Rebuild, run, and verify the upload path end-to-end

```bash
docker build -f Dockerfile.allinone -t freeframe:allinone .
docker run -d --name ff -p 8080:80 -p 9000:9000 \
  -e FRONTEND_URL=http://localhost:8080 \
  -e S3_PUBLIC_ENDPOINT=http://localhost:9000 \
  -v ff_smoke:/data freeframe:allinone
sleep 75
docker exec ff supervisorctl status
curl -fsS http://localhost:8080/api/health; echo
curl -fsS -o /dev/null -w 'minio: %{http_code}\n' http://localhost:9000/minio/health/live
# CORS preflight that the browser upload performs:
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  "http://localhost:9000/freeframe/preflight-probe" | grep -iE "HTTP/|access-control-allow-origin"
docker rm -f ff && docker volume rm ff_smoke
```

**Verify**:
- `supervisorctl status` → all services `RUNNING`, `init` EXITED(0).
- `/api/health` → `{"status":"ok"}`.
- MinIO health → `200` (**this is the fix** — previously connection-reset).
- CORS preflight → `HTTP/1.1 204` and `Access-Control-Allow-Origin: http://localhost:8080`
  (**this proves the browser PUT will be accepted**).

> Note: the CORS rule is applied by the API at startup (`ensure_bucket_exists`, `main.py:33`) using
> `FRONTEND_URL`. Because the smoke runs with `FRONTEND_URL=http://localhost:8080`, the allow-origin is
> `http://localhost:8080`. With the README's default `-p 80:80` run (origin `http://localhost`), the
> image's default `FRONTEND_URL=http://localhost` matches with no override.

## Test plan

- **Automated gate**: the Step 1–3 greps + the Step 4 build/run smoke (services up, MinIO host health
  `200`, CORS preflight `204` with the right allow-origin). This is the machine-checkable proof the
  upload path is reachable; it supersedes Plan 009's smoke, which only checked the app port.
- **Manual (do if you can; record results)**: with the Step-4 container running, open
  `http://localhost:8080`, sign in / complete setup, and upload a small video. Expect the upload to
  complete (no `Failed to fetch`) and the asset to begin processing. Under amd64-on-arm64 emulation the
  transcode is slow — uploading + the asset appearing is sufficient proof.
- **Manual (guest playback — proves #1)**: once a video asset is `ready`, open its reviewer share link
  (`…/share/{token}`) in a fresh browser and confirm the **video plays**. Then sanity-check the
  segment URLs are browser-reachable: in DevTools Network, the `.ts` requests should hit
  `localhost:9000` (or your `S3_PUBLIC_ENDPOINT` host) and return `200`. Before this fix they target
  `127.0.0.1:9000` and fail.

## Done criteria

ALL must hold:

- [ ] `grep -n "address 0.0.0.0:9000" deploy/allinone/supervisord.conf` → match; `grep -n "127.0.0.1:9000" deploy/allinone/supervisord.conf` → no match
- [ ] `grep -n "S3_PUBLIC_ENDPOINT=http://localhost:9000" Dockerfile.allinone` → match
- [ ] `grep -n "EXPOSE 80 9000" Dockerfile.allinone` → match
- [ ] `grep -n "9000:9000" deploy/allinone/README.md` → match and README has an "Uploads & Object Storage" section
- [ ] `docker build -f Dockerfile.allinone -t freeframe:allinone .` exits 0
- [ ] Step-4 smoke: all services RUNNING, `/api/health` 200, **`http://localhost:9000/minio/health/live` → 200**, CORS preflight → 204 with `Access-Control-Allow-Origin: http://localhost:8080`
- [ ] No `apps/**` files changed (`git -C /Users/neyako/freeframed status --porcelain` shows only `Dockerfile.allinone`, `deploy/allinone/supervisord.conf`, `deploy/allinone/README.md`)
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- After Step 1+2, `http://localhost:9000/minio/health/live` is still not `200` from the host — capture
  `docker logs ff` and the MinIO program log; do not paper over it by adding an nginx proxy.
- The CORS preflight returns no `Access-Control-Allow-Origin` even with `FRONTEND_URL` matching the
  Origin — the bucket CORS may not have been applied; check the api startup log for `ensure_bucket_exists`
  errors. Do **not** edit `s3_service.py` to "force" CORS — report instead.
- `apps/api/services/s3_service.py` no longer derives presigned endpoint from `s3_public_endpoint` or
  no longer sets CORS from `frontend_url` (the lever this plan relies on changed) — STOP; the fix
  approach needs rethinking.
- You are tempted to make uploads work through a single port by proxying MinIO under nginx (`/s3/…`):
  **do not** in this plan. SigV4 signs the host + full path; stripping an `/s3` prefix or changing the
  Host breaks the signature (MinIO has no S3-API path-prefix support). That single-port design is a
  separate, deliberate effort — report it as a candidate follow-up, don't improvise it here.
- No Docker daemon to build/run with — report that this plan needs a builder.

## Maintenance notes

- **Two-port trade-off**: this keeps presigned-direct-to-MinIO (fast, streams large files, no API
  proxying) at the cost of a second published port (9000) and a per-host `S3_PUBLIC_ENDPOINT`/
  `FRONTEND_URL`. That mirrors how `docker-compose.dev.yml` already exposes MinIO on 9000. The
  alternative single-port designs were considered and rejected for now:
  - *nginx `/s3` reverse proxy* — breaks SigV4 (host/path signing); MinIO has no S3 path-prefix mode.
  - *Proxy uploads through the FastAPI app* — would re-architect the upload flow (presigned multipart)
    and stream every byte through gunicorn; a large app-code change, out of scope.
- **Footgun to watch**: a remote deployer who sets `FRONTEND_URL` but forgets `S3_PUBLIC_ENDPOINT` (or
  forgets `-p 9000:9000`) gets `Failed to fetch` on upload while everything else works. The README
  section added in Step 3 is the mitigation; a future hardening is to have `entrypoint.sh` derive
  `S3_PUBLIC_ENDPOINT` from `FRONTEND_URL`'s host (`:9000`) when unset — deliberately left out here to
  keep the change to config + docs only.
- **TLS**: on a host serving the app over HTTPS, `S3_PUBLIC_ENDPOINT` must also be HTTPS (browsers block
  mixed content). That means terminating TLS in front of MinIO too (or a TLS-capable MinIO). Note in the
  README if a deployer reports mixed-content upload failures.
- Reviewer should scrutinise: no application code changed; no real secret added (defaults remain the
  well-known dev `minioadmin`); the multi-container compose is untouched; and the smoke actually
  exercises the **browser-reachable** MinIO + CORS, not just the app port.
