# Plan 075: Mobile chrome cleanup — drop redundant header buttons; compact Projects hero

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Base**: `preview/round10-view` (contains 070/072/073/074). header.tsx was
> modified by 074 — this plan builds on that version.
>
> **Drift check (run first, all must pass)**:
> - `grep -c "isProjectLibrary ? 'hidden lg:flex' : 'flex'" apps/web/components/layout/header.tsx` → `1` (074 present)
> - `grep -c 'flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center' "apps/web/app/(dashboard)/projects/page.tsx"` → `1`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 074 merged (same header.tsx region)
- **Category**: mobile / design-conformance
- **Planned at**: written 2026-07-05 against `preview/round10-view` @ `d7d1c73`

## Why this matters

Maintainer QA of the round-10 build, Projects index at mobile width:

1. **Redundant header controls**: the global header shows Search, Uploads, and
   the theme toggle at all widths. Below `lg` the bottom tab nav (plan 068,
   `mobile-nav.tsx`, `lg:hidden`) already provides Search and Uploads tabs, and
   the theme picker lives at `/settings/appearance` (reachable via the Profile
   tab + settings chips from plan 072). The duplicates crowd the 460px header
   and truncate the breadcrumb. Spec screen 1a app bar shows only logo + avatar.
   The notifications bell stays — it has no bottom-nav equivalent.
2. **Stretched view toggle**: the grid/list `Segmented` control stretches
   full-width in its own row on mobile (069's stacking wrapper made every child
   full-width). Spec 1a puts a compact segmented control right of the
   "Projects" heading, with the full-width "New project" button below.

Desktop (`lg`+) unchanged.

## Current state

### `apps/web/components/layout/header.tsx` (post-074)

Right-side actions (lines ~157-219), in order: Bell button, Uploads button,
Search trigger, theme toggle, avatar dropdown. The three to hide on mobile:

```tsx
{/* Uploads button */}
<button
  onClick={() => { setNotifOpen(false); togglePanel() }}
  className={cn(
    'relative flex h-[34px] w-[34px] items-center justify-center rounded border transition-colors',
    ...
```

```tsx
{/* Search trigger */}
<button
  onClick={onSearchOpen}
  className="flex h-[34px] items-center gap-2 rounded border border-border bg-bg-tertiary px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:border-border-strong hover:text-text-secondary transition-colors"
>
```

```tsx
<button
  type="button"
  aria-label="Toggle color theme"
  onClick={() => setTheme(isLight ? 'dark' : 'light')}
  className="flex h-[34px] items-center gap-2 rounded border border-border bg-bg-tertiary px-2 sm:px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
>
```

### `apps/web/app/(dashboard)/projects/page.tsx`

Header block (lines ~273-318). The dialog is **controlled**
(`open={dialogOpen}` on `Dialog.Root`, `setDialogOpen` in scope):

```tsx
<div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
  <div>
    <h1 ...>Projects</h1>
    {projects && projects.length > 0 && ( <p ...>N projects</p> )}
  </div>

  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
    <Segmented options={[...]} value={viewMode} onChange={setViewMode} />

    <Dialog.Root open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
      <Dialog.Trigger asChild>
        <Button size="sm" className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>...</Dialog.Portal>
    </Dialog.Root>
  </div>
</div>
```

`Button`, `Plus`, `setDialogOpen` all already in scope. There is a second
"New project" string near line 168 (empty-state) — do not touch it.

### Repo conventions

- Header chrome uses the `lg` breakpoint for mobile-vs-desktop (matches
  `mobile-nav.tsx` `lg:hidden` and 074's header change): mobile-hidden =
  `hidden lg:flex`.
- Page-level responsive on the Projects index uses `sm` (069 convention).
- Tailwind tokens only; `Button` accepts `className`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope** (2 files): `apps/web/components/layout/header.tsx`,
`apps/web/app/(dashboard)/projects/page.tsx`.

**Out of scope**: `mobile-nav.tsx`, the Bell/notifications button, the avatar
dropdown, `settings/appearance` page, `Segmented` component internals, the
create-project dialog contents, the empty-state, desktop rendering.

## Git workflow

- Branch: `advisor/075-mobile-header-cleanup-projects-hero`
- Commit: `fix(web): hide duplicate mobile header actions + compact Projects hero (plan 075)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Hide Uploads / Search / theme toggle below `lg`

In `header.tsx`:
- Uploads button: `'relative flex h-[34px] w-[34px] ...'` → `'relative hidden lg:flex h-[34px] w-[34px] ...'` (inside the `cn()` first string).
- Search trigger: `className="flex h-[34px] items-center gap-2 ..."` → `className="hidden lg:flex h-[34px] items-center gap-2 ..."`.
- Theme toggle: `className="flex h-[34px] items-center gap-2 ..."` → `className="hidden lg:flex h-[34px] items-center gap-2 ..."`.

Bell and avatar untouched.

**Verify**: `grep -c 'hidden lg:flex h-\[34px\]' apps/web/components/layout/header.tsx` → `3`
(the Uploads line matches too — its `relative hidden lg:flex h-[34px]` contains
the pattern) and `grep -c 'relative hidden lg:flex h-\[34px\]' apps/web/components/layout/header.tsx` → `1`

### Step 2: Compact hero row on Projects index

In `projects/page.tsx`:
- Outer header row: `className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"` → `className="flex flex-wrap items-end justify-between gap-4"`.
- Right group: `className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"` → `className="flex items-center gap-2"`.
- `Dialog.Trigger`'s Button: `className="w-full sm:w-auto"` → `className="hidden sm:inline-flex"` (desktop keeps the inline button).

**Verify**: `grep -c 'flex flex-wrap items-end justify-between gap-4' "apps/web/app/(dashboard)/projects/page.tsx"` → `1`

### Step 3: Mobile full-width New-project button below the hero

Immediately AFTER the closing `</div>` of the outer header row (after the
right group + Dialog.Root close), add:

```tsx
{/* Mobile primary action — spec 1a full-width New project */}
<Button size="sm" className="w-full sm:hidden" onClick={() => setDialogOpen(true)}>
  <Plus className="h-4 w-4" />
  New project
</Button>
```

The dialog is controlled, so this opens the same dialog as the desktop trigger.
NOTE: the page wrapper has `space-y-9`; if the spacing looks wrong in the JSX
structure, place the button as a direct child of the wrapper so `space-y`
applies — do not invent margin classes.

**Verify**: `grep -c 'w-full sm:hidden' "apps/web/app/(dashboard)/projects/page.tsx"` → `1`

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test — class strings + one controlled-dialog button reusing existing
state. Gate + greps cover it. If a test asserts the header shows a Search
button, update it for the `lg` gating and say so in NOTES.

## Done criteria

- [ ] Gate green (tsc 0, tests pass, build 0)
- [ ] All step greps return expected counts
- [ ] Mobile (<`lg`): header = logo + breadcrumb + bell + avatar only
- [ ] Mobile (<`sm`): hero = heading left + compact segmented right, full-width
      New project button below; nothing stretched
- [ ] Desktop (`lg`+): identical to before (all header buttons, inline New
      project, no duplicate button)
- [ ] Only the 2 in-scope files modified

## STOP conditions

- Drift greps fail → wrong base; STOP.
- The Dialog is no longer controlled (`open={dialogOpen}` gone) → STOP and
  report; do not add a second `Dialog.Root`.

## Maintenance notes

- Between `sm` and `lg` both the desktop-style inline button (`sm:inline-flex`)
  and header bell show while the bottom nav is still visible (`lg:hidden`) —
  intentional overlap; revisit only if QA flags it.
- If notifications ever move into the bottom nav, hide the bell the same way
  (`hidden lg:flex`).
