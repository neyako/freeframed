# Plan 069: Mobile Projects screen (full-width action, 2-col grid)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Runs AFTER the round-8/9 merge.** This plan builds on plan 060's conformed
> Projects page and plan 068's `MobileNav`. Execute it on a branch that already
> contains 060 + 068 (i.e. after the maintainer merges round 8/9 to main).
>
> **Drift check (content-based, run first)**:
> `grep -c "max-w-\[1360px\]" "apps/web/app/(dashboard)/projects/page.tsx"` must be `1`
> and `grep -c "minmax(240px,1fr)" "apps/web/app/(dashboard)/projects/page.tsx"` must be `≥1`.
> If either is 0, plan 060 isn't merged into this base — STOP and report.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (responsive class changes only)
- **Depends on**: 060 (conformed projects page) + 068 (bottom nav) merged
- **Category**: mobile / design-conformance
- **Planned at**: written against round-8/9 conformed state, 2026-07-05

## Why this matters

`app-mobile.dc.html` screen 1a (Projects) specifies the mobile Projects layout:
a large title + Doto count, a segmented grid/list toggle, a **full-width** red
"New project" button, a "My projects" section header, and a **2-column** card
grid with the dashed new-project tile. The desktop-conformed page (plan 060) puts
the New-project button inline in the header row and uses an `auto-fill,
minmax(240px,1fr)` grid that collapses to a single column at 460px. This plan
adds the mobile responsive treatment. The global bottom nav is already provided
by plan 068.

## Current state (conformed by plan 060)

`apps/web/app/(dashboard)/projects/page.tsx`, header + actions (the New-project
`Button` is inline inside the actions flex, next to the `Segmented`):
```tsx
<div className="mx-auto w-full max-w-[1360px] px-4 sm:px-8 lg:px-10 pt-6 sm:pt-10 pb-24 space-y-9">
  <div className="flex flex-wrap items-end justify-between gap-5">
    <div>
      <h1 className="font-sans text-[clamp(26px,4vw,36px)] font-medium ...">Projects</h1>
      {/* Doto count line */}
    </div>
    <div className="flex items-center gap-2">
      <Segmented options={[grid, list]} value={viewMode} onChange={setViewMode} />
      <Dialog.Root ...>
        <Dialog.Trigger asChild>
          <Button size="sm"><Plus className="h-4 w-4" /> New project</Button>
        </Dialog.Trigger>
        ...
      </Dialog.Root>
    </div>
  </div>
  ...
```
Card grid (in `ProjectSection`) and the loading-skeleton grid both use:
```tsx
<div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
```

### Mobile spec (screen 1a)
- Title block + segmented on one row (as now).
- "New project" = **full-width** primary button on mobile, below the title row.
- Card grid = **2 columns** on mobile (`grid-cols-2`), widening to the
  `auto-fill,minmax(240px,1fr)` grid at `sm`+.

### Repo conventions
- Mobile-first responsive: base = mobile, add `sm:` / `lg:` for larger. Tailwind
  tokens only. `Button` already renders the primary red style.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**: `apps/web/app/(dashboard)/projects/page.tsx` only.

**Out of scope**: `project-card.tsx`, `Segmented`, the New-project dialog markup,
the global `Header` (its mobile slimming is a shared concern, not this page),
`mobile-nav.tsx` (068 owns it), all data/handlers.

## Git workflow

- Branch: `advisor/069-mobile-projects-screen`
- Commit: `feat(web): mobile Projects screen — full-width action + 2-col grid (plan 069)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Full-width "New project" on mobile

Restructure the header so the New-project button is full-width below the
title/segmented row on mobile, inline on `sm`+. Change the actions container and
the trigger button:
- The `<div className="flex items-center gap-2">` wrapping Segmented + Dialog →
  `flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center` so it stacks
  on mobile.
- Put the `Segmented` in a row of its own on mobile if needed; keep it beside the
  title on `sm`+ (acceptable to keep Segmented + button stacked on mobile).
- The New-project `<Button size="sm">` → add `className="w-full sm:w-auto"` and
  wrap so `Dialog.Trigger`'s child button spans full width on mobile.
- The outer header `flex flex-wrap items-end justify-between gap-5` may become
  `flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between`
  to stack cleanly on mobile.

**Verify**: `grep -c "w-full sm:w-auto" "apps/web/app/(dashboard)/projects/page.tsx"` → `≥1`

### Step 2: 2-column grid on mobile

Both grids (the section card grid in `ProjectSection` and the loading-skeleton
grid) change:
`grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5`
→ `grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`

**Verify**: `grep -c "grid-cols-2 gap-3.5 sm:grid-cols-\[repeat(auto-fill,minmax(240px,1fr))\]" "apps/web/app/(dashboard)/projects/page.tsx"` → `2`

### Step 3: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test (responsive class-string only). Run `pnpm test`; update any
class-string assertion on the projects page that references the changed grid
string. Keep behavioral assertions intact.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "grid-cols-2 gap-3.5 sm:grid-cols" "apps/web/app/(dashboard)/projects/page.tsx"` → `2`
- [ ] New-project button spans full width below `sm` (visual) — `grep -c "w-full sm:w-auto"` → `≥1`
- [ ] Desktop layout (`sm`+) visually unchanged
- [ ] Only `projects/page.tsx` modified (`git status`)

## STOP conditions

- Drift check fails (060 not in base) — STOP.
- The Segmented control overflows the mobile row width and can't be made to fit
  without editing the `Segmented` primitive — report; do not edit the primitive.
- A failing test is behavioral, not a class-string assertion.

## Maintenance notes

- The global Header still shows desktop breadcrumb/actions on mobile; slimming it
  to the spec's wordmark+avatar app bar is a shared-shell concern (a follow-up
  may hide the header action cluster on mobile — coordinate with plan 059's
  header, not this page).
- The bottom nav (068) already reserves no extra space here — content scrolls
  above it in the dashboard shell.
