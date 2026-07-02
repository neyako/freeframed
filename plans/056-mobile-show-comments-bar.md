# Plan 056: Mobile "Show comments" bar below the player (editor + guest review screens)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat bf3d541..HEAD -- "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx" apps/web/components/share/folder-share-viewer.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (edits `folder-share-viewer.tsx`, same file as
  047–049 which are already merged; run alone, not parallel with any other
  plan touching that file)
- **Category**: bug (mobile UX / discoverability)
- **Planned at**: commit `bf3d541`, 2026-07-03

## Why this matters

On mobile, when the comments sheet is closed, the ONLY way to open it is an
icon in the TOP bar (a `Columns2` "slide" icon on the editor page, a
`PanelRightOpen` icon on the guest screen) — while the sheet itself appears
at the BOTTOM, below the player. Users don't connect the two: the maintainer
reports testers can't find how to open comments (2026-07-03, screenshot).
The closed state has no affordance where the panel actually lives.

Decision (maintainer, 2026-07-03): on mobile, add a full-width
**"Show comments (N)"** bar below the player — the mirror image of the
existing "Hide comments" handle — and **remove the top-bar icon toggle on
mobile** (keep it on desktop, where the panel opens at the side and the
icon placement makes sense).

## Current state

Two screens, same pattern.

**Editor page** —
`apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`:

Top-bar icon toggle, lines 402–413 (always visible today):

```tsx
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-md transition-colors',
              sidebarOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover',
            )}
            title="Toggle sidebar"
          >
            <Columns2 className="h-4 w-4" />
          </button>
```

Main content container + viewer column + sidebar, lines 417–435:

```tsx
      {/* ─── Main content: viewer + sidebar ────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* Left: viewer column */}
        <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
          {/* Media viewer */}
          {renderMediaViewer()}
        </div>

        {/* Right: comments sidebar */}
        {sidebarOpen && (
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
            >
              <ChevronDown className="h-4 w-4" />
              Hide comments
            </button>
```

`comments` is in scope (from `useComments(...)`, line ~122; used at
line 137). Lucide imports at the top include `ChevronDown` and `Columns2`
(line ~25/30) but NOT `MessageSquare` — add it. The file uses `cn()` (already
imported).

**Guest screen** — `apps/web/components/share/folder-share-viewer.tsx`,
`ShareReviewInner`:

Top-bar icon toggle, lines 897–899:

```tsx
          <button onClick={() => setSidebarOpen(v => !v)} className="flex items-center justify-center h-8 w-8 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
            {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
```

Main container + sidebar block, lines 903–946 (abridged):

```tsx
      {/* Main: viewer + sidebar */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* Media viewer — reuses project components */}
        ...
        {/* Right sidebar — reuses project comment panel */}
        {sidebarOpen && (
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
```

`comments` is in scope (`const { asset, versions, isLoading, comments, … }
= useReview()`, line ~783). `MessageSquare` and `ChevronDown` are already
in this file's lucide import (lines 10/15). This file uses the `React.`
namespace style.

**Do NOT confuse** `ShareReviewInner`'s toggle with `FolderShareViewer`'s
details-panel toggle (line ~1399, also PanelRight icons) — that one is the
folder-browser panel (plan 049) and is out of scope.

Design constraint: plans 034–040 (pending retheme) restyle these files'
colors. **Layout/behavior only** — reuse the exact class vocabulary of the
existing "Hide comments" handle; no new colors, radii, or fonts.

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass (141 at plan time) |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only files you should modify):

- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`
- `apps/web/components/share/folder-share-viewer.tsx` (`ShareReviewInner`
  only)

**Out of scope** (do NOT touch):

- `FolderShareViewer` / `RightPanel` / `AssetGridCard` in
  `folder-share-viewer.tsx` (plan 049 territory).
- The auto-open effects (048/029) — unchanged; the bar only shows when the
  panel is closed.
- The "Hide comments" handles — already correct.
- Desktop behavior of the icon toggles.
- Any color/typography/radius change (retheme, plans 034–040).

## Git workflow

- Branch: `advisor/056-mobile-show-comments-bar`
- Conventional commit, e.g. `fix(review): mobile show-comments bar below player`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Editor page — hide icon toggle on mobile

Line ~405: in the toggle button's `cn(...)` first string, `'flex …'` →
`'hidden md:flex …'` (keep everything else):

```tsx
              'hidden md:flex items-center justify-center h-8 w-8 rounded-md transition-colors',
```

**Verify**: `grep -c "hidden md:flex items-center justify-center h-8 w-8" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1.

### Step 2: Editor page — "Show comments" bar below the player

Add `MessageSquare` to the lucide import block (~line 25). Then, inside the
main content container, insert between the viewer column's closing `</div>`
and the `{sidebarOpen && (` sidebar block:

```tsx
        {/* Mobile: open-comments affordance where the sheet will appear */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden flex items-center justify-center gap-1.5 w-full py-2.5 text-xs font-medium text-text-secondary border-t border-border bg-bg-secondary shrink-0"
          >
            <MessageSquare className="h-4 w-4" />
            Show comments{comments.length > 0 ? ` (${comments.length})` : ''}
          </button>
        )}
```

**Verify**: `grep -c "Show comments" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1;
`pnpm exec tsc --noEmit` → 0.

### Step 3: Guest screen — hide icon toggle on mobile

`folder-share-viewer.tsx` line ~897: on the `setSidebarOpen(v => !v)`
button, `className="flex items-center …"` → `className="hidden md:flex
items-center …"` (rest unchanged).

**Verify**: `grep -c "hidden md:flex items-center justify-center h-8 w-8 rounded-md text-text-secondary" components/share/folder-share-viewer.tsx` → 1.

### Step 4: Guest screen — "Show comments" bar below the player

In `ShareReviewInner`, insert the same bar between the media-viewer column's
closing tag and the `{sidebarOpen && (` sidebar block (before the
`{/* Right sidebar … */}` comment). Identical JSX to Step 2 — this file
already imports `MessageSquare`.

**Verify**: `grep -c "Show comments" components/share/folder-share-viewer.tsx` → 1.

### Step 5: Full gate + live check

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` →
all pass; `pnpm lint` → no new errors.

Live check (dev stack usually running), DevTools emulation at 390×844:

- Editor asset page, no comments: panel closed, a full-width
  "Show comments" bar sits directly under the player; tapping it opens the
  55vh sheet whose top row is "Hide comments"; the top bar has NO Columns2
  icon. Desktop ≥768px: icon present, no bar.
- Guest single-asset share: same behavior; top-bar PanelRight icon hidden
  on mobile, present on desktop.

## Test plan

Viewport-conditional layout in dynamic-import-wrapped components — grep
anchors + suite green + live check gate this (same rationale as plans
048/049). Do not write JSDOM class-string tests.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0 and `pnpm test` exits 0
- [ ] Grep anchors from Steps 1–4 all hold
- [ ] `git status --porcelain` shows only the two in-scope files (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either toggle-button excerpt doesn't match (someone reworked the top bars).
- The sidebar blocks are no longer gated on `sidebarOpen && …` in either
  file.
- `comments` is not in scope where the bar is inserted (hook signature
  changed) — report, don't re-plumb data.

## Maintenance notes

- Plan 039 (retheme) sweeps `folder-share-viewer.tsx` colors — the bar
  reuses existing tokens only, so its classes must simply survive.
- If a future plan collapses the two review screens into one component
  (deferred round-4 idea), carry this affordance pattern: the OPEN control
  must live where the panel appears.
- Reviewer: confirm the bar doesn't render on desktop (`md:hidden`) and
  that the editor page's `activeTab` default ('comments') still makes the
  sheet open on the Comments tab.
