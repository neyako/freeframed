# Plan 043: Repo hygiene — remove dead npm lockfiles, pin turbo, fix stale docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39bdfc6..HEAD -- package.json package-lock.json pnpm-lock.yaml apps/web/package-lock.json .gitignore docs/contributing.md docs/architecture.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

Three small rots, one cleanup pass. (1) The repo tracks npm lockfiles
(`package-lock.json`, 379 KB at root and 376 KB in `apps/web`) **and** pnpm
lockfiles, but CI installs exclusively with `pnpm install --frozen-lockfile` —
anyone (or any agent) running `npm install` resolves a *different* dependency
tree than CI, silently. (2) Root `package.json` pins `turbo` to `"latest"`,
so root builds are non-reproducible. (3) `docs/contributing.md` tells
contributors to run `npm test` and install Node 18+, while the repo is
pnpm-10/Node-20; and `docs/architecture.md` documents an Organization/Team
permission layer as the enforced asset-access path. Live code is narrower:
`can_access_asset` checks creator, project member, direct user `AssetShare`,
then `Project.is_public`. Separate legacy/team-share remnants still exist
(`AssetShare.shared_with_team_id`, `/share/team` endpoints, broken org seed/test
helpers), so this plan must not claim the team/org surface is gone. Stale docs
that are actively wrong are worse than missing docs.

## Current state

- Tracked lockfiles (verified via `git ls-files | grep -E "(package-lock|pnpm-lock)"`):
  - `package-lock.json` (root, 379 KB) — npm artifact, **dead**
  - `pnpm-lock.yaml` (root, 2.3 KB) — pnpm, live (root workspace: just turbo)
  - `apps/web/package-lock.json` (376 KB) — npm artifact, **dead**
  - `apps/web/pnpm-lock.yaml` (226 KB) — pnpm, live (CI: `pnpm install --frozen-lockfile` in `apps/web`)

- Root `package.json` (entire file):

  ```json
  {
    "name": "freeframe",
    "private": true,
    "workspaces": ["apps/*", "packages/*"],
    "scripts": {
      "dev": "turbo run dev",
      "build": "turbo run build",
      "lint": "turbo run lint"
    },
    "devDependencies": {
      "turbo": "latest"
    }
  }
  ```

- `docs/contributing.md:90-98` — frontend test instructions say
  `docker compose -f docker-compose.dev.yml exec web npm test` /
  `npm run test:watch`; line ~13 prerequisites say "Node.js 18+". CI uses
  Node 20 + pnpm 10 (`.github/workflows/ci.yml:123-129`); `apps/web` scripts
  run via pnpm; the vitest suite is `pnpm test`.
  Also `docs/contributing.md:133`: "Run linting: `npm run lint`".

- `docs/architecture.md:130-160` — "Permission Model" section shows an
  Organization→Team→Project hierarchy and this asset-access order:

  ```
  1. Is the user the asset creator?
  2. Is the user a project member (any role)?
  3. Was the asset shared directly with the user (AssetShare)?
  4. Was the asset shared with the user's team?
  5. Is the user an org admin?
  ```

  Reality (`apps/api/services/permissions.py:60-83`, `can_access_asset`):
  creator → project member → direct user `AssetShare` → **public project**.
  There is no team-share or org-admin path in `can_access_asset`. However, the
  wider repo still has live/stale team-org remnants: `apps/api/routers/share.py`
  writes `AssetShare.shared_with_team_id` for `/folders/{folder_id}/share/team`
  and `/assets/{asset_id}/share/team`, `apps/api/schemas/share.py` exposes
  `team_id` / `shared_with_team_id`, and seed/test-helper files import the
  removed `models.organization` module. This plan updates the architecture doc
  to the enforced access algorithm and notes those remnants as deferred cleanup;
  it does not touch API code.
  The README's feature list ("Team collaboration with role-based permissions
  (org, team, project levels)") is also affected, but README wording is a
  product/marketing call — leave README alone, fix the technical doc.

- `.gitignore` (root) — has no `package-lock.json` entry today.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Current turbo version (network, read-only) | `npm view turbo version` | prints a version, e.g. `2.x.y` |
| Root install still resolves | `pnpm install --lockfile-only` (repo root) | exit 0 |
| Web install untouched | `cd apps/web && pnpm install --frozen-lockfile --lockfile-only` | exit 0 (see caveat in Step 4) |

## Scope

**In scope** (the only files you should modify/delete):
- `package-lock.json` (root — delete)
- `apps/web/package-lock.json` (delete)
- `package.json` (root — pin turbo)
- `pnpm-lock.yaml` (root — regenerated by the pin)
- `.gitignore` (root — add `package-lock.json`)
- `docs/contributing.md` (command/version fixes)
- `docs/architecture.md` (permission-model section fix)

**Out of scope** (do NOT touch, even though they look related):
- `apps/web/pnpm-lock.yaml` — live lockfile; nothing in this plan changes web deps.
- `apps/web/package.json` — no dependency changes in this plan.
- `README.md` — the "org, team, project levels" feature bullet is a product
  wording decision for the maintainer, not a doc-accuracy fix.
- `apps/api/**` — the code is the source of truth here; docs move to match it.
- CI workflows — 041 owns `ci.yml`.

## Git workflow

- Branch: `advisor/043-repo-hygiene`
- Commit style: conventional commits, e.g.
  `chore: drop dead npm lockfiles, pin turbo` and
  `docs: fix stale pnpm commands + permission-model description`
  (two commits are fine: chore + docs)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the dead npm lockfiles and ignore future ones

```bash
git rm package-lock.json apps/web/package-lock.json
```

Append to root `.gitignore` (there is a "dependencies"-ish area near the top;
placement is not critical):

```
# npm artifacts — this repo is pnpm-only (CI: pnpm install --frozen-lockfile)
package-lock.json
```

**Verify**: `git ls-files | grep package-lock` → no matches.

### Step 2: Pin turbo in root package.json

Run `npm view turbo version` (read-only registry query) and pin the exact
major.minor it reports with a caret, e.g. if it prints `2.5.8`:

```json
  "devDependencies": {
    "turbo": "^2.5.8"
  }
```

Then regenerate the root pnpm lockfile: `pnpm install --lockfile-only` at the
repo root.

**Verify**: `grep -n '"turbo"' package.json` → shows a caret-pinned version
(not `"latest"`), and `git diff --stat pnpm-lock.yaml` shows the lockfile
updated, and `pnpm install --lockfile-only` exited 0.

### Step 3: Fix stale commands in docs/contributing.md

- Replace the frontend test commands (lines ~90-98):
  `npm test` → `pnpm test`, `npm run test:watch` → `pnpm test:watch`
  (keep the `docker compose ... exec web` wrapper form).
- Prerequisites: "Node.js 18+" → "Node.js 20+ and pnpm 10 (matches CI)".
- Line ~133: "Run linting: `npm run lint`" → "Run linting: `pnpm lint`".

**Verify**: `grep -nE '(^|[^[:alpha:]])npm([[:space:]]|$)' docs/contributing.md` → no matches
(all commands are pnpm or docker/git/alembic; do not use formatting tricks to
hide `pnpm` from a brittle substring grep).

### Step 4: Fix the permission-model section in docs/architecture.md

In the "Permission Model" section (~lines 128-162):

1. Replace the layered diagram's Organization/Team levels with a note. Target
   shape (adapt formatting to the surrounding doc style):

   ```
   Enforced asset access is project-scoped. Organization/team tables and
   `shared_with_team_id` remnants still exist in migrations/API edges, but
   `can_access_asset` does not grant access through a team or org-admin path.
   Clean up those remnants in a separate API plan.

   Project
   ├── owner    ── full control over project
   ├── editor   ── upload, edit assets
   ├── reviewer ── comment, approve/reject
   └── viewer   ── read-only access
       │
       Share Link
       ├── approve  ── can approve/reject
       ├── comment  ── can add comments
       └── view     ── read-only
   ```

2. Replace the 5-step asset-access list with the real algorithm from
   `apps/api/services/permissions.py::can_access_asset`:

   ```
   **Asset access is checked in this order:**
   1. Is the user the asset creator?
   2. Is the user a project member (any role)?
   3. Was the asset shared directly with the user (`AssetShare`)?
   4. Is the project public (`Project.is_public`)? Any authenticated user can view.
   ```

3. Keep the GuestUser sentence at the end of the section unchanged.

**Verify**: `grep -n "org admin\|user's team" docs/architecture.md` → no
matches; `grep -n "shared_with_team_id" docs/architecture.md` → ≥1 match;
`grep -n "is_public" docs/architecture.md` → ≥1 match.

### Step 5: Sanity-check nothing else changed

**Verify**: `git status --short` lists exactly: deleted
`package-lock.json` + `apps/web/package-lock.json`; modified `package.json`,
`pnpm-lock.yaml`, `.gitignore`, `docs/contributing.md`,
`docs/architecture.md` (+ `plans/README.md` when you update the index).

## Test plan

No test code — config and docs. The executable verification is Step 2's
`pnpm install --lockfile-only` (root resolution still works with the pin) and
the grep gates in Steps 1/3/4. Do NOT run a full `pnpm install` in `apps/web`;
nothing there changed and a full install mutates `node_modules` for no reason.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git ls-files | grep package-lock` → no matches
- [ ] `grep -n "package-lock.json" .gitignore` → 1 match
- [ ] `grep -n '"latest"' package.json` → no matches
- [ ] `pnpm install --lockfile-only` (root) → exit 0
- [ ] `grep -nE '(^|[^[:alpha:]])npm([[:space:]]|$)' docs/contributing.md` → no matches
- [ ] `grep -n "org admin" docs/architecture.md` → no matches
- [ ] `grep -n "shared_with_team_id" docs/architecture.md` → ≥1 match
- [ ] `git status` clean apart from the in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm view turbo version` reports a major version other than 2 — a turbo 3+
  pin may change `turbo.json` schema requirements; report the version instead
  of pinning blind.
- `pnpm install --lockfile-only` at root fails after the pin.
- `docs/architecture.md`'s permission section doesn't match the excerpt
  (someone already rewrote it — reconcile instead of overwriting).
- `can_access_asset` or `require_asset_access` actually grants access via
  `AssetShare.shared_with_team_id`, `Team`, `OrgMember`, or org-admin logic.
  That would contradict the proposed architecture-doc algorithm and needs a
  separate plan before this doc wording can land.

## Maintenance notes

- If the maintainer ever revives teams/orgs, `docs/architecture.md` must be
  re-expanded and the vestigial tables (`teams`, `team_members`,
  `organizations`, `org_members`) either adopted or dropped in a migration —
  a bigger decision deliberately not taken here.
- The vestigial `AssetShare.shared_with_team_id` column and the dead org/team
  tables remain in the schema (dropping them is a data-destructive migration;
  not worth the risk for hygiene alone).
- Reviewer focus: the two deleted lockfiles are pure deletions (no content
  changes elsewhere), and the architecture-doc diff only touches the
  Permission Model section.
