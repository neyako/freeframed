# Plan 028: Make the project detail page usable on mobile (navigator bar + grid columns + toolbar actions)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- apps/web/components/projects/asset-grid.tsx apps/web/app/(dashboard)/projects/[id]/page.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

On a phone, the project detail page (`/projects/[id]`) is unusable: the navigator
bar (Appearance · Sort · … · Share · New Folder · Upload) is a single
non-wrapping flex row that overflows off-screen, and the default card size `M`
renders **one column** on mobile so a single portrait thumbnail fills the whole
viewport. This is the "editor mobile still a mess" report. After this plan the
navigator bar stays on screen (wraps, actions collapse to icons on small
screens) and the grid shows a sensible number of columns on phones.

## Current state

### File 1 — `apps/web/components/projects/asset-grid.tsx`

**Grid column map** (lines 72–76). `cardSize` default is `M` (from
`apps/web/stores/view-store.ts`), and `M` is **`grid-cols-1`** below the `sm`
breakpoint — that is the giant single card on mobile:

```tsx
const gridColsMap = {
  S: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  M: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2',
}
```

**Navigator bar** (lines 246–264) — one flex row, no wrapping, no horizontal
scroll; `actions` (the Share / New Folder / Upload buttons) are pushed right by a
`flex-1` spacer and overflow on narrow screens:

```tsx
      {/* ─── Navigator Bar (Frame.io style) ─────────────────────────────── */}
      {!shareMode && (
        <div className="flex items-center gap-1 border-b border-border pb-2.5">
          {/* Left group: Appearance + Fields + Sort */}
          <AppearancePopover />

          <div className="h-4 w-px bg-border mx-0.5" />

          <SortPopover />

          <div className="flex-1" />

          {/* Right group: action buttons passed from parent */}
          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
```

### File 2 — `apps/web/app/(dashboard)/projects/[id]/page.tsx`

The `actions` node passed into `<AssetGrid actions={…}>` (lines 699–739) is the
Members / Share / New Folder / Upload cluster. The text labels ("Share", "New
Folder", "Upload") are what make the row too wide on mobile:

```tsx
              actions={
                <>
                  {canManageMembers && (
                    <Button variant="secondary" size="sm" onClick={() => setMembersDialogOpen(true)}>
                      <Users className="h-4 w-4" />
                    </Button>
                  )}
                  {canShare && (
                    <Button variant="secondary" size="sm" onClick={() => setActiveShare({ kind: "project" })}>
                      <Share2 className="h-4 w-4" />
                      Share
                    </Button>
                  )}
                  {canCreateFolder && (
                    <button
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[13px] transition-colors"
                      onClick={() => { setFolderDialogParentId(currentFolderId); setFolderDialogOpen(true); }}
                    >
                      <FolderPlus className="h-4 w-4" />
                      New Folder
                    </button>
                  )}
                  {canUpload && (
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <Upload className="h-4 w-4" />
                      Upload
                    </Button>
                  )}
                </>
              }
```

### Convention

- The codebase hides secondary text on small screens with Tailwind responsive
  utilities, e.g. `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx:398`
  wraps a label in `<span className="hidden sm:inline">New Version</span>` so the
  icon shows alone on mobile. **Match that pattern** for the action labels here.
- Breakpoints in use: `sm` (640px), `md`, `lg`, `xl`. Mobile = below `sm`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |

## Scope

**In scope** (the only files you should modify):
- `apps/web/components/projects/asset-grid.tsx`
- `apps/web/app/(dashboard)/projects/[id]/page.tsx`

**Out of scope** (do NOT touch):
- `apps/web/stores/view-store.ts` — do not change the default `cardSize`; fix the
  responsive columns in `gridColsMap` instead so all card sizes stay valid.
- The list-view layout (`layout === 'list'`) column headers — the reported issue
  is the default grid view; leave list view alone.
- The upload button's *behavior* (opening a dialog) — that is Plan 031's job.
  Here you only change how the button *looks* on mobile (icon-only), not what it
  does.

## Git workflow

- Branch: `advisor/028-project-page-mobile-responsive`
- Conventional commits, e.g. `fix(web): make project detail navigator + grid responsive on mobile`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Give the grid at least two columns on phones

In `apps/web/components/projects/asset-grid.tsx`, update `gridColsMap` so the
default `M` (and `L`) size no longer collapse to a single column on mobile:

```tsx
const gridColsMap = {
  S: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  M: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-2 sm:grid-cols-1 lg:grid-cols-2',
}
```

(Only the mobile/`sm` base of each row changes; `lg`/`xl` stay as they were so
desktop density is unchanged. `L` keeps its single large card from `sm` up but
shows two on the narrowest phones so a card isn't full-bleed.)

**Verify**: `cd apps/web && grep -n "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3" components/projects/asset-grid.tsx` → one match (the `M` row).

### Step 2: Let the navigator bar wrap instead of overflowing

In the same file, change the navigator bar container so it wraps and the actions
group can move to a second line on narrow screens. Replace:

```tsx
        <div className="flex items-center gap-1 border-b border-border pb-2.5">
```

with:

```tsx
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2.5">
```

and change the spacer `<div className="flex-1" />` to only push actions right when
there is room to wrap onto one line — replace it with:

```tsx
          <div className="grow" />
```

(`grow` behaves like `flex-1` for pushing the actions right on wide screens; with
`flex-wrap` on the parent, the actions drop to a new line on narrow screens
instead of overflowing.)

**Verify**: `cd apps/web && grep -n "flex flex-wrap items-center gap-1 border-b" components/projects/asset-grid.tsx` → one match.

### Step 3: Collapse action-button labels to icons on mobile

In `apps/web/app/(dashboard)/projects/[id]/page.tsx`, wrap the visible text of the
Share, New Folder, and Upload buttons in `<span className="hidden sm:inline">…</span>`
so only the icon shows below `sm`. Apply to all three:

- Share: `<Share2 className="h-4 w-4" /><span className="hidden sm:inline">Share</span>`
- New Folder: `<FolderPlus className="h-4 w-4" /><span className="hidden sm:inline">New Folder</span>`
- Upload: `<Upload className="h-4 w-4" /><span className="hidden sm:inline">Upload</span>`

Do not change the buttons' `onClick`, variant, or size.

**Verify**: `cd apps/web && grep -c "hidden sm:inline" "app/(dashboard)/projects/[id]/page.tsx"` → at least 3 more than before your edit (run the same grep before editing to get the baseline; report both numbers).

### Step 4: Full verification

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0
- `cd apps/web && pnpm test` → all pass

## Test plan

No new unit tests: these are Tailwind responsive-class changes not asserted by the
vitest suite. If an existing snapshot in
`apps/web/components/projects/__tests__/` or
`apps/web/app/(dashboard)/projects/[id]/__tests__/` pins the old `gridColsMap`
string or the navigator markup, update it to match the new classes and note it in
your report. Verification is the grep anchors plus clean typecheck/lint/test.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && grep -n "M: 'grid-cols-2" components/projects/asset-grid.tsx` returns one match
- [ ] `cd apps/web && grep -n "flex flex-wrap" components/projects/asset-grid.tsx` returns one match (the navigator bar)
- [ ] The Share / New Folder / Upload labels are each wrapped in `hidden sm:inline`
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live files (drift since `30e5364`).
- The navigator bar is rendered by a different component than
  `asset-grid.tsx` on the live code (i.e. the excerpt isn't there) — report where
  it actually lives before changing anything.
- Changing `gridColsMap` breaks a passing test you can't fix with a one-line
  class update.

## Maintenance notes

- If a new card-size option is added to `view-store.ts`, add a matching key to
  `gridColsMap` with a `grid-cols-2` (or higher) mobile base so this regression
  can't recur.
- Reviewer should check the page at ~375px width: navigator actions wrap onto a
  second line (not cut off), and the grid shows 2 columns at `M`.
- The project *header* breadcrumb row is handled globally in `header.tsx`
  (Plan 027 territory) — not part of this plan.
