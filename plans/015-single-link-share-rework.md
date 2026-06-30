# Plan 015: Rework sharing to a single Google-Drive-style link per asset (remove multi-link UI)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. When done, update the status row for
> this plan in `plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index. This plan **deletes several component files** — do it
> exactly as listed and run the build to catch any dangling import.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- apps/web/components/review/share-dialog.tsx "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/api/routers/share.py`
> If `share-dialog.tsx` or `page.tsx` changed, compare the "Current state" notes
> before editing; on a mismatch, STOP.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P1
- **Effort**: L (multi-file frontend rework + file deletions)
- **Risk**: MED (removes UI surfaces; build + manual smoke are the guard)
- **Depends on**: none. Decision recorded by the maintainer: **full cleanup**, **keep people-share**.
- **Category**: feature / UX (sharing)
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

Sharing today is a power-user, multi-link system: a Share dropdown that creates **multiple** links per
asset, an "add this asset to an existing link" list, a separate create-dialog, and a standalone
**share-management section** in the project page (a links table + a detail pane + an activity log).
Reviewers and editors found this confusing. The maintainer chose a **Google-Drive/Dropbox model**:

> Press **Share** → if no link exists, create a default one → show the link with an **access toggle**
> (view/comment) and a **Copy** button. One link per asset. Keep "share with specific people".

This plan rewires the **frontend** to that model and removes the multi-link UI. The backend is left
unchanged (it can still hold multiple links; the UI simply creates/uses one) — so this is a UI rework,
not a data migration.

## Revision (2026-06-29) — why ShareCreateDialog is NOT deleted

An earlier version of this plan deleted `share-create-dialog.tsx`. An executor blocked on it three
times — correctly. `ShareCreateDialog` is **dual-use**: besides the per-asset Share button, the project
page (`projects/[id]/page.tsx:1200`) mounts it for **folder share**, **multi-asset (bulk) share**, and
project-level share (`onFolderShare`, `onCreateShareLink`). Deleting it would break those flows, which
are out of scope (the maintainer's request #3 was about the *per-asset* link). **Resolution: keep
`ShareCreateDialog`.** The per-asset Share button stops using it (replaced by `SingleLinkSection`); the
folder/bulk/project share paths keep using it unchanged. The management section (table/detail/activity)
does **not** depend on it and is still removed.

## Decisions (locked by the maintainer)

- **One link per asset**, auto-created on first Share, with an access toggle + copy. ✔
- **Remove** the per-asset multi-link UI (the "add to existing links" list + the create-dialog mount
  *from the asset Share button*) and the standalone share-management section (links table / detail /
  activity). ✔
- **Keep** `ShareCreateDialog` (the component) as the **folder / multi-asset / project** share creator —
  only the *per-asset* Share button stops using it. ✔
- **Keep** "share with specific people" (direct user/team share) as a secondary section. ✔

## Current state

### The Share entry point — `apps/web/components/review/share-dialog.tsx`

`ShareDialog` renders a **Share** button → a dropdown with a **“New Share Link”** button + an **“Add to
Existing Share Links”** searchable list (driven by `useShareLinks(projectId)`), and mounts
`<ShareCreateDialog … />` for creating links. The file also defines reusable pieces this plan **keeps**:
`PermissionSelect`, `CopyButton`, and `DirectTab` (the people-share form using
`/assets/{id}/share/user` and `/assets/{id}/share/team`). It also defines `LinkTab` (a multi-link
generator) which this plan **replaces**.

### Backend endpoints this plan uses (already exist — do NOT change them)

From `apps/api/routers/share.py`:
- `POST /assets/{asset_id}/share` → create a link. Body accepts `permission`, `allow_download`,
  optional `password`, `expires_at`. Returns `{ share_link: ShareLink & { url } }` (201).
- `GET /assets/{asset_id}/shares` → list this asset's links (`list[ShareLinkResponse]`, each with `url`).
- `PATCH /share/{token}` → update a link (e.g. `{ permission }`, `{ allow_download }`,
  `{ is_enabled }`). Returns the updated link.
- People-share (unchanged, used by `DirectTab`): `POST /assets/{id}/share/user`,
  `POST /assets/{id}/share/team`, and the current-shares list it already reads.

### The standalone share-management section — `apps/web/app/(dashboard)/projects/[id]/page.tsx`

The project page imports and renders the management UI:
- `import { ShareLinksTable } from "@/components/projects/share-links-table";` (line ~44)
- `import { useShareLinks } from "@/hooks/use-share-links";` (line ~42)
- `<ShareLinksTable … />` rendered in a "share links" view (around line ~632), gated by page state
  (e.g. `showShareLinks` / `selectedShareLink`, set in `handleSelectFolder` near line ~368).

### Components to delete (management section only — NOT the create-dialog)

- `apps/web/components/projects/share-links-table.tsx`
- `apps/web/components/projects/share-link-detail.tsx` (imported by `projects/[id]/page.tsx:48`)
- `apps/web/components/projects/share-link-activity.tsx` (nested under detail)

**Do NOT delete `apps/web/components/projects/share-create-dialog.tsx`** — the project page still mounts
it for folder/bulk/project sharing (`page.tsx:1200`). Verified: the three files above do not import
`ShareCreateDialog`, so deleting them is independent.

### Conventions

- Tailwind + `cn()`; `lucide-react` icons; `api` client from `@/lib/api` (`api.get/post/patch`).
- Keep the existing dropdown/portal styling already in `share-dialog.tsx` (the `Share` button + the
  absolutely-positioned panel) — reuse it; just change the panel's contents.

## Commands you will need

| Purpose | Command (repo root) | Expected |
|---------|---------------------|----------|
| Install web deps | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Build (catches dangling imports after deletions) | `cd apps/web && pnpm build` | exit 0 |
| Find leftover references | `grep -rn "ShareCreateDialog\|ShareLinksTable\|ShareLinkDetail\|ShareLinkActivity\|share-link-activity\|useShareLinks" apps/web` | only expected hits |

## Scope

**In scope**:
- **Rewrite** `apps/web/components/review/share-dialog.tsx` to the single-link model (keep
  `PermissionSelect`, `CopyButton`, `DirectTab`; replace `LinkTab` + the multi-link dropdown).
- **Edit** `apps/web/app/(dashboard)/projects/[id]/page.tsx` to remove **only** the share-management
  section (the `ShareLinksTable` + `ShareLinkDetail` view + its triggering state + the `useShareLinks`
  and `share-link-detail` imports). **Keep** the `ShareCreateDialog` mount (line ~1200) and the
  folder/bulk/project share wiring (`onFolderShare`, `onCreateShareLink`, `shareDialogOpen`,
  `shareDialogPreselect…`).
- **Delete** the three management components listed above (NOT `share-create-dialog.tsx`).
- Optionally delete `apps/web/hooks/use-share-links.ts` **iff** no file imports it after the edits.

**Out of scope** (do NOT touch):
- `apps/api/**` — no backend change. The endpoints stay; the UI just uses one link. Do not delete
  routes or models.
- `apps/web/components/projects/share-create-dialog.tsx` — **keep it**; the project page's
  folder/bulk/project share still uses it. This plan only stops the *asset* Share button from using it.
- The project page's folder-share / bulk-share / project-share flows — leave them exactly as they are.
- The public share viewer `apps/web/app/share/[token]/page.tsx` (Plans 001/013).

## Git workflow

- Branch: `advisor/015-single-link-share-rework`
- Conventional commit (e.g. `feat(web): single Drive-style share link per asset; remove multi-link UI`).
- Do NOT push unless instructed.

## Steps

### Step 1: Replace `LinkTab` with a single-link section in `share-dialog.tsx`

Keep `PermissionSelect`, `CopyButton`, and `DirectTab` exactly as they are. **Remove** the `LinkTab`
function and add this `SingleLinkSection` (it loads the asset's one link, creating it on first open, and
edits access in place):

```tsx
interface SingleLinkSectionProps {
  assetId: string;
}

interface ShareLinkResponse {
  share_link: ShareLink & { url: string };
}
interface ShareLinksListResponse {
  share_links: (ShareLink & { url?: string })[];
}

function SingleLinkSection({ assetId }: SingleLinkSectionProps) {
  const [link, setLink] = React.useState<(ShareLink & { url?: string }) | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load the asset's existing link, or create a default one if none exists.
  React.useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await api.get<ShareLinksListResponse>(`/assets/${assetId}/share`);
        const existing = (res.share_links ?? []).find((l) => l.is_enabled) ?? res.share_links?.[0];
        if (existing) {
          if (!cancelled) setLink(existing);
        } else {
          const created = await api.post<ShareLinkResponse>(`/assets/${assetId}/share`, {
            permission: "comment",
            allow_download: false,
          });
          if (!cancelled) setLink(created.share_link);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load share link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId]);

  const url =
    link?.url ??
    (link ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}` : "");

  async function patchLink(updates: Record<string, unknown>) {
    if (!link) return;
    setSaving(true);
    setError(null);
    const prev = link;
    setLink({ ...link, ...updates } as typeof link); // optimistic
    try {
      const updated = await api.patch<ShareLink & { url?: string }>(`/share/${link.token}`, updates);
      setLink({ ...updated, url: prev.url ?? updated.url });
    } catch (e) {
      setLink(prev); // rollback
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        <span className="text-xs text-text-tertiary">Preparing share link…</span>
      </div>
    );
  }
  if (!link) {
    return <p className="text-xs text-status-error py-2">{error ?? "No share link"}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-text-tertiary shrink-0" />
        <span className="text-sm font-medium text-text-primary">Anyone with the link</span>
        <div className="ml-auto">
          <PermissionSelect
            value={link.permission}
            onChange={(p) => patchLink({ permission: p })}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2">
        <span className="flex-1 truncate font-mono text-xs text-text-primary">{url}</span>
        <CopyButton text={url} />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!link.allow_download}
          onChange={(e) => patchLink({ allow_download: e.target.checked })}
          disabled={saving}
          className="rounded border-border"
        />
        <span className="text-sm text-text-secondary">Allow download</span>
      </label>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
```

**Verify**: `grep -n "SingleLinkSection" apps/web/components/review/share-dialog.tsx` → ≥ 2 matches; and
`grep -n "function LinkTab" apps/web/components/review/share-dialog.tsx` → **no** match.

### Step 2: Rewrite the `ShareDialog` body to drop the multi-link dropdown

Replace the `ShareDialog` component's dropdown contents so it shows the single link section + the
people-share section, and **remove** `useShareLinks`, the `filteredLinks`/`handleAddToLink`/search
state, the “New Share Link”/“Add to Existing Share Links” UI, and the `<ShareCreateDialog … />` mount.
The new dropdown body:

```tsx
        {dropdownOpen && (
          <div
            className={cn(
              "absolute right-0 top-full mt-1.5 z-50 w-80",
              "rounded-xl border border-border bg-bg-elevated shadow-xl p-3 space-y-4",
              "animate-in fade-in-0 zoom-in-95 duration-150",
            )}
          >
            <SingleLinkSection assetId={assetId} />
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-text-secondary">Share with people</p>
              <DirectTab assetId={assetId} orgId={projectId} />
            </div>
          </div>
        )}
```

Keep the existing `Share` button, the outside-click/Escape close effects, and `dropdownRef`. Remove the
now-unused imports **from this file** (`Plus`, `Search`, `useShareLinks`, `ShareCreateDialog`,
`ShareLinkListItem`) — the build (Step 5) will flag any you miss. Note: removing the `ShareCreateDialog`
*import here* does not delete the component; the project page still imports and uses it (folder/bulk
share). `DirectTab`'s `orgId` prop: it currently expects an org id for
team loading; pass `projectId` as today's code does at the call site (the existing `DirectTab` already
handles a missing/!orgId gracefully).

**Verify**:
- `grep -n "useShareLinks\|ShareCreateDialog\|Add to Existing" apps/web/components/review/share-dialog.tsx` → **no** matches
- `grep -n "SingleLinkSection assetId={assetId}" apps/web/components/review/share-dialog.tsx` → match

### Step 3: Remove the share-management section from the project page

In `apps/web/app/(dashboard)/projects/[id]/page.tsx`, remove **only the management section** — leave the
`ShareCreateDialog` mount and the folder/bulk/project share wiring intact:

- Remove `import { ShareLinksTable } …` (line ~44), `import { useShareLinks } …` (line ~42), and the
  `share-link-detail` import (line ~48).
- Remove the `<ShareLinksTable … />` render block (around line ~632) and the `ShareLinkDetail` render,
  plus the page state that gates the management view (`showShareLinks` / `selectedShareLink` /
  `setShowShareLinks` and any nav item that switches into the share-links view — grep `showShareLinks`
  and `selectedShareLink`).
- Remove the now-unused `useShareLinks(...)` call and its destructured values.
- **KEEP**: the `<ShareCreateDialog … />` mount (line ~1200), `shareDialogOpen` / `setShareDialogOpen` /
  `shareDialogPreselect` / `shareDialogPreselectedItems`, and the `onFolderShare` / `onCreateShareLink`
  handlers passed to `AssetGrid`. These power folder/bulk/project sharing and are out of scope.

Work by **grepping** the file for each removed symbol and removing its declaration + uses together; the
build catches leftovers. **If the management view isn't a cleanly separable branch** (it's interwoven
with folder/asset rendering), STOP and report the structure — do not rewrite unrelated page logic.

**Verify**: `grep -n "ShareLinksTable\|useShareLinks\|showShareLinks\|ShareLinkDetail" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → **no** matches; and
`grep -n "ShareCreateDialog" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → **still present** (kept).

### Step 4: Delete the dead components

```
git rm apps/web/components/projects/share-links-table.tsx \
       apps/web/components/projects/share-link-detail.tsx \
       apps/web/components/projects/share-link-activity.tsx
```

(Do **not** `git rm` `share-create-dialog.tsx` — it stays.)

Then check no importer remains for the deleted three:
`grep -rn "share-links-table\|share-link-detail\|share-link-activity\|ShareLinksTable\|ShareLinkDetail\|ShareLinkActivity" apps/web`
→ must return **no** results. (`ShareCreateDialog` / `share-create-dialog` references are expected to
remain — the project page keeps using it.) If a *deleted* component is still imported somewhere
unexpected, STOP and report.

If `grep -rn "useShareLinks" apps/web` is now empty, also `git rm apps/web/hooks/use-share-links.ts`.

**Verify**: `git -C /Users/neyako/freeframed status --porcelain | grep -E "^D|^ D"` lists the deleted files.

### Step 5: Build (the real gate for the deletions)

**Verify**: `cd apps/web && pnpm install --frozen-lockfile && pnpm build` → exit 0. A dangling import to
a deleted component fails here — fix the reference (don't restore the file) or, if it reveals an
unforeseen consumer, STOP and report.

## Test plan

- **Automated gate**: the Step 1–4 greps (no leftover references) + a clean `pnpm build`. This is the
  primary guard because the change spans deletions.
- **Manual (if you can run it)**:
  1. Open an asset's review page, click **Share**. On first open it shows **one** link (auto-created),
     an access dropdown (view/comment/approve), an **Allow download** toggle, and a **Copy** button.
  2. Change the access dropdown → reopen Share → the new permission persists (PATCH worked).
  3. **Copy** puts the `…/share/{token}` URL on the clipboard; opening it loads the reviewer view.
  4. **Share with people** still works (add a user by email).
  5. The project page no longer shows a share-links management table/section anywhere.

## Done criteria

ALL must hold:

- [ ] `grep -n "SingleLinkSection" apps/web/components/review/share-dialog.tsx` → match; `grep -n "function LinkTab" …` → no match
- [ ] `grep -n "useShareLinks\|ShareCreateDialog\|Add to Existing" apps/web/components/review/share-dialog.tsx` → no matches
- [ ] `grep -n "ShareLinksTable\|useShareLinks\|showShareLinks\|ShareLinkDetail" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → no matches
- [ ] `grep -n "ShareCreateDialog" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → **still present** (folder/bulk share kept)
- [ ] The three management components are deleted; `grep -rn "share-links-table\|share-link-detail\|share-link-activity" apps/web` → no results; `share-create-dialog.tsx` still exists
- [ ] `cd apps/web && pnpm build` exits 0
- [ ] No `apps/api/**` files changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 015 updated

## STOP conditions

Stop and report if:

- `GET /assets/{id}/shares` or `POST /assets/{id}/share` no longer returns the shape in "Current state"
  (the single-link load/create would break).
- Removing the project-page share section is not a cleanly separable branch (it's interwoven with
  folder/asset rendering) — report the structure; do not rewrite unrelated logic.
- One of the **three deleted** management components (`share-links-table` / `share-link-detail` /
  `share-link-activity`) is imported somewhere outside the project page — report the consumer; do not
  delete blindly. (Note: `ShareCreateDialog` is intentionally **kept** — do not delete it even though the
  asset Share button stops using it.)
- `DirectTab` turns out to depend on something removed (it should not) — report instead of refactoring it.

## Maintenance notes

- **Backend unchanged on purpose**: the API still supports multiple links per asset; the UI just
  creates/uses one. If product later wants to *enforce* one link server-side, that's a separate backend
  plan (dedupe + a uniqueness constraint) — don't do it here.
- The auto-create on first Share means every asset that's ever been "Shared" gets one link row. That's
  the Drive model (a link exists once you open the share UI). If you want creation to be lazier (only on
  explicit copy), move the `POST` out of the effect into the Copy handler.
- Folder/project share entry points (if any remain) were intentionally left alone. If they still open a
  removed dialog, fold them into this single-link model in a follow-up.
- Reviewer should scrutinise: no backend routes/models deleted; `DirectTab` (people-share) preserved;
  the build passes with zero dangling imports; and the share link shown is the reviewer-safe
  `…/share/{token}` URL.
