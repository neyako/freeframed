# Plan 070: Mobile Library screen — folder access strip + single-column assets

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Runs AFTER the round-8/9 merge.** Builds on plan 061's conformed library page
> and plan 068's `MobileNav`. Execute on a branch that already contains 061 + 068.
>
> **Drift check (content-based, run first)**:
> `grep -c "w-\[250px\]" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` must be `1`
> (061's 250px sidebar). If 0, plan 061 isn't merged into this base — STOP.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED (this page has the most wiring; presentation + a new mobile-only strip)
- **Depends on**: 061 (conformed library) + 068 (bottom nav) merged
- **Category**: mobile / design-conformance
- **Planned at**: written against round-8/9 conformed state, 2026-07-05

## Why this matters

`app-mobile.dc.html` screen 1b (Library) specifies the mobile project library:
folder navigation as a horizontal tab/pill strip, a compact toolbar, and
single-column asset cards. The desktop-conformed page (plan 061) puts the folder
tree in a `hidden lg:flex w-[250px]` sidebar — so **on mobile there is currently
no way to navigate folders or reach the trash at all**. The critical gap this
plan closes is mobile folder access; it adds a mobile-only folder strip that
reuses the existing folder state and handlers. The asset grid already fills the
width on mobile; the bottom nav comes from 068.

## Current state (conformed by plan 061)

`apps/web/app/(dashboard)/projects/[id]/page.tsx`:
- The left sidebar is desktop-only: `<div className="hidden lg:flex w-[250px] flex-col border-r border-border bg-bg-secondary shrink-0">` — it renders `<FolderTree ... />` and the storage block. Nothing folder-related shows below `lg`.
- `FolderTree` is fed by page state/handlers: `tree` (array of `FolderTreeNode`),
  `currentFolderId` (string | null), `showTrash` (boolean),
  `handleSelectFolder(folderId | null)`, and the "show trash" flow
  (`setShowTrash(true); setCurrentFolderId(null)`).
- The main content area (`flex-1 ... bg-bg-primary`) holds the `AssetGrid` /
  trash view.

### Mobile spec (screen 1b)
- A horizontal, scrollable **folder strip** near the top: the project root and
  each top-level folder as mono pills (active = `accent` text + `accent-muted`
  bg + `accent-line` border), plus a **"Deleted"** pill (trash). Tapping selects
  the folder / opens trash.
- Single-column asset cards below (the grid already does this on mobile).
- Bottom nav from 068.

### Repo conventions
- Mobile-first responsive; the strip is `lg:hidden` (desktop keeps the sidebar).
- Reuse the page's existing folder state/handlers — do NOT duplicate fetching or
  add new SWR keys. Tailwind tokens only (`text-accent`, `bg-accent-muted`,
  `border-accent-line`, `border-border`, `text-text-tertiary`, `font-mono`).
- Exemplar pill treatment: the folder-tab pills in the mobile spec — mono 11px,
  `rounded-md`, `px-3 py-2`, active accent-muted.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**: `apps/web/app/(dashboard)/projects/[id]/page.tsx` only (add a
mobile-only folder strip; the desktop sidebar is unchanged).

**Out of scope**: `folder-tree.tsx`, `asset-grid.tsx`, `asset-card.tsx`, the
storage block, all dialogs, drag-drop, upload wiring, SWR/handlers (reuse only).
Do NOT rebuild the full nested tree for mobile — a top-level strip is the scoped
deliverable (subfolder drill-down on mobile is a known follow-up).

## Git workflow

- Branch: `advisor/070-mobile-library-screen`
- Commit: `feat(web): mobile Library folder strip + single-column assets (plan 070)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Add a mobile-only folder strip

Immediately inside the main content column (above the `AssetGrid`/trash area, so
it sits at the top of the scrollable content on mobile), add a `lg:hidden`
horizontal strip. It reuses `tree`, `currentFolderId`, `showTrash`, and the
existing select/trash handlers. Sketch:

```tsx
{/* Mobile folder strip — desktop uses the sidebar */}
<div className="lg:hidden flex gap-2 overflow-x-auto px-4 py-3 border-b border-border [scrollbar-width:none]">
  <button
    type="button"
    onClick={() => handleSelectFolder(null)}
    className={cn(
      'shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors',
      currentFolderId === null && !showTrash
        ? 'text-accent bg-accent-muted border border-accent-line'
        : 'text-text-tertiary border border-transparent hover:text-text-secondary',
    )}
  >
    {project?.name ?? 'Project'}
  </button>
  {tree.map((node) => (
    <button
      key={node.id}
      type="button"
      onClick={() => handleSelectFolder(node.id)}
      className={cn(
        'shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors',
        currentFolderId === node.id
          ? 'text-accent bg-accent-muted border border-accent-line'
          : 'text-text-tertiary border border-transparent hover:text-text-secondary',
      )}
    >
      {node.name}
    </button>
  ))}
  <button
    type="button"
    onClick={() => { setShowTrash(true); setCurrentFolderId(null); }}
    className={cn(
      'shrink-0 inline-flex items-center gap-2 rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.04em] transition-colors',
      showTrash
        ? 'text-accent bg-accent-muted border border-accent-line'
        : 'text-text-tertiary border border-transparent hover:text-text-secondary',
    )}
  >
    Deleted
  </button>
</div>
```
Use the EXACT state variables and handler names the page already defines (grep
for `handleSelectFolder`, `setShowTrash`, `setCurrentFolderId`, `currentFolderId`,
`showTrash`, `tree`, `project` — if any differs, use the real name). `cn` is
already imported. Do NOT add new state.

**Verify**: `grep -c "lg:hidden flex gap-2 overflow-x-auto" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `1`

### Step 2: Confirm the asset grid is single-column on mobile

The `AssetGrid` internals are out of scope (038/061). Confirm visually/by grep
that the page's asset area is not forcing a multi-column layout at mobile widths
that would clip. If the grid already uses the appearance/layout store (it does),
no change is needed — just verify the strip doesn't break the flex column. If the
main content column needs `min-w-0` to prevent the strip's `overflow-x-auto` from
stretching it, add `min-w-0` to that column only.

**Verify**: no horizontal page scroll introduced (the strip scrolls internally
via `overflow-x-auto`).

### Step 3: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass
(the page has `page-upload-drop.test.tsx` — it must stay green; if it fails for a
non-class reason you broke structure → STOP); `pnpm build` → exit 0.

## Test plan

No new test file. `page-upload-drop.test.tsx` must remain green (drag-drop wiring
untouched). If it fails behaviorally, STOP. If it fails on a class/structure
assertion caused by the added strip, update the assertion minimally.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "lg:hidden flex gap-2 overflow-x-auto" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → `1`
- [ ] Desktop (`lg`+) unchanged — the sidebar still shows, the strip is hidden
- [ ] Only `projects/[id]/page.tsx` modified (`git status`)

## STOP conditions

- Drift check fails (061 not in base) — STOP.
- The page's folder state/handlers have different names than assumed and the real
  ones can't be wired without touching `folder-tree.tsx` — report.
- `page-upload-drop.test.tsx` fails behaviorally — STOP (you altered structure).

## Maintenance notes

- Subfolder drill-down on mobile is intentionally out of scope (the strip shows
  top-level folders only). If deep folder nav on mobile is wanted, a follow-up can
  make each pill expand or add a breadcrumb — do NOT rebuild `FolderTree` for
  mobile here.
- The desktop sidebar and its storage block are unchanged; the mobile storage
  view (spec shows it under Settings) is plan 072's concern.
