# Plan 063: Fix first-deploy `/setup` redirect (middleware server-side API URL)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report — do not improvise.
> A reviewer maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- apps/web/middleware.ts Dockerfile.allinone`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1 (broken first-run onboarding on the primary deployment target)
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / deployment
- **Planned at**: commit `a7d1e10`, 2026-07-04

## Why this matters

On a fresh all-in-one deployment (no superadmin yet), the app should send the
user to `/setup` to create the first account. It doesn't — the user lands on
`/login` (or a dead end) instead.

Root cause: `apps/web/middleware.ts` decides this by calling
`fetch(`${API_URL}/setup/status`)` where `API_URL = NEXT_PUBLIC_API_URL || 'http://localhost:8000'`.
In the all-in-one image the web bundle is built with `NEXT_PUBLIC_API_URL=/api`
(a **relative** path, correct for the browser, which reaches the API through
nginx). But **middleware runs server-side** in the Next.js node process, where
`fetch('/api/setup/status')` has no origin to resolve against and throws. The
`try/catch` swallows the error and falls through, so the `/setup` redirect never
fires. The fix is to give middleware an **absolute, server-reachable** API URL.

## Current state

`apps/web/middleware.ts` (lines 7 and 15–44):

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
...
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }
  const setupDone = request.cookies.get('ff_setup_done')?.value
  if (!setupDone) {
    try {
      const res = await fetch(`${API_URL}/setup/status`, {
        next: { revalidate: 60 },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.needs_setup) {
          return NextResponse.redirect(new URL('/setup', request.url))
        }
        const response = NextResponse.next()
        response.cookies.set('ff_setup_done', '1', { path: '/', maxAge: 60 * 60 * 24 })
        return response
      }
    } catch {
      // API unreachable — let the request through, the page will show errors
    }
  }
  ...
}
```

`Dockerfile.allinone` runtime stage sets (around line 78–82):

```dockerfile
ENV ... \
    NEXT_PUBLIC_API_URL=/api \
    ...
```

`deploy/allinone/nginx.conf` proxies `/api/` → `http://127.0.0.1:8000/` and `/`
→ `http://127.0.0.1:3000` (the Next.js server). So inside the container the API
is reachable server-side at `http://127.0.0.1:8000`.

In `docker-compose.dev.yml` the web app sets `NEXT_PUBLIC_API_URL=http://localhost:8000`
(absolute), which is why middleware works there today — the bug is specific to
the relative `/api` base.

### Repo conventions

- Server-only env vars have **no** `NEXT_PUBLIC_` prefix (they must not be
  inlined into the client bundle). Introduce `INTERNAL_API_URL` for this.
- Env is threaded into the all-in-one via `Dockerfile.allinone` `ENV` and the
  entrypoint; supervisord passes the process environment through to the web
  service.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |
| API syntax | `python3 -m py_compile apps/api/routers/setup.py` (from repo root, only if you touch it — you should NOT) | exit 0 |

## Scope

**In scope**:
- `apps/web/middleware.ts`
- `Dockerfile.allinone` (add one `ENV`)

**Out of scope** (do NOT touch):
- `apps/api/routers/setup.py` — the `/setup/status` endpoint is correct; the bug
  is purely the URL middleware uses to reach it.
- `deploy/allinone/nginx.conf`, `supervisord.conf`, `entrypoint.sh` — no change
  needed; the container already exposes the API at `127.0.0.1:8000`.
- `docker-compose.dev.yml` — dev already uses an absolute URL.

## Git workflow

- Branch: `advisor/063-first-deploy-setup-redirect`
- Commit: `fix(web): middleware reaches API server-side for setup redirect (plan 063)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Middleware uses a server-side absolute API URL

In `apps/web/middleware.ts`, replace the `API_URL` constant (line 7) with a
server-side resolver that prefers an explicit internal URL, then an absolute
public URL, then a localhost default — never a relative path:

```ts
// Server-side (middleware) must reach the API with an ABSOLUTE url — a
// relative NEXT_PUBLIC_API_URL like "/api" (all-in-one) has no origin here.
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || ''
const API_URL =
  process.env.INTERNAL_API_URL ||
  (PUBLIC_API_URL.startsWith('http') ? PUBLIC_API_URL : 'http://127.0.0.1:8000')
```

Leave the rest of the file unchanged.

**Verify**: `grep -c "INTERNAL_API_URL" apps/web/middleware.ts` → `1`;
`grep -c "startsWith('http')" apps/web/middleware.ts` → `1`

### Step 2: Set `INTERNAL_API_URL` in the all-in-one image

In `Dockerfile.allinone`, in the runtime-stage `ENV` block that already sets
`NEXT_PUBLIC_API_URL=/api`, add `INTERNAL_API_URL=http://127.0.0.1:8000` (the
API listens on 8000 inside the container). Keep the existing lines.

**Verify**: `grep -c "INTERNAL_API_URL=http://127.0.0.1:8000" Dockerfile.allinone` → `1`

### Step 3: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

Add one unit test for the URL-resolution logic if a `middleware` test file
exists (`grep -rl "middleware" apps/web/__tests__ apps/web/components 2>/dev/null`);
otherwise **do not** scaffold a test harness for middleware (Next middleware is
awkward to unit-test) — the typecheck + build gate plus the manual check below
are sufficient. Note this choice in your report.

Manual verification (describe in report, do not run — needs Docker):
1. `docker build -f Dockerfile.allinone -t ff:t .` then run with a fresh volume.
2. Hit `http://localhost:PORT/` → should 307-redirect to `/setup` (no account yet).

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "INTERNAL_API_URL" apps/web/middleware.ts` → `1`
- [ ] `grep -c "INTERNAL_API_URL=http://127.0.0.1:8000" Dockerfile.allinone` → `1`
- [ ] `middleware.ts` contains no bare `fetch('/` relative call (the API base is now absolute)
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- The `API_URL`/middleware excerpt doesn't match the live file (drift).
- `NEXT_PUBLIC_API_URL` is NOT `/api` in `Dockerfile.allinone` (someone changed
  the deployment model) — report before editing.
- The `/setup/status` endpoint path differs from `/setup/status` — report.

## Maintenance notes

- Any future server-side fetch in middleware or server components that targets
  the API must use `INTERNAL_API_URL` (absolute), never the relative
  `NEXT_PUBLIC_API_URL`, or it breaks in the all-in-one the same way.
- If the API is ever moved off `127.0.0.1:8000` in the container, update the
  `ENV` default.
