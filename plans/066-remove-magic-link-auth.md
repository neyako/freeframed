# Plan 066: Remove magic-link auth (email + password only)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report — do not improvise. A reviewer maintains `plans/README.md`;
> do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- apps/api/routers/auth.py apps/api/schemas/auth.py apps/web/components/auth/login-form.tsx`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches auth on both web and API)
- **Depends on**: none
- **Category**: direction / tech-debt (self-hostable fork: no SaaS email flow)
- **Planned at**: commit `a7d1e10`, 2026-07-04

## Why this matters

This fork is self-hosted, not SaaS. The magic-code login (email a 6-digit code,
then set a password) assumes working SMTP and adds a whole passwordless flow that
isn't wanted. The maintainer chose **full removal**: login becomes email +
password only; the magic-code endpoints, schemas, Redis helpers, and email task
are deleted. Classic register/login/refresh stay.

Verified safe: **no API test references magic/set-password**
(`grep -rln -e magic -e set-password apps/api/tests` → empty), so the CI
tripwires (≥50 API tests pass, ≥5 API test files — `.github/workflows/ci.yml`
lines 82/93) are unaffected. `apps/api/routers/auth.py` is a CI critical file —
you EDIT it, never delete it, so the existence check (line ~105) stays green.

## Current state

### API — `apps/api/routers/auth.py`

Imports (lines 7–24) pull in the magic schemas, the Redis magic helpers, and the
magic email task:
```python
from ..schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    RefreshRequest, UserResponse, InviteRequest,
    SendMagicCodeRequest, SendMagicCodeResponse,
    VerifyMagicCodeRequest, SetPasswordRequest,
    AcceptInviteRequest, InviteInfoResponse,
)
from ..services.redis_service import (
    generate_magic_code, store_magic_code, verify_magic_code as redis_verify_magic_code,
    MAGIC_CODE_EXPIRY_SECONDS,
)
from ..tasks.email_tasks import send_magic_code_email, send_invite_email
```
`MAGIC_CODE_EXPIRY_MINUTES = MAGIC_CODE_EXPIRY_SECONDS // 60` (line 31).

Three endpoints to delete: `send_magic_code` (lines 39–77), `verify_magic_code`
(lines 80–115), `set_password` (lines 118–128). Endpoints to KEEP: `register`
(180), `login` (198), `refresh_token` (216), `get_me` (231), invite endpoints,
preferences.

Note: `send_magic_code` also contains the "first user becomes superadmin"
creation branch. That bootstrap is handled by the dedicated setup flow
(`/setup/create-superadmin`), so deleting it here is correct — but confirm
`apps/api/routers/setup.py` exists and creates the first superadmin (grep in
Step 1) before removing.

### API — `apps/api/schemas/auth.py`

`class SendMagicCodeRequest` (41), `SendMagicCodeResponse` (44),
`VerifyMagicCodeRequest` (48), `SetPasswordRequest` (52) — remove.
`TokenResponse` (14) has `needs_password: bool = False` (line 18) — remove that
field (only the deleted magic flow set it).

### API — services / tasks (magic helpers, used only by auth.py)

- `apps/api/services/redis_service.py`: `generate_magic_code`, `store_magic_code`,
  `verify_magic_code`, `MAGIC_CODE_EXPIRY_SECONDS` — used only by auth.py.
- `apps/api/tasks/email_tasks.py`: `send_magic_code_email` — used only by auth.py.
- `apps/api/tasks/celery_app.py`: a task route entry for
  `apps.api.tasks.email_tasks.send_magic_code_email` — remove that one route line.

### Web — `apps/web/components/auth/login-form.tsx`

A multi-step state machine (`'email' | 'code' | 'password' | 'classic'`) that
defaults to the magic flow; `handleSendCode` POSTs `/auth/send-magic-code`,
`submitCode` POSTs `/auth/verify-magic-code`, `handleSetPassword` POSTs
`/auth/set-password`. The `'classic'` branch (lines 230–278) is exactly the
email+password form we want as the ONLY form.

- `apps/web/types/index.ts` line 493: `export interface VerifyCodeResponse { ... }` — remove (magic only).
- `apps/web/components/auth/__tests__/auth-shell.test.tsx` line ~32 asserts a
  `'Send magic code'` button — update to the password form.

### Repo conventions

- API: FastAPI + Pydantic v2; timezone-aware datetimes; soft-delete filters
  (`deleted_at.is_(None)`). Match the file's style.
- Local API check: no venv on this machine — use
  `python3 -m py_compile <files>` (CI runs pytest). Never claim pytest ran.
- Web: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build` are the gates.

## Commands you will need

| Purpose      | Command | Expected |
|--------------|---------|----------|
| API syntax   | `python3 -m py_compile apps/api/routers/auth.py apps/api/schemas/auth.py apps/api/services/redis_service.py apps/api/tasks/email_tasks.py apps/api/tasks/celery_app.py` | exit 0 |
| Web typecheck| `pnpm exec tsc --noEmit` (in `apps/web/`) | exit 0 |
| Web tests    | `pnpm test` (in `apps/web/`) | all pass |
| Web build    | `pnpm build` (in `apps/web/`) | exit 0 |

## Scope

**In scope**:
- `apps/api/routers/auth.py`, `apps/api/schemas/auth.py`
- `apps/api/services/redis_service.py`, `apps/api/tasks/email_tasks.py`, `apps/api/tasks/celery_app.py`
- `apps/web/components/auth/login-form.tsx`
- `apps/web/types/index.ts` (remove `VerifyCodeResponse`)
- `apps/web/components/auth/__tests__/auth-shell.test.tsx` (update assertion)

**Out of scope** (do NOT touch):
- `apps/api/routers/setup.py` — first-run superadmin; unchanged.
- `register`, `login`, `refresh`, invite, preferences endpoints — keep.
- `send_invite_email` in `email_tasks.py` — invites still use it; KEEP.
- `apps/web/components/auth/setup-wizard.tsx`, `invite-accept.tsx` — separate flows.

## Git workflow

- Branch: `advisor/066-remove-magic-link-auth`
- Commit: `feat(auth): remove magic-link login, email+password only (plan 066)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Confirm the setup bootstrap exists

`grep -rn "create-superadmin\|create_superadmin\|is_superadmin" apps/api/routers/setup.py`
→ must show the first-superadmin creation. If `setup.py` does NOT create the first
admin, **STOP** — deleting `send_magic_code` would remove the only bootstrap path.

### Step 2: API — delete the three magic endpoints

In `apps/api/routers/auth.py` delete the `send_magic_code`, `verify_magic_code`,
and `set_password` functions (their `@router.post(...)` decorators through their
`return`), and delete `MAGIC_CODE_EXPIRY_MINUTES = ...` (line 31).

**Verify**: `grep -c "magic" apps/api/routers/auth.py` → `0`

### Step 3: API — prune imports

In `auth.py` remove the magic schema names from the `..schemas.auth` import,
remove the entire `..services.redis_service` import block, and drop
`send_magic_code_email` from the `..tasks.email_tasks` import (keep
`send_invite_email`). Remove `send_task_safe`/`rate_limit` imports ONLY if they
are now unused (grep the file first — `rate_limit` may still gate other
endpoints; `send_task_safe` may still be used by invites).

**Verify**: `python3 -m py_compile apps/api/routers/auth.py` → exit 0;
`grep -c "redis_service" apps/api/routers/auth.py` → `0`

### Step 4: API — remove magic schemas + `needs_password`

In `apps/api/schemas/auth.py` delete `SendMagicCodeRequest`,
`SendMagicCodeResponse`, `VerifyMagicCodeRequest`, `SetPasswordRequest`, and the
`needs_password: bool = False` field from `TokenResponse`.

**Verify**: `grep -c "MagicCode\|SetPasswordRequest\|needs_password" apps/api/schemas/auth.py` → `0`

### Step 5: API — remove now-dead helpers

- `apps/api/services/redis_service.py`: delete `generate_magic_code`,
  `store_magic_code`, `verify_magic_code`, and `MAGIC_CODE_EXPIRY_SECONDS`
  (confirm no other importer: `grep -rn "generate_magic_code\|store_magic_code\|MAGIC_CODE_EXPIRY" apps/api --include=*.py`
  should show only redis_service.py after Step 3).
- `apps/api/tasks/email_tasks.py`: delete the `send_magic_code_email` task.
- `apps/api/tasks/celery_app.py`: delete the task-route line for
  `send_magic_code_email`.

**Verify**: `python3 -m py_compile apps/api/services/redis_service.py apps/api/tasks/email_tasks.py apps/api/tasks/celery_app.py` → exit 0;
`grep -rc "send_magic_code_email" apps/api --include=*.py | grep -v ':0' | wc -l` → `0`

### Step 6: Web — password-only login form

Rewrite `apps/web/components/auth/login-form.tsx` so the ONLY form is
email+password (the existing `'classic'` branch is the template). Remove the
`step` state machine, the `'email'`/`'code'`/`'password'` branches, the
`handleSendCode`/`submitCode`/`handleSetPassword`/`handleVerifyCode` functions,
the 6-digit code UI, and all `/auth/send-magic-code`, `/auth/verify-magic-code`,
`/auth/set-password` calls. Keep `handleClassicLogin` (POST `/auth/login`) as the
submit handler. Drop the "Sign in with password instead" / "Back to magic link"
toggles. Keep the heading/subtext (adjust copy to "Sign in to FreeFrame" / "Enter
your email and password."). Remove the `VerifyCodeResponse` import.

**Verify**: `grep -c "magic\|send-magic\|verify-magic\|set-password" apps/web/components/auth/login-form.tsx` → `0`

### Step 7: Web — remove dead type + fix test

- `apps/web/types/index.ts`: delete `export interface VerifyCodeResponse { ... }`.
  Confirm no remaining importer: `grep -rn "VerifyCodeResponse" apps/web` → `0`.
- `apps/web/components/auth/__tests__/auth-shell.test.tsx`: update the assertion
  that expects `'Send magic code'` to expect the password form instead (e.g. a
  `'Sign in'` submit button and email/password inputs). Keep the test meaningful
  — assert the password form renders and submits; do not weaken it to a no-op.

**Verify**: `grep -c "magic" apps/web/components/auth/__tests__/auth-shell.test.tsx` → `0`

### Step 8: Gate

- API: `python3 -m py_compile apps/api/routers/auth.py apps/api/schemas/auth.py apps/api/services/redis_service.py apps/api/tasks/email_tasks.py apps/api/tasks/celery_app.py` → exit 0.
- Web (in `apps/web/`): `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass; `pnpm build` → exit 0.

## Test plan

- Web: the updated `auth-shell.test.tsx` must assert the password form renders and
  a submit calls `/auth/login` (mock the api). Follow the existing test's mocking
  style. Do not reduce the assertion count to zero.
- API: no pytest runnable locally (no venv). Rely on `py_compile` + CI. Because no
  API test references magic, the ≥50-pass / ≥5-file tripwires stay satisfied —
  but if your greps show ANY API test importing a removed symbol, STOP and report
  (do not delete API tests).

## Done criteria

- [ ] `python3 -m py_compile` on all five API files → exit 0
- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -rc "magic" apps/api/routers/auth.py apps/api/schemas/auth.py apps/web/components/auth/login-form.tsx` → all `0`
- [ ] `grep -rn "VerifyCodeResponse" apps/web` → `0`
- [ ] `apps/api/routers/auth.py` still exists (CI critical file) and defines `login`/`register`/`refresh`
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- `setup.py` does not create the first superadmin (Step 1 fails) — STOP.
- Any file outside the in-scope list imports a removed symbol (a hidden consumer
  of the magic helpers) — STOP and report the importer.
- An API test references magic/set-password (would gut the count) — STOP.
- Removing `rate_limit`/`send_task_safe` imports breaks other endpoints in
  auth.py — keep those imports; only remove what's truly unused.

## Maintenance notes

- After this, `email_tasks.py` retains only `send_invite_email`; if invites are
  ever removed too, revisit the email worker wiring.
- The login screen is now the single auth entry point; the setup wizard
  (`/setup`) remains the first-run bootstrap and is unaffected.
