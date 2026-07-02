# Plan 048: Make the guest single-asset share screen usable on phones (stacked layout + dvh)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/components/share/folder-share-viewer.tsx`
> Plan 047 also edits this file and is expected to land first — its changes
> (a `streamInfo` state/effect + `poster` prop in the video branch) do NOT
> conflict with the lines this plan touches. Any OTHER drift in the excerpts
> below is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/047-guest-share-video-stream-fix.md (same file/function; ordering only)
- **Category**: bug (mobile UX)
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

On a phone, a guest opening a single-asset share link sees the video squeezed
into a ~25px vertical sliver: the comments sidebar is a fixed 360px column,
open by default, in a layout that never stacks. Reproduced live at a 390px
viewport on 2026-07-03 (matches the maintainer's bug screenshot). Guests are
reviewers on the go — this screen is the single most mobile-visited surface
of the product. The editor review page solved the identical problem
(plans 011/021/029: stack below `md`, bottom-sheet comments at `55vh`,
desktop-only default-open); plan 032 rerouted guests to `ShareReviewInner`
without porting that treatment. Additionally the screen uses `h-screen`
(100vh), which on iOS Safari hides the bottom comment input behind the
browser toolbar — `dvh` fixes that.

## Current state

Relevant file: `apps/web/components/share/folder-share-viewer.tsx` —
`ShareReviewInner` (line ~773) renders the guest single-asset review screen
(used both by direct asset shares and by the folder-share `AssetViewer`
overlay).

Sidebar state, `folder-share-viewer.tsx:784` — open unconditionally:

```tsx
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
```

Root + main containers, `folder-share-viewer.tsx:846-847` and `:874`:

```tsx
  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
```

```tsx
      {/* Main: viewer + sidebar */}
      <div className="flex flex-1 overflow-hidden min-h-0">
```

Sidebar, `folder-share-viewer.tsx:914-915` — fixed width, never stacks:

```tsx
        {sidebarOpen && (
          <div className="w-[360px] flex flex-col border-l border-border bg-bg-secondary shrink-0">
```

Two loader screens in the same file also use `h-screen`
(`folder-share-viewer.tsx:751` and `:843`):

```tsx
    return <div className="flex items-center justify-center h-screen bg-bg-primary"><Loader2 className="h-8 w-8 animate-spin text-text-tertiary" /></div>
```

The top bar already has a working sidebar toggle
(`folder-share-viewer.tsx:867-869`, `PanelRightClose`/`PanelRightOpen`) —
keep it; it is the mobile "open comments" affordance.

**The pattern to copy** — the editor review page, which handles the same
layout correctly:

`apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx:130-141`
(desktop-only default-open, runs once):

```tsx
  // Open the comments panel by default on desktop; on mobile keep it hidden
  // unless the asset already has comments. Runs once; the user's later choice sticks.
  useEffect(() => {
    if (autoOpenedRef.current) return
    const isDesktop =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches
    if (isDesktop || comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])
```

Same file `:418` (stacking container) and `:427-434` (responsive sidebar +
mobile hide handle):

```tsx
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
```

```tsx
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
            >
              <ChevronDown className="h-4 w-4" />
              Hide comments
            </button>
```

Conventions: Tailwind 3.4 (dvh utilities like `h-dvh` are built in);
`md` = 768px is the repo's mobile/desktop breakpoint everywhere
(`matchMedia('(min-width: 768px)')`).

Design-constraint note: plans 034–040 (pending monochrome retheme) restyle
colors/typography in this file. This plan must change **layout classes only**
— do not touch colors, borders-color tokens, radii, or fonts.

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0 (pnpm ONLY — never npm) |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass            |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only file you should modify):

- `apps/web/components/share/folder-share-viewer.tsx` — `ShareReviewInner`
  and the two loader lines only (751, 843).

**Out of scope** (do NOT touch):

- `FolderShareViewer` and `RightPanel` in the same file — that is plan 049.
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` — the
  exemplar; already correct.
- `app/share/[token]/page.tsx` — routing/validation only, no layout problem.
- Any color/typography/radius class (retheme territory, plans 034–040).

## Git workflow

- Branch: `advisor/048-guest-asset-share-mobile-layout`
- Conventional commits, e.g. `fix(share): stack guest review screen on mobile`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Desktop-only default-open sidebar

In `ShareReviewInner`, replace `React.useState(true)` (line ~784) with
`React.useState(false)` and add the run-once auto-open effect, mirroring the
editor page exemplar quoted above. `comments` is already available from
`useReview()` in this function. Add `const autoOpenedRef = React.useRef(false)`
next to the other refs. Use `React.useEffect`/`React.useRef` (this file uses
the `React.` namespace style).

**Verify**: `grep -n "matchMedia('(min-width: 768px)')" apps/web/components/share/folder-share-viewer.tsx`
→ ≥1 match inside `ShareReviewInner`.

### Step 2: Stack the main container below `md`

Line ~874: `flex flex-1 overflow-hidden min-h-0` →
`flex flex-col md:flex-row flex-1 overflow-hidden min-h-0`.

**Verify**: `grep -n "flex flex-col md:flex-row flex-1 overflow-hidden min-h-0" apps/web/components/share/folder-share-viewer.tsx` → 1 match in `ShareReviewInner`.

### Step 3: Responsive sidebar + mobile hide handle

Line ~915: replace the sidebar wrapper classes with the editor-page pattern:

```tsx
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
```

Immediately inside it, before the tabs div, add the mobile-only hide handle
(import `ChevronDown` from `lucide-react` — check the file's existing lucide
import at the top and extend it):

```tsx
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
            >
              <ChevronDown className="h-4 w-4" />
              Hide comments
            </button>
```

**Verify**: `grep -n "Hide comments" apps/web/components/share/folder-share-viewer.tsx` → 1 match.

### Step 4: `h-screen` → `h-dvh`

Replace `h-screen` with `h-dvh` at the three spots (lines ~751, ~843, ~847 —
two loaders + the `ShareReviewInner` root). Do NOT change the `min-h-screen`
occurrences elsewhere in the file (those belong to `FolderShareViewer`,
plan 049's territory).

**Verify**: `grep -c "h-screen" apps/web/components/share/folder-share-viewer.tsx`
→ counts only the `min-h-screen` occurrences (currently 1, at line ~1253);
`grep -c "h-dvh" apps/web/components/share/folder-share-viewer.tsx` → 3.

### Step 5: Full gate

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0;
`pnpm test` → all pass; `pnpm lint` → no new errors.

Live check (only if dev stack running): open a single-asset share link with
Chrome DevTools device emulation at 390×844 — video fills the width; comments
appear as a bottom sheet only after tapping the panel toggle (or by default
if comments exist); "Hide comments" handle closes it. On desktop width the
sidebar is open by default on the right, unchanged.

## Test plan

Layout-class change in a component wrapped in dynamic imports — not
unit-testable with the current test setup at reasonable cost. The gate is:
existing suite stays green + the grep anchors in each step + the live check.
Do not write a JSDOM test that asserts class strings.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0
- [ ] `grep -c "w-\[360px\]" components/share/folder-share-viewer.tsx` → 0 bare occurrences (only `md:w-[360px]` remains)
- [ ] Grep anchors from Steps 1–4 all hold
- [ ] `git status --porcelain` shows only `folder-share-viewer.tsx` (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `ShareReviewInner` no longer matches the excerpts beyond plan 047's
  documented changes (streamInfo effect, `poster` prop).
- Plan 047 has NOT been executed and you find the `videoStreamUrl`
  construction still present — 047 must land first; report the ordering
  problem instead of doing both plans at once.
- The sidebar toggle in the top bar (PanelRightClose/Open) has been removed —
  mobile would have no way to reopen the panel; report instead of inventing a
  new affordance.

## Maintenance notes

- Plan 039 (retheme, guest-viewer sweep) will restyle this file's colors —
  layout classes introduced here must survive that; they use no color tokens.
- Plan 049 applies the same stacking recipe to `FolderShareViewer` in this
  file; if both are dispatched, run them sequentially (this one first).
- Reviewer: check the auto-open effect runs once (ref guard) — a naive
  `useEffect` on `comments.length` would fight the user's manual close on
  every comment poll.
