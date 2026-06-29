# Plan 001: Make the share review viewer usable on mobile

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat dfa0ab1..HEAD -- apps/web/app/share/[token]/page.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed`
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UX)
- **Planned at**: commit `dfa0ab1`, 2026-06-28

## Why this matters

On a phone, a reviewer opens a share link and cannot watch the video. The reviewer
page lays the media viewer and a fixed **360px** comment panel side-by-side in a flex
row with no responsive breakpoint, and the panel is open by default. On a 390px-wide
phone the video is crushed into the ~30px that remain. Since this fork's entire purpose
is letting clients review video — often on their phones — this is the single most
important UX bug. After this plan, on small screens the video fills the width and the
comment panel becomes a bottom sheet the reviewer can toggle; on desktop the layout is
unchanged.

## Current state

File: `apps/web/app/share/[token]/page.tsx`

The single-asset reviewer is `ShareViewer`. Its main content row (around lines 745–765):

```tsx
      {/* Main content: viewer + sidebar */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: full-screen media viewer */}
        <ShareMediaViewer
          asset={asset}
          token={token}
          streamUrl={streamUrl}
          streamLoading={streamLoading}
        />

        {/* Right: comments panel */}
        {sidebarOpen && (
          <ShareRightPanel
            token={token}
            asset={asset}
            permission={permission}
            commentRefreshKey={commentKey}
            onCommentPosted={() => setCommentKey((k) => k + 1)}
          />
        )}
      </div>
```

`sidebarOpen` is initialised open (around line 707): `const [sidebarOpen, setSidebarOpen] = React.useState(true)`.

`ShareRightPanel` (around line 565) is the fixed-width panel:

```tsx
    <div className="w-[360px] flex flex-col border-l border-white/[0.06] bg-[#141416] shrink-0 animate-in slide-in-from-right-2 duration-150">
```

The panel is toggled by `ShareTopBar` via `onToggleSidebar={() => setSidebarOpen((p) => !p)}` (around line 740). The same `page.tsx` also renders `FolderShareViewer` for folder/project shares (around line 1060) — **out of scope for this plan**; only the single-asset `ShareViewer` path is touched here.

**Conventions in this repo:**
- Tailwind utility classes only; responsive via `sm:` / `md:` / `lg:` prefixes. The default
  (unprefixed) class is the mobile/base style; prefixed classes apply at breakpoint and up.
  Tailwind's `md` breakpoint is 768px.
- The `cn(...)` class-merge helper lives at `apps/web/lib/utils.ts` and is imported as
  `import { cn } from '@/lib/utils'` (already imported at the top of this file).
- This file already uses `animate-in slide-in-from-*` utilities (tailwindcss-animate), so
  reuse them for the bottom-sheet entrance.

There is **no** `useMediaQuery` hook in `apps/web/hooks/` — do the responsive switch with
Tailwind classes, not JavaScript viewport measurement. Do not add a media-query hook.

## Commands you will need

| Purpose   | Command (run from `/Users/neyako/freeframed`) | Expected on success |
|-----------|-----------------------------------------------|---------------------|
| Install   | `pnpm install`                                | exit 0 (deps already present) |
| Lint      | `pnpm --filter web lint`                      | exit 0, no new errors in this file |
| Typecheck/build | `pnpm --filter web build`               | exit 0, build completes |
| Web tests | `pnpm --filter web test`                      | all pass |

If `pnpm --filter web build` is too slow or fails for unrelated reasons (e.g. missing env),
fall back to a typecheck only: `pnpm --filter web exec tsc --noEmit`. Record which you used.

## Scope

**In scope** (the only file you should modify):
- `apps/web/app/share/[token]/page.tsx`

**Out of scope** (do NOT touch):
- `apps/web/components/share/folder-share-viewer.tsx` — the folder/project grid viewer is a
  separate flow; its mobile layout is not part of this plan.
- `apps/web/components/review/*` — the logged-in dashboard review page. Different layout, not
  the reviewer share path.
- Any change to comment/approval behaviour or data fetching. Layout/responsiveness only.

## Git workflow

- Branch: `advisor/001-mobile-review-layout`
- Commit message style — conventional commits, matching this repo's log
  (e.g. `fix: make share review viewer responsive on mobile`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the content row stack on mobile, side-by-side on desktop

In `ShareViewer`, change the main content container so it is a vertical column on small
screens and a horizontal row from `md` up. Replace the `flex flex-1 ...` row:

- from: `className="flex flex-1 overflow-hidden min-h-0"`
- to:   `className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0"`

This alone makes the panel sit *below* the video on phones instead of beside it.

**Verify**: `grep -n "md:flex-row flex-1 overflow-hidden min-h-0" apps/web/app/share/[token]/page.tsx` → one match.

### Step 2: Make the comment panel full-width on mobile, fixed 360px on desktop

In `ShareRightPanel`, change the panel wrapper so it spans the full width and takes a bounded
height on mobile, and only becomes the fixed 360px left-bordered column at `md` and up.

Replace:

```tsx
    <div className="w-[360px] flex flex-col border-l border-white/[0.06] bg-[#141416] shrink-0 animate-in slide-in-from-right-2 duration-150">
```

with:

```tsx
    <div className="w-full h-[55vh] border-t md:h-auto md:w-[360px] md:border-t-0 md:border-l flex flex-col border-white/[0.06] bg-[#141416] shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
```

Rationale: on mobile the panel is a full-width bottom sheet capped at 55% of viewport height
(so the video above it stays visible); from `md` up it reverts to the original 360px
right-hand column with a left border and slide-from-right animation.

**Verify**: `grep -n "md:w-\[360px\]" apps/web/app/share/[token]/page.tsx` → one match.

### Step 3: Default the panel closed on first paint for small screens

Right now `sidebarOpen` starts `true`, so a phone reviewer lands with the sheet covering more
than half the screen. Start it **closed**, then open it automatically only when the viewport is
desktop-width, so desktop behaviour is unchanged.

Replace the initialiser (around line 707):

```tsx
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
```

with:

```tsx
  const [sidebarOpen, setSidebarOpen] = React.useState(false)

  // Open the comment panel by default on desktop; keep it collapsed on mobile so
  // the video is fully visible on first paint. Reviewers toggle it from the top bar.
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setSidebarOpen(true)
    }
  }, [])
```

768px matches Tailwind's `md` breakpoint used in Steps 1–2. The effect runs once on mount;
SSR renders with the panel closed (correct for the mobile-first default), and desktop opens it
on hydration.

**Verify**: `grep -n "matchMedia('(min-width: 768px)')" apps/web/app/share/[token]/page.tsx` → one match.

### Step 4: Confirm the toggle button is reachable on mobile

The top bar already exposes a toggle via `onToggleSidebar` (around line 740). Confirm
`ShareTopBar` renders its toggle control unconditionally (not hidden behind a desktop-only
`hidden md:flex` class). Open the `ShareTopBar` component in the same file and check the
sidebar-toggle button has no class that hides it below `md`.

- If the toggle is already always visible: no change needed.
- If the toggle button has a `hidden md:*` class on it, remove the `hidden`/`md:` visibility
  prefix so it shows on mobile too. Change nothing else in the top bar.

**Verify**: `pnpm --filter web build` → exit 0. Then read the rendered top-bar JSX and confirm
the toggle button has no `hidden` class gating it below `md`.

### Step 5: Full build + tests

**Verify**:
- `pnpm --filter web lint` → exit 0 (no new errors in `page.tsx`)
- `pnpm --filter web build` → exit 0
- `pnpm --filter web test` → all pass

## Test plan

This is a Tailwind-class layout change; the repo's web tests are vitest unit/component tests
and there is no existing responsive snapshot harness for the share page, so **do not invent a
new test framework**. Instead:

- Run the existing suite (`pnpm --filter web test`) to confirm nothing regressed.
- Manual verification (record results in your report): run `pnpm --filter web dev`, open
  `/share/<any-token>` (or use the share page in Chrome DevTools device toolbar at 390px and at
  1280px). Confirm: (a) at 390px the video is full-width and the comment panel sits below it /
  is collapsed by default and toggles open as a bottom sheet; (b) at 1280px the layout is
  visually identical to before — 360px panel on the right, open by default.

If you cannot run the dev server in your environment, say so explicitly and rely on the build +
lint gates plus a careful re-read of the diff.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter web build` exits 0 (or `tsc --noEmit` if build unavailable — note which)
- [ ] `pnpm --filter web lint` exits 0 with no new errors in `apps/web/app/share/[token]/page.tsx`
- [ ] `pnpm --filter web test` exits 0
- [ ] `grep -n "md:flex-row" apps/web/app/share/[token]/page.tsx` → match (Step 1)
- [ ] `grep -n "md:w-\[360px\]" apps/web/app/share/[token]/page.tsx` → match (Step 2)
- [ ] `grep -n "matchMedia('(min-width: 768px)')" apps/web/app/share/[token]/page.tsx` → match (Step 3)
- [ ] `git -C /Users/neyako/freeframed status --porcelain` shows only `apps/web/app/share/[token]/page.tsx` modified
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live file (the page was refactored since
  commit `dfa0ab1`).
- `ShareViewer` or `ShareRightPanel` no longer exist or were renamed — the layout was
  restructured and this plan's anchors are gone.
- The build fails for reasons in OTHER files (pre-existing breakage); report the error rather
  than "fixing" unrelated code.
- Making the panel responsive would require touching `folder-share-viewer.tsx` or a shared
  layout component — that is out of scope; report what you found.

## Maintenance notes

- The `55vh` mobile sheet height is a deliberate default; if a future change adds a media
  controls bar below the video, re-check that the video + sheet still fit without the page
  scrolling awkwardly.
- If a `useMediaQuery` hook is later added to `apps/web/hooks/`, the inline `matchMedia` effect
  in Step 3 should be migrated to it for consistency.
- The folder/project share viewer (`folder-share-viewer.tsx`) has the *same* class of mobile
  problem and is a natural follow-up; it was intentionally left out to keep this plan small.
- Reviewer should scrutinise: desktop layout is byte-for-byte unchanged (panel still 360px,
  still opens by default), and SSR/hydration doesn't flash the panel open then closed on mobile.
