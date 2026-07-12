# Plan 083: Next.js 15 migration spike — inventory breakage, produce the migration plan

> **Executor instructions**: This is a SPIKE — the deliverable is a written
> report + a proven upgrade branch, NOT a merged migration. Follow the steps,
> run every verification command, and write findings into
> `plans/083-spike-report.md`. If anything in "STOP conditions" occurs, stop
> and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 96b6644..HEAD -- apps/web/package.json apps/web/next.config.js apps/web/middleware.ts`
> On any mismatch with "Current state", STOP.

## Status

- **Priority**: P2
- **Effort**: M (spike; the full migration it specifies is L)
- **Risk**: LOW (spike itself is throwaway; nothing merges to main)
- **Depends on**: none (file-disjoint from plans 080–082, 084)
- **Category**: migration / security
- **Planned at**: commit `96b6644`, 2026-07-12

## Why this matters

`apps/web` pins `next@14.2.35` — the **final release of the 14.x line**.
`pnpm audit --prod` reports 6 HIGH advisories against it (DoS via RSC
deserialization GHSA-h25m-26qc-wcjf, Server-Components DoS GHSA-q4gf-8mx6-v5v3
/ GHSA-8h8q-6873-q5fj, SSRF via WebSocket upgrades GHSA-c4j6-fc7j-m34r,
middleware/proxy bypass GHSA-36qx-fr4f-26g5) whose fixes exist **only in
15.x** — there is no patch path on 14. The homelab/LAN deployment model
softens exposure, but shared links are public-facing by design, so the
middleware-bypass and DoS classes are live. Next 15 changes caching defaults,
makes `params`/`searchParams` async, and alters fetch/router-cache semantics —
a blind bump would break silently. This spike measures the real blast radius
and produces the executable migration plan.

## Current state

- `apps/web/package.json:28-30,47,51` — `"next": "14.2.35"`, `"react":
  "^18.3.1"`, `"react-dom": "^18.3.1"`, `"eslint-config-next": "14.2.29"`,
  `"typescript": "^5.8.3"`.
- App Router throughout: `apps/web/app/**` (dashboard group
  `app/(dashboard)/…`, guest share `app/share/[token]/…`, auth screens).
  Dynamic route params are consumed in many client + server components.
- `apps/web/middleware.ts` — auth-gate + setup-redirect logic (cookies
  `ff_access_token`/`ff_refresh_token`, public prefixes `/invite/`,
  `/share/`, matcher at bottom). Middleware behavior changes are the
  advisory-relevant surface.
- `apps/web/next.config.js` exists (check its contents during the spike —
  `images`, `output`, rewrites all have 15.x implications).
- State/data: Zustand + SWR client-side; hls.js for video. Server components
  are thin; most pages are `"use client"`.
- Gates (run in `apps/web/`): `pnpm test` (vitest, ~173 tests),
  `pnpm exec tsc --noEmit` (0 errors), `pnpm build`, `pnpm lint`
  (warnings exist, no new errors).
- Deploy targets that must keep working: `apps/web/Dockerfile` (standalone
  build) and `Dockerfile.allinone` (bundles the web build; nginx in front).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `cd apps/web && pnpm install` | exit 0 |
| Codemod | `cd apps/web && pnpm dlx @next/codemod@latest upgrade latest` | applies 15.x codemods |
| Typecheck | `pnpm exec tsc --noEmit` | 0 errors (eventually) |
| Tests | `pnpm test` | 173+ pass |
| Build | `pnpm build` | exit 0 |
| Audit | `pnpm audit --prod` | 0 high advisories against next |

## Scope

**In scope** (all work on a throwaway branch):

- A spike branch `advisor/083-next15-spike` where you bump + codemod + fix
  until the gate is green OR the blockers are precisely known.
- `plans/083-spike-report.md` (create — the deliverable).
- `plans/README.md` (status row).

**Out of scope**:

- Merging anything from the spike branch to main.
- React 19 bump — only go there if Next 15 hard-requires it (15.x supports
  React 18 for pages router only; App Router on 15 requires React 19 — the
  spike must confirm this from the installed version's peer deps and record
  the consequence).
- Any API (`apps/api`) change.
- Visual/behavioral redesign — pixel-identical is the bar.

## Git workflow

- Branch: `advisor/083-next15-spike` (throwaway; never merged, kept for
  reference by the real migration executor).
- Commit freely on the spike branch; conventional style not required there.
  The report file is committed on a normal branch or handed to the maintainer.

## Steps

### Step 1: Baseline

On the spike branch: `cd apps/web && pnpm test && pnpm exec tsc --noEmit &&
pnpm build` — record pass counts/timings in the report as the baseline.

**Verify**: all three green before touching anything.

### Step 2: Bump + codemod

`pnpm dlx @next/codemod@latest upgrade latest` (accept next 15.x latest,
eslint-config-next to match, React if required). Record: exact versions
chosen, which codemods ran, and every file they touched (`git diff --stat`).

**Verify**: `git diff --stat` captured into the report.

### Step 3: Triage to green (timeboxed)

Iterate `pnpm exec tsc --noEmit` → fix → `pnpm test` → fix → `pnpm build` →
fix. Classify every fix into the report's taxonomy:

1. **Async `params`/`searchParams`** — list every affected route file.
2. **Caching-default changes** — fetches/pages that silently changed from
   cached→uncached or vice versa; note where explicit `cache:`/`revalidate`
   annotations are now required (middleware's `/setup/status` fetch already
   uses `cache: 'no-store'` — verify it survives).
3. **Middleware behavior** — re-verify the auth matcher and public prefixes
   behave identically (manual: `pnpm dev`, curl `/projects` without cookies →
   302 to `/login`; `/share/x` → 200 page shell).
4. **Third-party breakage** — hls.js, fabric, Zustand, SWR, next/font
   (Space Grotesk/Mono via `next/font/google`, Doto via `next/font/local` —
   both must keep working; check the font-variable-on-`<html>` fix survives).
5. **Anything unresolvable inside the timebox** — exact error + file.

Timebox: stop fixing after roughly a day's effort even if not green; the
inventory is the deliverable, not the green build.

**Verify**: report contains all five sections with file lists.

### Step 4: Deployment check (only if Step 3 reached green)

`pnpm build` output mode vs `apps/web/Dockerfile` expectations (standalone
output path changes between majors have broken images before). If Docker is
available, build `apps/web/Dockerfile` and smoke-run.

**Verify**: image builds; `/login` serves.

### Step 5: Write the migration plan skeleton

End `plans/083-spike-report.md` with a "Migration plan" section: ordered
steps, per-step verification, estimated effort, the React-19 decision and
its consequences, and a STOP-worthy-risks list — written so a follow-up plan
(084+ numbering, on request) can be produced from it almost verbatim.

## Test plan

No new tests in the spike. The existing 173-test suite + tsc + build ARE the
measurement instrument; their failure inventory is the data.

## Done criteria

- [ ] `plans/083-spike-report.md` exists with: baseline, versions chosen,
      codemod diffstat, 5-section fix taxonomy, middleware verification
      result, deployment result (or "not reached"), migration plan skeleton
- [ ] Spike branch `advisor/083-next15-spike` exists with the work
- [ ] main is untouched (`git diff main --stat` on main's checkout → empty)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Next 15's React-19 requirement forces incompatible peer deps on a pinned
  library with no compatible release (record which; that's a report finding,
  not a fix-it-here problem).
- The codemod rewrites more than ~60 files — stop, record the diffstat, and
  triage only the build-blocking subset; full inventory over full fix.
- Anything tempts you to change `apps/api` or test fixtures' semantics.

## Maintenance notes

- The advisories make this time-sensitive but not emergency (LAN-first
  deployment); the real migration should be scheduled soon after the spike,
  before more 14.x-only code accrues.
- Reviewer of the eventual migration: middleware semantics and share-link
  (public) routes are the security-relevant surface — test those, not just
  the dashboard happy path.
