# Plan 050: Share popover fits every viewport — scrollable, wide enough for its rows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/components/review/share-dialog.tsx "apps/web/app/(dashboard)/projects/[id]/page.tsx"`
> On drift in the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (mobile UX)
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

The share popover (review top bar) has two fit bugs, both captured in the
maintainer's screenshots:

1. At `sm`–`md` widths it is a fixed 320px (`sm:w-80`) — too narrow for the
   Visibility row, whose "Anyone with the link" select squeezes the label
   down to a clipped "Visibilit".
2. It has **no max-height and no scrolling**. Its content stack (link + 7
   control rows + invite section) fills ~776px; on short viewports (phone
   landscape, small laptops, or with the people section expanded) the bottom
   controls — including **Revoke link** — extend past the viewport and are
   unreachable.

The project page's centered share dialog has the same missing-max-height
problem.

## Current state

Relevant files:

- `apps/web/components/review/share-dialog.tsx` — `ShareDialog` renders the
  popover in the asset review top bar (lines 118–132).
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` — the project page's
  share dialog (Radix Dialog, lines 1043–1097) hosting `SharePanel` /
  `BulkSharePanel`.
- `apps/web/components/review/share-link-controls.tsx` — the control rows;
  structurally fine (`ControlRow` truncates the label via `min-w-0`), no
  change needed here.

Popover wrapper, `share-dialog.tsx:118-125`:

```tsx
      {dropdownOpen && (
        <div
          className={cn(
            "fixed left-2 right-2 top-12 z-50 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80",
            "rounded-xl border border-border bg-bg-elevated p-3 shadow-xl",
            "animate-in fade-in-0 zoom-in-95 duration-150 space-y-4",
          )}
        >
```

Project-page dialog content, `app/(dashboard)/projects/[id]/page.tsx:1045`:

```tsx
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
```

Conventions: Tailwind 3.4 (arbitrary values + `dvh` supported). Plans 034–040
(pending retheme) will restyle colors/radii — change sizing/overflow classes
only.

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass (share-dialog tests exist: `components/review/__tests__/share-dialog*.test.tsx`) |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only files you should modify):

- `apps/web/components/review/share-dialog.tsx` (the popover class string only)
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` (the `Dialog.Content`
  class string at line ~1045 only)

**Out of scope** (do NOT touch):

- `share-link-controls.tsx`, `share-link-control-primitives.tsx`,
  `share-visibility-select.tsx`, `share-permission-select.tsx` — rows are
  fine once the container is wide enough.
- `share-bulk-panel.tsx`, `share-direct-panel.tsx` — content, not container.
- Popover behavior (outside-click, escape) — working.

## Git workflow

- Branch: `advisor/050-share-popover-fit`
- Conventional commit, e.g. `fix(share): share popover scrolls and fits its rows`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Review-page popover — wider at sm, scrollable everywhere

In `share-dialog.tsx:121`, change the first class line to:

```tsx
            "fixed left-2 right-2 top-12 z-50 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-96",
            "max-h-[calc(100dvh-4.5rem)] sm:max-h-[min(calc(100dvh-8rem),42rem)] overflow-y-auto overscroll-contain",
```

(i.e. `sm:w-80` → `sm:w-96`, plus the new max-height/overflow line; the other
two class lines stay unchanged.)

Rationale: 384px gives the Visibility row ~120px of label space; the mobile
max-height leaves the fixed `top-12` anchor plus a margin; the `sm` bound
keeps it under the trigger without covering the transport bar.

**Verify**: `pnpm test -- share-dialog` → the existing share-dialog tests pass;
`grep -c "overflow-y-auto" apps/web/components/review/share-dialog.tsx` → 1.

### Step 2: Project-page share dialog — cap height, scroll inside

In `app/(dashboard)/projects/[id]/page.tsx:1045`, add to the
`Dialog.Content` class string (keep everything else):

```
max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain
```

**Verify**: `grep -n "max-h-\[calc(100dvh-2rem)\]" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → 1 match at the Dialog.Content line.

### Step 3: Full gate

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm lint` → no new errors.

Live check (only if dev stack running): review page → Share; at 700×500
emulated viewport all rows reachable by scrolling inside the popover, and at
~700px width the "Visibility" label is fully visible. Project page → share a
folder → dialog scrolls internally on a short viewport.

## Test plan

Existing `share-dialog` tests must stay green. No new tests required —
class-string assertions in JSDOM are noise; grep anchors + live check gate
this.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0
- [ ] `grep -c "sm:w-80" components/review/share-dialog.tsx` → 0
- [ ] Grep anchors from Steps 1–2 hold
- [ ] `git status --porcelain` shows only the two in-scope files (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The popover class string at `share-dialog.tsx:121` doesn't match the excerpt.
- The project-page dialog has been replaced by a different share surface.
- Widening to `sm:w-96` still clips the Visibility label (measure in the live
  check) — report; do not start restructuring `ControlRow`.

## Maintenance notes

- Plan 037 (retheme chrome) restyles drawer/palette shells and may re-skin
  this popover — the sizing classes added here must be carried over.
- If share controls grow further (new rows), the popover approaches its
  max-height on laptops — consider promoting it to a proper Dialog on mobile
  at that point (deferred).
