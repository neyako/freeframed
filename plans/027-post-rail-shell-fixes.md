# Plan 027: Reposition uploads/notification drawers to the right and remove the dead header panel-toggle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 30e5364..HEAD -- apps/web/components/layout/uploads-panel.tsx apps/web/components/layout/notification-drawer.tsx apps/web/components/layout/header.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `30e5364`, 2026-07-01

## Why this matters

Plan 025 moved the global navigation out of a 52px-wide left rail and into the
top header, then deleted the rail. Two drawers were positioned relative to that
now-deleted rail and were never updated:

- The **Uploads** panel and the **Notifications** drawer both still open pinned
  to the left edge with a `left-[52px]` offset (a gap where the rail used to be),
  even though the buttons that open them now live in the **top-right** of the
  header. The result (screenshot: uploads panel floating on the empty left side)
  looks broken.
- A leftover **panel-toggle button** sits in the header between the search box
  and the user avatar. On the project grid and other non-detail pages it toggles
  a right panel that is `hidden` below the `xl` breakpoint and only appears when
  an asset is selected, so on most screens the button does nothing visible — it
  is dead UI the user asked to remove.

After this plan: both drawers slide in from the right, directly under their
trigger buttons; the confusing header toggle is gone.

## Current state

### File 1 — `apps/web/components/layout/uploads-panel.tsx`

The panel is rendered globally from `apps/web/app/(dashboard)/layout.tsx` (`<UploadsPanel />`).
Its backdrop + container (lines ~236–245) are anchored left:

```tsx
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setPanelOpen(false)}
      />

      {/* Panel */}
      <div className="fixed left-[52px] top-0 z-50 h-screen w-[380px] border-r border-border bg-bg-secondary shadow-2xl flex flex-col animate-in slide-in-from-left-4 duration-150">
```

### File 2 — `apps/web/components/layout/notification-drawer.tsx`

Backdrop + drawer (lines ~113–119) anchored left:

```tsx
  return (
    <>
      {/* Backdrop — offset to not cover sidebar */}
      <div className="fixed top-0 right-0 bottom-0 left-[52px] z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed left-[52px] top-0 z-50 h-full w-[380px] border-r border-border bg-bg-primary shadow-2xl flex flex-col animate-in slide-in-from-left-2 duration-150">
```

### File 3 — `apps/web/components/layout/header.tsx`

The header is `sticky top-0 z-20 ... h-11` (line 89). The dead toggle is at lines
~196–214, using `useViewStore` state `rightPanelOpen`/`toggleRightPanel`:

```tsx
          {/* Panel toggle — only on project detail pages, not the listing */}
          {pathname !== '/projects' && (
            <button
              onClick={toggleRightPanel}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                rightPanelOpen
                  ? 'text-accent bg-accent-muted'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
              )}
              title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
            >
              {rightPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}
```

`rightPanelOpen` defaults to `true` in `apps/web/stores/view-store.ts`, and the
only consumer of that panel — `apps/web/app/(dashboard)/projects/[id]/page.tsx:809` —
renders it as `{rightPanelOpen && selectedAsset && (<div className="hidden xl:flex ...">`.
So removing the toggle does **not** strand the panel: it still auto-shows on
`xl`+ screens when an asset is selected (the default). Leave `view-store.ts`
untouched — `rightPanelOpen`/`toggleRightPanel` stay defined for that consumer.

### Convention

Tailwind's `animate-in slide-in-from-*` utilities come from `tailwindcss-animate`
and are used throughout (e.g. the right sidebars in
`apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx:426`). The
header is 44px tall (`h-11`), so a right drawer that clears it should use `top-11`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors   |
| Lint      | `cd apps/web && pnpm lint`           | exit 0              |
| Tests     | `cd apps/web && pnpm test`           | all pass            |

## Scope

**In scope** (the only files you should modify):
- `apps/web/components/layout/uploads-panel.tsx`
- `apps/web/components/layout/notification-drawer.tsx`
- `apps/web/components/layout/header.tsx`

**Out of scope** (do NOT touch):
- `apps/web/stores/view-store.ts` — `rightPanelOpen`/`toggleRightPanel` are still
  used by the project detail page; leave them.
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` — the panel consumer; not part
  of this fix.
- Any behavior of the upload/notification *stores* — only the drawers' CSS
  position changes.

## Git workflow

- Branch: `advisor/027-post-rail-shell-fixes`
- Conventional commits, e.g. `fix(web): anchor uploads/notification drawers to the right after rail removal`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Anchor the Uploads panel to the right, under the header

In `apps/web/components/layout/uploads-panel.tsx`, change the panel container
class string so it slides from the right and sits below the 44px header. Replace:

```tsx
      <div className="fixed left-[52px] top-0 z-50 h-screen w-[380px] border-r border-border bg-bg-secondary shadow-2xl flex flex-col animate-in slide-in-from-left-4 duration-150">
```

with:

```tsx
      <div className="fixed right-0 top-11 z-50 h-[calc(100vh-2.75rem)] w-[380px] max-w-[calc(100vw-1rem)] border-l border-border bg-bg-secondary shadow-2xl flex flex-col animate-in slide-in-from-right-4 duration-150">
```

Leave the backdrop `<div className="fixed inset-0 z-40" ...>` as-is (full-screen
click-to-close is correct).

**Verify**: `cd apps/web && grep -n "slide-in-from-right-4" components/layout/uploads-panel.tsx` → one match; `grep -n "left-\[52px\]" components/layout/uploads-panel.tsx` → no matches.

### Step 2: Anchor the Notifications drawer to the right, under the header

In `apps/web/components/layout/notification-drawer.tsx`, replace the backdrop and
drawer container. Replace:

```tsx
      {/* Backdrop — offset to not cover sidebar */}
      <div className="fixed top-0 right-0 bottom-0 left-[52px] z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed left-[52px] top-0 z-50 h-full w-[380px] border-r border-border bg-bg-primary shadow-2xl flex flex-col animate-in slide-in-from-left-2 duration-150">
```

with:

```tsx
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-11 z-50 h-[calc(100vh-2.75rem)] w-[380px] max-w-[calc(100vw-1rem)] border-l border-border bg-bg-primary shadow-2xl flex flex-col animate-in slide-in-from-right-2 duration-150">
```

**Verify**: `cd apps/web && grep -n "left-\[52px\]" components/layout/notification-drawer.tsx` → no matches.

### Step 3: Remove the dead header panel-toggle button

In `apps/web/components/layout/header.tsx`, delete the entire block described in
"Current state / File 3" (the `{pathname !== '/projects' && ( <button ...> )}`
panel toggle, ~lines 196–214).

Then remove the now-unused symbols so lint/typecheck stay clean:
- In the destructure `const { rightPanelOpen, toggleRightPanel } = useViewStore()`
  (line ~65): remove that line entirely **and** remove the
  `import { useViewStore } from '@/stores/view-store'` import (line ~9) — verify
  `useViewStore` is not referenced anywhere else in the file first
  (`grep -n useViewStore apps/web/components/layout/header.tsx` should show only
  the import + destructure you are removing).
- Remove `PanelRightClose` and `PanelRightOpen` from the `lucide-react` import on
  line 7 **only if** they are not used elsewhere in the file
  (`grep -n "PanelRight" apps/web/components/layout/header.tsx` — after deleting
  the button, both should be unreferenced; drop them from the import).

**Verify**:
- `cd apps/web && grep -n "toggleRightPanel\|PanelRightClose\|PanelRightOpen\|useViewStore" components/layout/header.tsx` → no matches.
- `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 4: Full verification

Run typecheck, lint, and tests.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0
- `cd apps/web && pnpm lint` → exit 0 (no new warnings about unused vars/imports in the three files)
- `cd apps/web && pnpm test` → all pass

## Test plan

No new unit tests — these are pure CSS-position and dead-code-removal changes not
covered by the vitest suite (which does not assert Tailwind class strings for
these drawers). Verification is the grep anchors above plus a clean
typecheck/lint. If `pnpm test` surfaces an existing snapshot/test that references
the removed header button, update that test to match (and note it in your report).

## Done criteria

ALL must hold:

- [ ] `cd apps/web && grep -rn "left-\[52px\]" components/layout/` returns no matches
- [ ] `cd apps/web && grep -n "slide-in-from-right" components/layout/uploads-panel.tsx components/layout/notification-drawer.tsx` returns two matches (one per file)
- [ ] `cd apps/web && grep -n "toggleRightPanel" components/layout/header.tsx` returns no matches
- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] Only the three in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live files (drift since `30e5364`).
- `useViewStore` or `PanelRightClose`/`PanelRightOpen` turn out to be used
  elsewhere in `header.tsx` beyond the toggle block — do not remove imports that
  are still referenced; report what you found.
- Removing the header toggle breaks a passing test in a way you can't resolve by
  a one-line update — report the test name and failure.

## Maintenance notes

- If a future change reintroduces a way to reopen the right panel on non-`xl`
  screens, put that affordance inside the project detail page/panel, not back in
  the global header.
- Reviewer should confirm both drawers open flush to the right edge, below the
  header, and that click-outside still closes them.
- The `left-[52px]` value was the old rail width; if you ever see it again in a
  layout component it's almost certainly another rail-removal miss.
