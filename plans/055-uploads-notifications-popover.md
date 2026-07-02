# Plan 055: Uploads & notifications become compact anchored popovers (not full-height drawers)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat bf3d541..HEAD -- apps/web/components/layout/uploads-panel.tsx apps/web/components/layout/notification-drawer.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: UX
- **Planned at**: commit `bf3d541`, 2026-07-03

## Why this matters

Opening Uploads or Notifications slides out a **full-height, 380px drawer**
that covers the content from header to viewport bottom — on desktop AND
mobile (maintainer screenshot, 2026-07-03: an empty notifications list
occupying the entire screen height). Both are glance-and-dismiss surfaces
(a handful of rows, usually), not workspaces. The maintainer wants them as
compact popovers anchored under their header buttons, like the share
popover — content stays visible around them.

## Current state

Both panels render from the header (plan 027 moved them to the right edge)
with the same shell recipe: an invisible full-screen click-catcher backdrop
plus a fixed full-height drawer.

`apps/web/components/layout/uploads-panel.tsx:237-244`:

```tsx
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setPanelOpen(false)}
      />

      {/* Panel */}
      <div className="fixed right-0 top-11 z-50 h-[calc(100vh-2.75rem)] w-[380px] max-w-[calc(100vw-1rem)] border-l border-border bg-bg-secondary shadow-2xl flex flex-col animate-in slide-in-from-right-4 duration-150">
```

`apps/web/components/layout/notification-drawer.tsx:115-118`:

```tsx
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-11 z-50 h-[calc(100vh-2.75rem)] w-[380px] max-w-[calc(100vw-1rem)] border-l border-border bg-bg-primary shadow-2xl flex flex-col animate-in slide-in-from-right-2 duration-150">
```

Inner structure is already popover-ready: both have a `shrink-0` header row
and a `flex-1 overflow-y-auto` scroll body (`uploads-panel.tsx:303`,
`notification-drawer.tsx:173`) — capping the shell height just works. One
exception: the notification empty state stretches with `h-full`
(`notification-drawer.tsx:181`):

```tsx
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
```

With a max-height shell and an empty list, `h-full` collapses to nothing —
it needs a minimum height instead.

The reference popover shape in this repo is the share popover
(`components/review/share-dialog.tsx:118-125`, post-plan-050): fixed,
right-anchored, `max-h` + `overflow-y-auto`, rounded border, shadow.

Design note: plan 037 (pending retheme) restyles these two components'
*colors/typography* ("shell/header classes" for tokens). This plan changes
**shape/size classes only** — no color-token, font, or content changes.
Radius classes are fine (034 remaps the radius scale globally).

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass (141 at plan time) |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only files you should modify):

- `apps/web/components/layout/uploads-panel.tsx` — the panel shell class
  string (line ~244) only.
- `apps/web/components/layout/notification-drawer.tsx` — the drawer shell
  class string (line ~118) and the empty-state `h-full` (line ~181) only.

**Out of scope** (do NOT touch):

- The backdrops (`fixed inset-0 z-40`) — keep as invisible click-catchers.
- Panel contents: rows, tabs, actions, stores, SSE wiring.
- `components/layout/header.tsx` — the trigger buttons are fine.
- Color/typography tokens (retheme, plans 034–040).
- The upload-row `pointer-coarse:opacity-100` class from plan 051 — must
  survive untouched.

## Git workflow

- Branch: `advisor/055-uploads-notifications-popover`
- Conventional commit, e.g. `fix(layout): uploads and notifications open as compact popovers`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Uploads panel shell → popover

In `uploads-panel.tsx` (line ~244) replace the shell classes:

```tsx
      <div className="fixed right-2 top-12 z-50 w-[380px] max-w-[calc(100vw-1rem)] max-h-[min(70dvh,560px)] rounded-xl border border-border bg-bg-secondary shadow-2xl flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
```

(Changes: `right-0`→`right-2`, `top-11`→`top-12`, drop
`h-[calc(100vh-2.75rem)]` and `border-l`, add `max-h-[min(70dvh,560px)]
rounded-xl border overflow-hidden`, entry animation becomes a popover pop
instead of a drawer slide. `bg-bg-secondary shadow-2xl flex flex-col`
stay.)

**Verify**: `grep -c "h-\[calc(100vh-2.75rem)\]" components/layout/uploads-panel.tsx` → 0;
`grep -c "max-h-\[min(70dvh,560px)\]" components/layout/uploads-panel.tsx` → 1.

### Step 2: Notification drawer shell → popover

Same treatment in `notification-drawer.tsx` (line ~118), keeping its
`bg-bg-primary`:

```tsx
      <div className="fixed right-2 top-12 z-50 w-[380px] max-w-[calc(100vw-1rem)] max-h-[min(70dvh,560px)] rounded-xl border border-border bg-bg-primary shadow-2xl flex flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150">
```

**Verify**: `grep -rc "h-\[calc(100vh-2.75rem)\]" components/layout/` → 0 total;
`grep -c "max-h-\[min(70dvh,560px)\]" components/layout/notification-drawer.tsx` → 1.

### Step 3: Notification empty state gets a floor

Line ~181: `h-full` → `min-h-[260px] py-8`:

```tsx
            <div className="flex flex-col items-center justify-center min-h-[260px] py-8 text-center px-6">
```

Check `uploads-panel.tsx` for an equivalent empty state (grep `h-full` in
the scroll body); if it has one, apply the same change and note it in your
report.

**Verify**: `grep -c "min-h-\[260px\]" components/layout/notification-drawer.tsx` → 1.

### Step 4: Full gate + live check

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` →
all pass; `pnpm lint` → no new errors.

Live check (dev stack usually running): click the bell — a compact popover
under the header, ~260px tall when empty, content behind still visible;
with many notifications it caps at ~560px and scrolls inside. Same for the
upload icon during/after an upload. At 390px width both stay within the
viewport (`max-w-[calc(100vw-1rem)]`). Outside-click still closes both.

## Test plan

Existing suite must stay green (uploads-panel has tests —
`components/layout/__tests__/`; check and run them). No new tests:
shell-class geometry is not JSDOM-testable; grep anchors + live check gate
this.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0 and `pnpm test` exits 0
- [ ] `grep -rc "h-\[calc(100vh-2.75rem)\]" components/layout/` → 0 matches
- [ ] Grep anchors from Steps 1–3 hold
- [ ] `git status --porcelain` shows only the two in-scope files (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either shell class string doesn't match its excerpt.
- The scroll body is no longer `flex-1 overflow-y-auto` in either file
  (content would overflow a capped shell) — report, don't restructure.
- Plan 037 (retheme chrome) has already landed and reshaped these shells —
  the popover conversion belongs on top of ITS markup; report.

## Maintenance notes

- **Plan 037 interplay**: 037's "Current state" describes these as
  full-height drawers. After this plan lands, 037's executor restyles the
  *popover* shells instead — same files, token-only changes; the
  `max-h`/`rounded`/anchoring classes added here must survive. Reconciler:
  refresh 037's expected-drift note when this lands.
- The backdrop is an invisible click-catcher by design (no dim) — a dimmed
  backdrop would fight the "content stays visible" goal of the popover.
- If uploads ever need a detailed management view, add a "View all" footer
  link to a full page rather than re-growing the popover.
