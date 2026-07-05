# Plan 074: Mobile Library screen — full spec conformance (app bar, toolbar, single-col cards)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Base**: this plan builds ON TOP of plan 070's folder strip (branch
> `preview/round10-view`). The worktree must contain 070's insertion before you
> start — see the drift check.
>
> **Drift check (run first, all must pass)**:
> - `grep -c 'lg:hidden flex gap-2 overflow-x-auto px-4 py-3' "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `1` (070's folder strip present)
> - `grep -c 'sticky top-0 z-20 flex h-14' apps/web/components/layout/header.tsx` → `1`
> - `grep -c "M: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3'" apps/web/components/projects/asset-grid.tsx` → `1`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (header change is app-wide chrome; scoped by route test)
- **Depends on**: 070 (folder strip) — hard; plan edits the same region
- **Category**: mobile / design-conformance
- **Planned at**: written 2026-07-05 against `preview/round10-view` (main `3884b09` + 070/072/073)

## Why this matters

Maintainer QA'd the round-10 build against the mobile design spec
(`app-mobile.dc.html`, screen 1b "Project library", 460px viewport) and the
Library screen still reads as the desktop layout crammed into a phone. The spec
specifies, on mobile:

1. **Contextual app bar** instead of the global chrome header: Back button,
   "PROJECT" overline + project name, Members icon button, Share icon button.
   Currently the global header (logo + truncated breadcrumb + bell + uploads +
   search + theme toggle + avatar) renders at all widths and overflows at 460px.
2. **One-row toolbar**: "Sorted by Date" control left, primary **Upload** button
   right. Currently the navigator bar shows Appearance + Sort plus four action
   icon-buttons (Members / Share / New folder / Upload) that wrap to a second row.
3. **Single-column, full-width asset cards**. Currently 2 columns on mobile
   (`grid-cols-2` at base breakpoint).
4. Folder strip chips carry a folder icon (and trash icon on "Deleted"). 070
   shipped text-only chips.

Desktop (`lg`+) must be pixel-identical to current.

## Current state

### `apps/web/components/layout/header.tsx`

`Header` is the global chrome header, mounted in the dashboard layout for every
dashboard page. Root element (line ~104):

```tsx
<header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-bg-primary/90 backdrop-blur-sm px-4 sm:px-6">
```

It already has `const pathname = usePathname()` (line ~63) and imports `cn`.

### `apps/web/app/(dashboard)/projects/[id]/page.tsx`

The Library page (project detail). Relevant structure inside the main content
column (after 070's merge):

```tsx
{/* Mobile folder strip — desktop uses the sidebar */}
<div className="lg:hidden flex gap-2 overflow-x-auto px-4 py-3 border-b border-border [scrollbar-width:none]">
  <button ... onClick={() => handleSelectFolder(null)} ...>
    {project?.name ?? 'Project'}
  </button>
  {(tree ?? []).map((node) => ( <button ...>{node.name}</button> ))}
  <button ... onClick={() => { setShowTrash(true); setCurrentFolderId(null); }} ...>
    Deleted
  </button>
</div>
<div className="px-5 pt-3 pb-6 space-y-3">
```

Each chip's className (070):
`'shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors'`
+ active `'text-accent bg-accent-muted border border-accent-line'`
/ inactive `'text-text-tertiary border border-transparent hover:text-text-secondary'`.

The page passes `actions` to `<AssetGrid>` (line ~695 pre-merge):

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
        <span className="hidden sm:inline">Share</span>
      </Button>
    )}
    {canCreateFolder && (
      <Button variant="secondary" size="sm" onClick={() => { setFolderDialogParentId(currentFolderId); setFolderDialogOpen(true); }}>
        <FolderPlus className="h-4 w-4" />
        <span className="hidden sm:inline">New folder</span>
      </Button>
    )}
    {canUpload && (
      <Button size="sm" onClick={() => uploadInputRef.current?.click()}>
        <Upload className="h-4 w-4" />
        <span className="hidden sm:inline">Upload</span>
      </Button>
    )}
  </>
}
```

Already imported in this file: `Users`, `Share2`, `FolderPlus`, `Upload`,
`UploadCloud`, `FolderIcon` (lucide `Folder as FolderIcon` or similar — check
the import line), `cn`, `Button`, `router` (`useRouter`), `project`,
`canManageMembers`, `canShare`, `setMembersDialogOpen`, `setActiveShare`.

### `apps/web/components/projects/asset-grid.tsx`

Grid columns (lines ~72-76):

```tsx
const gridColsMap = {
  S: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  M: 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-2 sm:grid-cols-1 lg:grid-cols-2',
}
```

Navigator bar (lines ~245-264):

```tsx
{!shareMode && (
  <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2.5">
    {/* Left group: Appearance + Fields + Sort */}
    <AppearancePopover />

    <div className="h-4 w-px bg-border mx-0.5" />

    <SortPopover />

    <div className="grow" />

    {/* Right group: action buttons passed from parent */}
    {actions && (
      <div className="flex items-center gap-2">
        {actions}
      </div>
    )}
  </div>
)}
```

### Repo conventions

- Tailwind tokens only. Mobile-first: mobile-only = `lg:hidden`, desktop-only =
  `hidden lg:flex` / `hidden lg:block` / `hidden lg:inline-flex` (match the
  element's display type). The Library mobile plans use the `lg` breakpoint
  (folder sidebar is `hidden lg:flex`), NOT `sm`.
- Mono overline style: `font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary`.
- Icon buttons carry `aria-label`. Icons from `lucide-react`, `h-4 w-4`-ish.
- `Button` (components/ui/button) accepts `className`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope** (3 files):
- `apps/web/components/layout/header.tsx`
- `apps/web/app/(dashboard)/projects/[id]/page.tsx`
- `apps/web/components/projects/asset-grid.tsx`

**Out of scope**: `mobile-nav.tsx`, the asset review page
(`/projects/[id]/assets/[assetId]` — spec screen 1c, separate territory),
`asset-card.tsx`, `appearance-popover.tsx`, `sort-popover.tsx` internals,
the Projects index page, dialogs, stores, and ALL desktop (`lg`+) rendering.

## Git workflow

- Branch: `advisor/074-mobile-library-conformance`
- Commit: `feat(web): mobile Library conformance — app bar, toolbar, 1-col cards (plan 074)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Hide global header on mobile Library route

In `header.tsx`, after `const pathname = usePathname()`, add:

```tsx
// Library page renders its own contextual app bar on mobile (spec 1b)
const isProjectLibrary = /^\/projects\/[^/]+$/.test(pathname ?? '')
```

Change the `<header>` root className to conditional:

```tsx
<header className={cn(
  'sticky top-0 z-20 h-14 items-center justify-between border-b border-border bg-bg-primary/90 backdrop-blur-sm px-4 sm:px-6',
  isProjectLibrary ? 'hidden lg:flex' : 'flex',
)}>
```

(`cn` is already imported.)

**Verify**: `grep -c "isProjectLibrary ? 'hidden lg:flex' : 'flex'" apps/web/components/layout/header.tsx` → `1`

### Step 2: Mobile app bar on the Library page

In `page.tsx`, immediately BEFORE 070's mobile folder strip `<div
className="lg:hidden flex gap-2 overflow-x-auto ...">`, insert the contextual
app bar (mobile only):

```tsx
{/* Mobile app bar — global header is hidden on this route at <lg (spec 1b) */}
<div className="lg:hidden flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
  <button
    type="button"
    aria-label="Back"
    onClick={() => router.push('/projects')}
    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary hover:text-text-primary transition-colors"
  >
    <ArrowLeft className="h-[17px] w-[17px]" />
  </button>
  <div className="flex min-w-0 flex-1 flex-col gap-px">
    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">Project</span>
    <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
      {project?.name ?? 'Project'}
    </span>
  </div>
  {canManageMembers && (
    <button
      type="button"
      aria-label="Members"
      onClick={() => setMembersDialogOpen(true)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-secondary hover:text-text-primary transition-colors"
    >
      <Users className="h-[15px] w-[15px]" />
    </button>
  )}
  {canShare && (
    <button
      type="button"
      aria-label="Share"
      onClick={() => setActiveShare({ kind: "project" })}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-secondary hover:text-text-primary transition-colors"
    >
      <Share2 className="h-[15px] w-[15px]" />
    </button>
  )}
</div>
```

Add `ArrowLeft` to the existing `lucide-react` import in this file. `router`,
`project`, `canManageMembers`, `canShare`, `setMembersDialogOpen`,
`setActiveShare` all already exist in the component — use the real names; if
any is named differently, adapt (STOP only if the capability flags are gone).

**Verify**: `grep -c 'aria-label="Back"' "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `1`

### Step 3: Folder-strip chip icons

In 070's mobile folder strip (same file): add a folder icon to the project-root
chip and each folder chip, and a trash icon to the Deleted chip, before the
label text:

- Root + folder chips: `<FolderIcon className="h-[13px] w-[13px]" />` — the
  file already imports a folder icon (check the import; it is used in the trash
  list as `FolderIcon`). Reuse that exact identifier.
- Deleted chip: `<Trash2 className="h-[13px] w-[13px]" />` — add `Trash2` to the
  lucide import if not present.

Chips already have `gap-2`, so no class changes.

**Verify**: `grep -c 'Trash2 className="h-\[13px\]' "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `1`

### Step 4: Toolbar — mobile one-row (Sort + Upload only)

In `page.tsx`'s `actions={...}` block, hide the three desktop-moved buttons on
mobile by adding a className to each `Button`:

- Members button: `className="hidden lg:inline-flex"`
- Share button: `className="hidden lg:inline-flex"`
- New folder button: `className="hidden lg:inline-flex"`
- Upload button: unchanged (visible at all widths; it is the spec's mobile
  primary action).

In `asset-grid.tsx`'s navigator bar, make Appearance desktop-only by wrapping
the popover and its divider:

```tsx
<div className="hidden lg:flex items-center gap-1">
  <AppearancePopover />
  <div className="h-4 w-px bg-border mx-0.5" />
</div>

<SortPopover />
```

**Verify**: `grep -c 'hidden lg:inline-flex' "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `3`
and `grep -c 'hidden lg:flex items-center gap-1' apps/web/components/projects/asset-grid.tsx` → `1`

### Step 5: Single-column mobile cards

In `asset-grid.tsx`, change `gridColsMap` M and L to one column at base
breakpoint (S stays — small-card mode is a deliberate dense view):

```tsx
const gridColsMap = {
  S: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6',
  M: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  L: 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2',
}
```

**Verify**: `grep -c "M: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'" apps/web/components/projects/asset-grid.tsx` → `1`

### Step 6: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test required — pure responsive class changes plus one route regex. If
any existing test renders `Header` and asserts its class string, update the
assertion for the conditional. The done-criteria greps + gate cover the rest.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` 0; `pnpm test` all pass; `pnpm build` 0
- [ ] All five step greps return their expected counts
- [ ] Desktop (`lg`+): global header shows on Library, Appearance + all four
      action buttons show, grid columns unchanged (M = 3 cols at `lg`)
- [ ] Mobile (<`lg`) Library: contextual app bar (Back / Project overline+name /
      Members / Share), folder chips with icons, toolbar = Sort + Upload only,
      single-column full-width cards, global header hidden
- [ ] Global header still visible on `/projects`, `/settings/*` at ALL widths
      (the route regex must NOT match those)
- [ ] Only the 3 in-scope files modified (`git status`)

## STOP conditions

- Any drift-check grep fails → the base is wrong (worktree missing 070's
  merge) — STOP, do not improvise the strip yourself.
- `Button` doesn't accept `className` → STOP and report (don't fork the
  component).
- The `actions` block or navigator bar structure differs materially from the
  excerpts → re-read and adapt minimally; STOP if the toolbar was reworked.

## Maintenance notes

- The route regex in `header.tsx` intentionally matches ONLY
  `/projects/<id>` (one segment). The asset review page
  (`/projects/<id>/assets/<assetId>`) keeps whatever header behavior it has;
  a future review-screen plan (spec 1c) owns that.
- Members / Share now have two mobile entry points gated by the same
  capability flags — app bar (mobile) and toolbar (desktop). Keep the flags in
  sync if permissions change.
- Mobile loses the "New folder" affordance (spec has none). If users ask for
  it, add a chip-row "+" or overflow menu — don't re-add the toolbar button.
