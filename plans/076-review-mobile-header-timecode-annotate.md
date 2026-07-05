# Plan 076: Review screen mobile — trim header actions, center timecode, annotate maximizes space

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Base**: `preview/round10-view` @ `0f22124` (contains 070/072/073/074/075).
>
> **Drift check (run first, all must pass)**:
> - `grep -Fc 'flex items-center justify-between h-12 px-2 sm:px-4' apps/web/components/review/video-player.tsx` → `1`
> - `grep -Fc 'loop={loop}' apps/web/components/review/video-player.tsx` → `1` (073 present)
> - `grep -Fc 'w-full h-[55vh] md:h-auto md:w-[372px]' "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: 073 merged (transport bar layout), 056 (mobile comments sheet)
- **Category**: mobile / design-conformance
- **Planned at**: written 2026-07-05 against `preview/round10-view` @ `0f22124`

## Why this matters

Maintainer QA of the review screen at mobile width, three findings:

1. **Header crowding**: the review header shows VersionSwitcher + "New version"
   + "Share" at all widths. Spec screen 1c header = Back, title, version chip
   only. Hide New version and Share below `md`; keep the version switcher.
2. **Timecode off-center**: the transport bar is `flex justify-between`, so the
   timecode pill centers between unequal wings (left: skips/play/loop/speed/
   volume; right: quality/fullscreen) — visually off-center. The spec uses a
   `1fr auto 1fr` grid so the timecode is truly centered regardless of wing
   width.
3. **Annotate mode wastes space**: when drawing an annotation on mobile, the
   comment LIST panel stays open (55vh sheet), squeezing the video. Per the
   design intent: while annotating on mobile, hide the comment list but keep
   the comment input (with its annotation toolbar). Desktop unchanged.

## Current state

### `apps/web/components/review/video-player.tsx`

Transport bar (line 373; after 073 the left wing has mobile skip buttons and a
`hidden sm:flex` loop button):

```tsx
{/* Bottom transport bar (matches audio player style) */}
<div className="flex items-center justify-between h-12 px-2 sm:px-4 bg-bg-secondary border-t border-border shrink-0">
  {/* Left: Play, Loop, Speed, Volume */}
  <div className="flex items-center gap-1 sm:gap-2">        // line 375
  ...
  {/* Center: Timecode display with format picker */}
  <div className="relative" ref={timeFormatRef}>            // line 439
  ...
  {/* Right: Quality, Fullscreen */}
  <div className="flex items-center gap-1 sm:gap-2">        // line 498
```

### `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`

Header right cluster (lines ~374-412): `VersionSwitcher`, then the New version
button, then `<ShareDialog ...>` (renders its own trigger button), then the
sidebar toggle (already `hidden md:flex`):

```tsx
<VersionSwitcher versions={versions} />
<button
  onClick={() => versionFileInputRef.current?.click()}
  className="inline-flex h-[34px] items-center gap-2 rounded border border-border-strong px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary hover:border-text-primary hover:bg-bg-hover transition-colors"
  title="Upload new version"
>
  <Upload className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">New version</span>
</button>
<ShareDialog assetId={asset.id} assetName={asset.name} projectId={projectId} asset={asset} />
```

Mobile comments sheet (lines ~423-467). `isDrawingMode` is already destructured
from the review store at line ~50. `cn` is imported.

```tsx
{!sidebarOpen && (
  <button
    onClick={() => setSidebarOpen(true)}
    className="md:hidden flex items-center justify-center gap-1.5 w-full py-2.5 text-xs font-medium text-text-secondary border-t border-border bg-bg-secondary shrink-0"
  >
    <MessageSquare className="h-4 w-4" />
    Show comments{comments.length > 0 ? ` (${comments.length})` : ''}
  </button>
)}

{/* Right: comments sidebar */}
{sidebarOpen && (
  <div className="w-full h-[55vh] md:h-auto md:w-[372px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
    <button
      onClick={() => setSidebarOpen(false)}
      className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
    >
      <ChevronDown className="h-4 w-4" />
      Hide comments
    </button>

    {/* Content */}
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <CommentPanel ... />
      {canComment && (
        <CommentInput ... annotationData={annotationData} />
      )}
    </div>
  </div>
)}
```

### Repo conventions

- Review page mobile/desktop split uses the `md` breakpoint (sidebar toggle
  `hidden md:flex`, sheet `md:w-[372px]`). Use `md` here, not `lg`.
- Tailwind tokens only; `cn` for conditional classes.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope** (2 files): `apps/web/components/review/video-player.tsx`,
`apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`.

**Out of scope**: `VersionSwitcher`, `ShareDialog` internals, `CommentPanel`
internals, `CommentInput` internals, `annotation-*.tsx`, the review store,
`audio-player.tsx`, `share-video-player.tsx`, desktop rendering.

## Git workflow

- Branch: `advisor/076-review-mobile-header-timecode-annotate`
- Commit: `fix(web): review mobile — trim header, center timecode, annotate space (plan 076)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Truly centered timecode (grid transport)

In `video-player.tsx`:
- Line 373 container: `className="flex items-center justify-between h-12 px-2 sm:px-4 bg-bg-secondary border-t border-border shrink-0"`
  → `className="grid grid-cols-[1fr_auto_1fr] items-center h-12 px-2 sm:px-4 bg-bg-secondary border-t border-border shrink-0"`
- Line 375 left wing: `className="flex items-center gap-1 sm:gap-2"` → `className="flex items-center gap-1 sm:gap-2 justify-self-start"`
- Line 439 center: `className="relative"` → `className="relative justify-self-center"`
- Line 498 right wing: `className="flex items-center gap-1 sm:gap-2"` → `className="flex items-center gap-1 sm:gap-2 justify-self-end"`

**Verify**: `grep -Fc 'grid grid-cols-[1fr_auto_1fr] items-center h-12' apps/web/components/review/video-player.tsx` → `1`
and `grep -Fc 'justify-self-' apps/web/components/review/video-player.tsx` → `3`

### Step 2: Hide New version + Share below `md`

In `[assetId]/page.tsx`:
- New version button: `className="inline-flex h-[34px] ..."` → `className="hidden md:inline-flex h-[34px] ..."` (keep the rest of the string).
- Wrap the ShareDialog in a mobile-hidden div:
  ```tsx
  <div className="hidden md:block">
    <ShareDialog assetId={asset.id} assetName={asset.name} projectId={projectId} asset={asset} />
  </div>
  ```
  (ShareDialog renders its own trigger; wrapping hides the trigger below `md`.
  Do not modify ShareDialog itself.)

**Verify**: `grep -Fc 'hidden md:inline-flex h-[34px]' "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`
and `grep -Fc '<div className="hidden md:block">' "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`

### Step 3: Annotating on mobile hides the comment list, keeps the input

In `[assetId]/page.tsx`, three conditional-class changes inside the
`{sidebarOpen && (...)}` sheet (use `cn`; `isDrawingMode` already in scope):

1. Sheet container — compact when annotating on mobile (list hidden, input
   remains):
   `className="w-full h-[55vh] md:h-auto md:w-[372px] flex flex-col ..."` →
   ```tsx
   className={cn(
     'w-full flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150 md:h-auto md:w-[372px]',
     isDrawingMode ? 'h-auto' : 'h-[55vh]',
   )}
   ```
2. "Hide comments" collapse button — hide while annotating (it collapses a
   list that is already hidden):
   `className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"` →
   ```tsx
   className={cn(
     'md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border',
     isDrawingMode && 'hidden',
   )}
   ```
3. Wrap `<CommentPanel ... />` in a div that hides below `md` while annotating:
   ```tsx
   <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden', isDrawingMode && 'hidden md:flex')}>
     <CommentPanel ... />
   </div>
   ```
   The existing outer `{/* Content */}` div keeps `flex-1 flex flex-col min-h-0 overflow-hidden`;
   `CommentInput` stays OUTSIDE the new wrapper (always visible when
   `canComment`).

**Verify**: `grep -Fc "isDrawingMode ? 'h-auto' : 'h-[55vh]'" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`
and `grep -Fc "isDrawingMode && 'hidden md:flex'" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test — conditional Tailwind classes on existing state. Gate + greps
cover it. If an existing test asserts the transport bar's flex classes or the
sheet's fixed `h-[55vh]`, update it and say so in NOTES.

## Done criteria

- [ ] Gate green (tsc 0, tests pass, build 0)
- [ ] All step greps return expected counts
- [ ] Mobile (<`md`) review header: Back, title, version switcher only
- [ ] Transport timecode visually centered (grid `1fr auto 1fr`)
- [ ] Mobile annotate mode: comment list hidden, comment input + annotation
      toolbar visible, video area grows
- [ ] Desktop (`md`+): identical to before (all header buttons, full sidebar,
      annotate does NOT hide the desktop comment list)
- [ ] Only the 2 in-scope files modified

## STOP conditions

- Drift greps fail → wrong base; STOP.
- `isDrawingMode` no longer available in the page component → STOP and report
  (do not import the store ad hoc without checking how the page consumes it).
- The sheet/content structure differs materially from the excerpt → adapt
  minimally; STOP if the sidebar was reworked.

## Maintenance notes

- The timecode grid assumes exactly three transport children (left wing,
  timecode, right wing) — adding a fourth top-level child breaks centering.
- Annotate-hides-list is mobile-only by design; desktop keeps the list for
  context while drawing.
- `share-video-player.tsx` (guest) has its own transport bar; if guests report
  the same off-center timecode, apply the same grid there as a follow-up.
