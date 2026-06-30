# Plan 019: Extend the single-link model to folder / project / bulk shares, and retire ShareCreateDialog

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. When done, update the status row for
> this plan in `plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index. This plan **deletes `ShareCreateDialog`** — do Plan
> 015 first, then this, and let the build catch dangling imports.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- apps/web/components/review/share-dialog.tsx apps/web/components/projects/share-create-dialog.tsx "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/api/routers/share.py`
> If these changed (esp. after Plan 015 lands), reconcile the "Current state"
> excerpts before editing; on a mismatch you can't resolve, STOP.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P2
- **Effort**: L (generalize the single-link panel to 3 target types + a minimal bulk flow + delete the dialog)
- **Risk**: MED (removes the multi-phase share dialog; build + manual smoke are the guard)
- **Depends on**: **plans/015-single-link-share-rework.md** (must land first — it introduces
  `SingleLinkSection` for assets and removes the standalone management section; this plan generalizes
  that component and removes the last `ShareCreateDialog` consumer).
- **Category**: feature / UX (sharing) — completes the Drive-style rework
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

Plan 015 made **per-asset** sharing a single Drive-style link but deliberately **kept
`ShareCreateDialog`** because the project page still uses it for **folder**, **project**, and **bulk
multi-asset** shares (`projects/[id]/page.tsx:1200`). This plan finishes the job the maintainer asked
for ("remove the create-dialog"): it extends the single-link model to folders and projects, replaces the
bulk multi-asset flow with a minimal "create a link for this selection → copy" panel, and **deletes
`ShareCreateDialog`** and its multi-phase Selection/Configure/LinkCreated UI.

After 015 + 019, **all** sharing is one model: press Share (on an asset, folder, project, or a selection)
→ get one link with an access toggle + copy, plus optional people-share. No multi-link lists, no
create-dialog, no management table.

## Key decision (the one real design choice) — bulk multi-asset share

"One link per X" maps cleanly to a single asset / folder / project. A **bulk selection of arbitrary
assets** is inherently a "create a link for *these N items*" action (backed by `ShareLinkItem` rows via
`POST /projects/{id}/share/multi`) — there is no canonical "the link" for an ad-hoc selection.

**Recommended (this plan implements it):** keep bulk sharing as a **minimal create-and-copy** — when the
user shares a multi-asset selection, POST once to `/projects/{id}/share/multi`, then immediately show the
returned link + Copy (no phases, no multi-link list). This preserves the capability without the dialog.

If the maintainer would rather **drop** ad-hoc multi-asset sharing entirely (only asset/folder/project
get links), that's simpler — see STOP/Alternative. Do not silently choose; if dropping it seems
required, STOP and confirm.

## Current state

### `ShareCreateDialog` — the thing being retired (`apps/web/components/projects/share-create-dialog.tsx`)

A 3-phase dialog (`SelectionPhase` → `ConfigurePhase` → `LinkCreatedPhase`) with props (line ~34):

```tsx
interface ShareCreateDialogProps {
  open; onOpenChange;
  projectId; currentFolderId: string | null;
  assets: AssetResponse[]; folders: Folder[];
  preselectedItem?: { type: 'folder' | 'asset'; id; name } | null;
  preselectedItems?: { type: 'folder' | 'asset'; id; name }[];
  initialResult?; onShareCreated: () => void; onAdvancedSettings?: (token) => void;
}
```

### Where it's mounted + triggered — `apps/web/app/(dashboard)/projects/[id]/page.tsx`

- Mount at line ~1200 (`<ShareCreateDialog open={shareDialogOpen} … />`).
- Triggers set `shareDialogPreselect` / `shareDialogPreselectedItems` then `setShareDialogOpen(true)`:
  - **folder share**: `onFolderShare` (line ~751) → preselect `{ type:'folder', id, name }`.
  - **bulk share**: `onCreateShareLink` (line ~766) → `openShareDialog` with selected asset/folder ids.
  - **project share**: a "share project" trigger (line ~333 / ~1136) with no preselect (whole project).
- `onAdvancedSettings` opened the management view — **already removed by Plan 015** (the `showShareLinks`
  state is gone). If any reference remains after 015, it must be removed here too.

### Backend endpoints (already exist — do NOT change)

From `apps/api/routers/share.py`:
- Folder: `POST /folders/{folder_id}/share` (create) · `GET /folders/{folder_id}/shares` (list).
- Project: `POST /projects/{project_id}/share` (create) · `GET /projects/{project_id}/share-links` (list).
- Bulk multi-item: `POST /projects/{project_id}/share/multi` (creates one link spanning the items;
  returns `ShareLinkResponse` with `url`).
- People-share for folders (kept): `POST /folders/{id}/share/user` · `/share/team` ·
  `GET /folders/{id}/direct-shares`.
- PATCH `/share/{token}` updates any link's `permission` / `allow_download` / `is_enabled`.

### The base to generalize — `SingleLinkSection` (created by Plan 015)

Plan 015 adds `SingleLinkSection({ assetId })` in `components/review/share-dialog.tsx`: it loads the
asset's one link (creating it if absent), shows the URL + Copy + a `PermissionSelect` + Allow-download,
and PATCHes on change. This plan generalizes it to any target.

### Conventions

- Tailwind + `cn()`; `api.get/post/patch` from `@/lib/api`; `lucide-react` icons.
- Reuse Plan 015's `PermissionSelect`, `CopyButton`, and the generalized `SingleLinkSection`. Keep the
  reviewer-safe `…/share/{token}` URL.

## Commands you will need

| Purpose | Command (repo root) | Expected |
|---------|---------------------|----------|
| Install web deps | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Build (catches dangling imports) | `cd apps/web && pnpm build` | exit 0 |
| Find leftover refs | `grep -rn "ShareCreateDialog\|share-create-dialog" apps/web` | no results at the end |

## Scope

**In scope**:
- Generalize `SingleLinkSection` to accept a target: `{ kind: 'asset' \| 'folder' \| 'project', id }`
  (load/create against the matching endpoints).
- A reusable `SharePanel` (dropdown/popover) used by asset, folder, and project Share entry points:
  `SingleLinkSection` + people-share (where applicable).
- A minimal **bulk** create-and-copy panel for multi-asset selections (`POST /projects/{id}/share/multi`
  → show link + Copy).
- Rewire the project page's folder/project/bulk triggers to the new panels; remove the
  `ShareCreateDialog` mount + `shareDialog*` state that only fed it.
- **Delete** `apps/web/components/projects/share-create-dialog.tsx`.

**Out of scope**:
- `apps/api/**` — no backend change.
- The public share viewer; the review-page asset Share button (Plan 015 already did it — you only
  generalize the shared `SingleLinkSection`).
- Folder/project *people-share* backend semantics — reuse the existing endpoints.

## Git workflow

- Branch: `advisor/019-single-link-folder-project-bulk-share`
- Conventional commit (e.g. `feat(web): single-link sharing for folders/projects/bulk; remove ShareCreateDialog`).
- Do NOT push unless instructed.

## Steps

### Step 1: Generalize `SingleLinkSection` to a target

Change `SingleLinkSection` (from Plan 015) to take a target instead of a bare `assetId`:

```tsx
type ShareTarget =
  | { kind: 'asset'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'project'; id: string };

const LIST_PATH: Record<ShareTarget['kind'], (id: string) => string> = {
  asset: (id) => `/assets/${id}/share`,
  folder: (id) => `/folders/${id}/shares`,
  project: (id) => `/projects/${id}/share-links`,
};
const CREATE_PATH: Record<ShareTarget['kind'], (id: string) => string> = {
  asset: (id) => `/assets/${id}/share`,
  folder: (id) => `/folders/${id}/share`,
  project: (id) => `/projects/${id}/share`,
};
```

Use `LIST_PATH[target.kind](target.id)` to load and `CREATE_PATH[...]` to create; the list-response
shape differs slightly per endpoint (asset/folder return `{ share_links: [...] }` or a bare list — check
each: `GET /folders/{id}/shares` and `GET /projects/{id}/share-links` return a **list**, while the asset
list returns `{ share_links }`). Normalise to "first enabled link, else create one". Everything else
(URL + Copy + `PermissionSelect` PATCH + Allow-download) is unchanged from 015.

Keep a thin `SingleLinkSection({ assetId })` wrapper (or update the asset call site to pass
`{ kind:'asset', id: assetId }`) so Plan 015's asset Share button keeps working.

**Verify**: `grep -n "ShareTarget" apps/web/components/review/share-dialog.tsx` → match; the asset Share
button still renders a link (manual).

### Step 2: A reusable `SharePanel`

Extract the dropdown panel (from 015's `ShareDialog`) into a `SharePanel({ target, projectId, withPeople })`
that renders `SingleLinkSection` + (when `withPeople`) the people-share section. Use it for:
- asset Share button (existing, `withPeople`),
- folder Share (people-share uses the folder endpoints),
- project Share (link only, or people if desired).

**Verify**: `grep -n "function SharePanel" apps/web/components/review/share-dialog.tsx` (or wherever you
place it) → match.

### Step 3: Minimal bulk multi-asset panel

For a selection of N assets/folders, render a small panel that, on open, POSTs once to
`/projects/{projectId}/share/multi` with the selected item ids, then shows the returned link + Copy +
`PermissionSelect` (PATCH). No phases, no list. Title it e.g. "Share N items".

**Verify**: `grep -n "share/multi" apps/web/components` → exactly one create call in the new bulk panel.

### Step 4: Rewire the project page; remove the dialog

In `apps/web/app/(dashboard)/projects/[id]/page.tsx`:
- Replace the `onFolderShare` trigger to open the folder `SharePanel` (target `{kind:'folder'}`), the
  bulk `onCreateShareLink` trigger to open the bulk panel, and the project-share trigger to open the
  project `SharePanel`.
- Remove the `<ShareCreateDialog … />` mount (line ~1200), the `import { ShareCreateDialog }` (line ~50),
  and the `shareDialog*` state that only fed it (`shareDialogOpen`, `shareDialogPreselect`,
  `shareDialogPreselectedItems`, `shareDialogResult`) — unless you reuse some of that state to drive the
  new panels (your choice; keep it minimal and consistent).

**If the folder/bulk/project triggers are deeply entangled** with the dialog's phased state in a way
that can't be cleanly swapped, STOP and report the structure — propose a smaller first slice (e.g.
folder + project only, bulk deferred) rather than forcing it.

**Verify**: `grep -n "ShareCreateDialog" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → **no** matches.

### Step 5: Delete `ShareCreateDialog` and build

```
git rm apps/web/components/projects/share-create-dialog.tsx
grep -rn "ShareCreateDialog\|share-create-dialog" apps/web   # must be empty
cd apps/web && pnpm install --frozen-lockfile && pnpm build  # exit 0
```

**Verify**: the grep is empty and `pnpm build` exits 0.

## Test plan

- **Automated gate**: Step 1–5 greps (no `ShareCreateDialog` references) + a clean `pnpm build`.
- **Manual (if you can run it)**:
  1. **Folder**: open a folder's Share → one link + access toggle + Copy; reopen → same link persists.
  2. **Project**: project-level Share → one link.
  3. **Bulk**: select 2+ assets → Share selection → one link covering them; Copy works; opening it shows
     those items.
  4. **Asset** (regression of 015): asset Share still shows the single link + people-share.
  5. No "New Share Link" / multi-phase create dialog appears anywhere.

## Done criteria

ALL must hold:

- [ ] `grep -rn "ShareCreateDialog\|share-create-dialog" apps/web` → **no** results (component deleted, no importers)
- [ ] `grep -n "ShareTarget" apps/web/components/review/share-dialog.tsx` → match (generalized link section)
- [ ] `grep -n "share/multi" apps/web/components` → exactly one (the bulk panel)
- [ ] `cd apps/web && pnpm build` exits 0
- [ ] No `apps/api/**` files changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report if:

- Plan 015 has **not** landed (no `SingleLinkSection` in `share-dialog.tsx`) — do 015 first.
- The folder/project/multi endpoints differ from "Current state" (the load/create calls would be wrong).
- The project page's folder/bulk/project triggers can't be cleanly swapped off `ShareCreateDialog`'s
  phased state — report and propose a smaller slice.
- **Bulk decision**: if implementing the minimal bulk panel reveals that `/projects/{id}/share/multi`
  needs inputs you can't supply cleanly (or product would rather drop ad-hoc multi-asset share), STOP
  and confirm the bulk direction before proceeding (see "Key decision").

## Maintenance notes

- This completes the Drive-style sharing model end to end (asset + folder + project + selection), all on
  the single-link panel. Any new shareable entity should reuse `SingleLinkSection`/`SharePanel` with a
  new `ShareTarget` kind + its two endpoints — do not reintroduce a phased dialog.
- Backend still supports multiple links per entity; the UI just surfaces one. Server-side enforcement
  (uniqueness) remains a separate, optional change.
- The bulk panel is intentionally the only place that uses `ShareLinkItem` / `share/multi`. If ad-hoc
  multi-asset sharing is later dropped, that endpoint + model become removable (a backend cleanup plan).
- Reviewer should scrutinise: no backend change; people-share preserved for asset + folder; the link
  shown is always the reviewer-safe `…/share/{token}`; and the build has zero `ShareCreateDialog` refs.
