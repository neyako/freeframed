# Plan 030: Restore full share-link controls in the Share popup — visibility, passphrase, expiry, watermark, and a revoke action — styled like the old "Configure Share Link" panel

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- apps/web/components/review/share-link-controls.tsx apps/web/components/review/share-link-section.tsx apps/web/components/review/share-targets.ts apps/web/components/review/share-permission-select.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

The single-link Share popup (introduced by plan 015) was stripped down to just an
access dropdown, a copy field, an "Allow download" checkbox, and a collapsible
"Invite specific people" section. As a result:

- **There is no way to revoke a share link.** Once created, the public URL lives
  forever with no delete/disable control in the UI.
- **The link is always Public.** There is no visibility control, so a user can't
  require sign-in, set a passphrase, an expiry, or a watermark — all of which the
  backend already supports.
- The popup looks like raw default form controls rather than the previous
  polished "Configure Share Link" panel (icon-labelled rows with toggles).

The backend already exposes every needed capability (`PATCH /share/{token}` and
`DELETE /share/{token}`). This plan surfaces them in the popup and restyles it to
match the old configure-panel aesthetic.

## Current state

### Backend capabilities (already implemented — do not change)

`apps/api/routers/share.py`:
- `PATCH /share/{token}` (line 467, `update_share_link`) accepts a
  `ShareLinkUpdate` body and applies any subset of these fields:
  `title, description, permission, visibility, is_enabled, show_versions,
  show_watermark, appearance, password, expires_at, allow_download`
  (`apps/api/schemas/share.py:110-121`). Passing `password: ""` clears the
  passphrase; a non-empty string sets it.
- `DELETE /share/{token}` (line 506, `revoke_share_link`) soft-deletes the link
  (sets `deleted_at`) → 204. After this the token no longer validates.
- `visibility` is a plain string; only two values are meaningful:
  `"public"` (anyone with the link) and `"secure"` (viewer must be signed in —
  the validate endpoint returns `requires_auth` for it). Model default is
  `"public"` (`apps/api/models/share.py:37`).
- `GET /assets/{id}/shares` and `GET /folders/{id}/shares` return
  `list[ShareLinkResponse]`, which includes `visibility, is_enabled,
  allow_download, show_versions, show_watermark, expires_at, has_password`
  (`apps/api/schemas/share.py:64-83`). So the data to populate the controls is
  already fetched.

### `apps/web/components/review/share-targets.ts`

`ShareLinkCandidate` / `ManagedShareLink` are missing the new fields:

```ts
export interface ShareLinkCandidate {
  readonly id: string;
  readonly token: string;
  readonly title: string;
  readonly description: string | null;
  readonly permission: SharePermission;
  readonly is_enabled: boolean;
  readonly allow_download?: boolean;
  readonly show_versions?: boolean;
  readonly url?: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly project_id?: string | null;
}

export interface ManagedShareLink extends ShareLinkCandidate {
  readonly allow_download: boolean;
}
```

### `apps/web/components/review/share-link-section.tsx`

`patchLink` only permits `permission | allow_download`, and there is no revoke:

```tsx
  async function patchLink(
    updates: Partial<Pick<ManagedShareLink, "permission" | "allow_download">>,
  ) {
    if (!link) return;
    const previous = link;
    setSaving(true);
    setError(null);
    setLink({ ...link, ...updates });
    try {
      const updated = await api.patch<ShareLinkCandidate>(
        `/share/${link.token}`,
        updates,
      );
      setLink(withLinkDefaults({ ...updated, url: previous.url ?? updated.url }));
    } catch (err) {
      setLink(previous);
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }
```

The `api` client is `apps/web/lib/api.ts` — it exposes `api.get/post/patch` and
also `api.delete` (confirm the method name with
`grep -n "delete\|del(" apps/web/lib/api.ts` before use; if it is named `del`,
use that).

### `apps/web/components/review/share-link-controls.tsx`

`LinkControls` currently renders: an "Anyone with the link" header with a
`PermissionSelect`, the URL + copy row, and an "Allow download" checkbox. This is
the component to restyle and extend.

### `apps/web/components/review/share-permission-select.tsx`

A radix-based select used for the permission dropdown. **Use it as the structural
exemplar** for a new visibility select — same `Select.Root/Trigger/Content/Item`
shape and the same Tailwind classes.

### Design reference — the target panel

The old "Configure Share Link" panel was a vertical list of icon-labelled rows,
each `flex items-center justify-between`, with the control on the right (a select,
a toggle, or a date input), and a primary/secondary action row at the bottom.
Reproduce that layout inside the popup. There is **no** shared Switch component
(`apps/web/components/ui/` has only `button`, `input`, `confirm-dialog`), so
build a small toggle inline (see Step 4). A confirm dialog exists at
`apps/web/components/ui/confirm-dialog.tsx` — use it for the revoke confirmation.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |

## Scope

**In scope**:
- `apps/web/components/review/share-targets.ts` (widen types)
- `apps/web/components/review/share-link-section.tsx` (widen patch, add revoke/create)
- `apps/web/components/review/share-link-controls.tsx` (restyle + new controls)
- `apps/web/components/review/share-visibility-select.tsx` (**create** — mirror the permission select)

**Out of scope** (do NOT touch):
- Any backend file — the API already supports all of this.
- `apps/web/components/review/share-dialog.tsx` and `share-direct-panel.tsx` — the
  popup shell and people-invite section are fine; only the link section changes.
- The bulk-share panel (`share-bulk-panel.tsx`) — different flow, leave it.

## Git workflow

- Branch: `advisor/030-share-popup-visibility-revoke-restyle`
- Conventional commits, e.g. `feat(web): restore visibility/passphrase/expiry/revoke controls in share popup`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Widen the share-link types

In `share-targets.ts`, add the fields the controls need to `ShareLinkCandidate`
(all optional to stay compatible with list/create responses):

```ts
export interface ShareLinkCandidate {
  readonly id: string;
  readonly token: string;
  readonly title: string;
  readonly description: string | null;
  readonly permission: SharePermission;
  readonly is_enabled: boolean;
  readonly allow_download?: boolean;
  readonly show_versions?: boolean;
  readonly show_watermark?: boolean;
  readonly visibility?: string;
  readonly expires_at?: string | null;
  readonly has_password?: boolean;
  readonly url?: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly project_id?: string | null;
}
```

Leave `ManagedShareLink` extending it (it already narrows `allow_download`).

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Widen `patchLink` and add revoke + create-link to `SingleLinkSection`

In `share-link-section.tsx`:

1. Change `patchLink`'s parameter type from
   `Partial<Pick<ManagedShareLink, "permission" | "allow_download">>` to
   `Partial<Pick<ManagedShareLink, "permission" | "allow_download" | "visibility" | "show_watermark" | "expires_at" | "is_enabled">> & { password?: string }`.
   The body/optimistic-update logic stays the same (it already spreads `updates`).
   Note: `password` is write-only — after patch, refetch details or just drop it
   from the optimistic `setLink` (do not store the raw password on `link`).

2. Add a `revokeLink` function:
   ```tsx
   async function revokeLink() {
     if (!link) return;
     setSaving(true);
     setError(null);
     try {
       await api.delete(`/share/${link.token}`); // use api.del(...) if that is the method name
       setLink(null);
     } catch (err) {
       setError(err instanceof Error ? err.message : "Failed to revoke");
     } finally {
       setSaving(false);
     }
   }
   ```

3. Add a `createLink` function that re-runs the existing `loadOrCreateLink` flow so
   the user can mint a fresh link after revoking (reuse the same `requestTarget`
   construction already in the effect; extract it into a helper or inline):
   ```tsx
   async function createLink() {
     setSaving(true);
     setError(null);
     try {
       const created = await loadOrCreateLink(requestTargetFor(target));
       setLink(created);
     } catch (err) {
       setError(err instanceof Error ? err.message : "Failed to create link");
     } finally {
       setSaving(false);
     }
   }
   ```
   (Add a small `requestTargetFor(target: ShareTarget): ShareTarget` helper that
   returns the same shape the effect builds, or inline it.)

4. When `link` is `null` **and** not loading and no error, render an explicit empty
   state with a "Create share link" button that calls `createLink()`, instead of
   the current `"No share link"` error text. This is what makes the link no longer
   "always public": after revoke, no link exists until the user creates one.

5. Pass the new callbacks and the widened `onPatch` down to `LinkControls`.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0; `grep -n "revokeLink\|createLink" apps/web/components/review/share-link-section.tsx` → matches.

### Step 3: Create the visibility select

Create `apps/web/components/review/share-visibility-select.tsx` by copying the
structure of `share-permission-select.tsx` exactly (same radix `Select` markup and
classes), but with two options:

- value `"public"` → label "Anyone with the link"
- value `"secure"` → label "Signed-in users only"

Export `VisibilitySelect({ value, onChange, disabled })` where `value: string`,
`onChange: (v: string) => void`. Default the trigger to show "Anyone with the
link" when `value` is undefined/`"public"`.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 4: Rebuild `LinkControls` as the configure panel

Rewrite `share-link-controls.tsx` so `LinkControls` renders, in this order,
each as an icon-labelled `flex items-center justify-between` row (match the app's
existing spacing/typography — `text-sm text-text-secondary` labels,
`text-text-tertiary` icons, `space-y-3`/`space-y-4` between rows):

1. **Copy URL row** — keep the existing `getShareUrl` + `CopyButton` field.
2. **Access** — label "Access" with the existing `PermissionSelect`
   (`onPatch({ permission })`).
3. **Visibility** — label "Visibility" with the new `VisibilitySelect`
   (`onPatch({ visibility })`); read current value from `link.visibility`.
4. **Allow download** — toggle bound to `link.allow_download`
   (`onPatch({ allow_download: next })`).
5. **Passphrase** — a toggle; when ON, reveal a password `<input>` and commit on
   blur/change via `onPatch({ password })`; when toggled OFF, `onPatch({ password: "" })`.
   Use `link.has_password` for the toggle's initial on/off state.
6. **Expiration date** — a `<input type="date">` styled like
   `apps/web/components/ui/input.tsx`; on change, `onPatch({ expires_at })`
   (send an ISO string; empty clears it with `expires_at: null`). Prefill from
   `link.expires_at` (format to `yyyy-MM-dd`).
7. **Watermark** — toggle bound to `link.show_watermark`
   (`onPatch({ show_watermark: next })`).
8. **Revoke** — at the bottom, a destructive text button "Revoke link" that opens
   the `ConfirmDialog` (`apps/web/components/ui/confirm-dialog.tsx`) and on confirm
   calls the `onRevoke` prop passed from `SingleLinkSection`.

Inline toggle shape (no shared Switch component exists) — reuse this for the three
toggles:

```tsx
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-bg-tertiary",
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}
```

Update `LinkControlsProps` to add `onRevoke: () => void` and widen `onPatch` to the
same type as `patchLink`'s parameter in Step 2.

**Verify**: `cd apps/web && grep -n "Visibility\|Passphrase\|Watermark\|Revoke link" apps/web/components/review/share-link-controls.tsx` → matches for all four.

### Step 5: Full verification

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass (see Test plan — you may need to update `share-dialog.test.tsx`)

## Test plan

- There is an existing test `apps/web/components/review/__tests__/share-dialog.test.tsx`.
  Run it first (`cd apps/web && pnpm test share-dialog`). It likely asserts the old
  minimal popup contents ("Anyone with the link", the permission select, "Allow
  download"). Update its assertions to the new panel (the copy field + "Access" +
  "Visibility" rows still render; add coverage that a "Revoke link" control is
  present). Keep it green.
- Add one new test case (in the same file or a sibling) asserting that toggling
  the passphrase toggle reveals a password input. Model it on the existing render
  test's setup (mock `api.get` to return one enabled link, render `<ShareDialog>`,
  open the dropdown).
- Verification: `cd apps/web && pnpm test` → all pass, including the updated/added cases.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0 (share-dialog test updated & green)
- [ ] `share-visibility-select.tsx` exists and is imported by `share-link-controls.tsx`
- [ ] `grep -rn "Revoke link" apps/web/components/review/` → at least one match
- [ ] `grep -rn "api.delete\|api.del" apps/web/components/review/share-link-section.tsx` → one match (revoke wired to DELETE)
- [ ] Only the four in-scope files are modified/created (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live files (drift since `30e5364`).
- `apps/web/lib/api.ts` exposes neither `delete` nor `del` — report so the revoke
  call can be added correctly (do not invent a method).
- The asset/folder `…/shares` list response does not actually contain
  `visibility` / `has_password` / `expires_at` at runtime (check the network shape
  or `_share_link_response` in `apps/api/routers/share.py`) — if a field is
  missing, the corresponding control should read a sensible default rather than
  crash; note which fields were absent.
- Updating `share-dialog.test.tsx` requires reworking more than its assertions
  (e.g. the mock harness no longer matches) — report before rewriting the test.

## Maintenance notes

- Visibility currently has two meaningful values (`public`, `secure`); if the
  backend adds more (e.g. `password`-as-visibility), extend `VisibilitySelect`.
- Passphrase, expiry, and watermark all round-trip through `PATCH /share/{token}`;
  a reviewer should confirm each control's value survives closing and reopening
  the popup (i.e. the `…/shares` list rehydrates them).
- After "Revoke link", the section shows an explicit "Create share link" empty
  state — confirm the old URL 404s/410s and the new one is a different token.
- Reviewer should scrutinize the optimistic update in `patchLink` for the
  write-only `password` field: it must never be stored back onto `link` state.
