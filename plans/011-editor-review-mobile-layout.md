# Plan 011: Responsive mobile layout for the editor review page (stack viewer + comments, like the share viewer)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx" "apps/web/app/share/[token]/page.tsx"`
> If `assets/[assetId]/page.tsx` changed since this plan was written, compare the
> "Current state" excerpts below against the live file before editing; on a
> mismatch, treat it as a STOP condition. (`share/[token]/page.tsx` is the
> reference pattern — read-only here.)

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW (one page component; reuses a pattern already shipped in this repo)
- **Depends on**: none (Plan 001 already shipped the identical pattern on the share viewer — this
  copies it to the editor page)
- **Category**: bug / DX (mobile UX)
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

The **logged-in editor review page** (`/projects/{id}/assets/{assetId}`) uses a hard-coded desktop
two-column layout: a `flex-1` media viewer next to a **fixed `w-[360px]` comments sidebar**, in a row
that never stacks. On a phone the 360px sidebar alone is wider than the viewport, so the video
collapses to a thin vertical sliver and the page is unusable on mobile (confirmed by a user testing
the running instance). Plan 001 already solved exactly this for the **public share viewer**
(`/share/{token}`) by making the layout stack vertically below 768px (video on top, comments as a
55vh panel below) and defaulting the comments panel open only on desktop. This plan applies the same,
already-proven pattern to the editor page so the two review surfaces behave consistently on mobile.

## Current state

### The broken layout — `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`

State (lines ~56–58):

```tsx
  const [activeTab, setActiveTab] = useState<'comments' | 'fields'>('comments')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const deepLinkApplied = useRef(false)
```

The main content row + sidebar (lines ~402–412) — **this is the bug**:

```tsx
      {/* ─── Main content: viewer + sidebar ────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: viewer column */}
        <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
          {/* Media viewer */}
          {renderMediaViewer()}
        </div>

        {/* Right: comments sidebar */}
        {sidebarOpen && (
          <div className="w-[360px] flex flex-col border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-right-2 duration-150">
```

`flex` (no `flex-col`) means viewer and the 360px sidebar always sit side-by-side; on a 390px-wide
phone the sidebar consumes nearly the whole width and the viewer is crushed.

The top bar (lines ~378–385) has a full-label "New Version" button that wraps to two lines on a narrow
viewport:

```tsx
          <button
            onClick={() => versionFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-8 text-xs font-medium border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Upload new version"
          >
            <Upload className="h-3.5 w-3.5" />
            New Version
          </button>
```

And the asset-position counter (lines ~346–348):

```tsx
            <span className="text-xs text-text-secondary tabular-nums px-1">
              {currentIndex + 1} of {totalAssets}
            </span>
```

### The reference pattern (already shipped) — `apps/web/app/share/[token]/page.tsx`

**Read this file; do not modify it.** Plan 001 made the share viewer responsive. Copy its exact
Tailwind recipe:

- Default the comments panel **closed**, then open it only on desktop via `matchMedia` (lines ~707–715):

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

- The main row stacks on mobile, becomes a row at `md` (line ~754):

  ```tsx
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
  ```

- The sidebar is a full-width 55vh bottom panel on mobile, a fixed 360px right column at `md`
  (line ~565):

  ```tsx
      <div className="w-full h-[55vh] border-t md:h-auto md:w-[360px] md:border-t-0 md:border-l flex flex-col border-white/[0.06] bg-[#141416] shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
  ```

The editor page already has a sidebar-toggle button in its top bar (the `Columns2` button, lines
~387–398) wired to `setSidebarOpen`, so on mobile a user can collapse the panel to see the video full
height — same affordance as the share viewer.

### Conventions to follow

- Tailwind utility classes, `cn()` from `@/lib/utils` for conditional classes (already imported).
- Mobile-first breakpoint is **`md` (768px)** throughout this codebase (matches Plan 001). Use `md:`
  prefixes; never invent a new breakpoint.
- The editor page keeps its theme tokens (`border-border`, `bg-bg-secondary`, `text-text-*`) — do NOT
  swap them for the share viewer's raw `white/[0.06]` / `#141416` colors. Only copy the **layout**
  utilities (`flex-col`/`md:flex-row`, `w-full h-[55vh]`/`md:w-[360px]`, `border-t`/`md:border-l`,
  the `slide-in-from-bottom-2 md:slide-in-from-right-2` animation), keep this page's existing colors.

## Commands you will need

| Purpose | Command (from `/Users/neyako/freeframed`) | Expected |
|---------|-------------------------------------------|----------|
| Install web deps (first time in a fresh worktree) | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Typecheck / build the web app | `cd apps/web && pnpm build` | exit 0 (compiles) |
| Anchor greps (machine-checkable gate) | see Done criteria | matches |

Note: the file path contains parentheses and brackets — **always quote it** in shell commands:
`"apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"`. If `pnpm build` cannot run
(no network for install), the grep anchors + a manual viewport check are the fallback gate — say so in
your report.

## Scope

**In scope** (edit this one file only):
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`
  - default `sidebarOpen` to `false` + add the desktop `matchMedia` effect,
  - make the main content row `flex flex-col md:flex-row`,
  - make the sidebar a `w-full h-[55vh] … md:w-[360px]` panel,
  - hide the "New Version" text label and the "X of N" counter on narrow viewports (icon/buttons stay).

**Out of scope** (do NOT touch):
- `apps/web/app/share/[token]/page.tsx` — the reference only; already responsive.
- The dashboard shell `apps/web/app/(dashboard)/layout.tsx` (the left nav rail). Making the global
  rail collapse on mobile is a **separate** follow-up (note it in your report as a candidate Plan 013);
  this plan fixes the acute problem — the crushed viewer — not the whole shell.
- `components/review/*` (CommentPanel, CommentInput, VideoPlayer, VersionSwitcher, ShareDialog) — they
  already render inside the sidebar/top bar; no changes needed. If one looks broken on mobile, report
  it; do not refactor it here.
- Any API, store, or hook.

## Git workflow

- Branch: `advisor/011-editor-review-mobile-layout`
- Conventional commit (e.g. `fix(web): make editor review page responsive on mobile`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Default the sidebar closed; auto-open only when the asset has comments (#5)

The panel must **not** show by default when the asset has no comments (request #5) — it opens
automatically the first time comments exist, and the user can always toggle it from the top-bar
`Columns2` button. This replaces the old "always open on desktop" default.

Change line ~57 from:

```tsx
  const [sidebarOpen, setSidebarOpen] = useState(true)
```

to:

```tsx
  const [sidebarOpen, setSidebarOpen] = useState(false)
```

Then add this effect. Place it immediately after the state declarations (e.g. right after the
`deepLinkApplied` ref on line ~58, before the `useSWR(folderTree…)` block). `useEffect` and `useRef`
are already imported (line 3); `comments` comes from the `useComments(...)` hook already used on this
page (line ~119):

```tsx
  // Auto-open the comments panel once, only when the asset actually has comments (#5).
  // Empty assets start with the panel hidden so the media fills the screen; the user
  // can open it any time via the top-bar toggle, and their choice then sticks.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (comments.length > 0) {
      setSidebarOpen(true)
      autoOpenedRef.current = true
    }
  }, [comments.length])
```

**Verify**: `grep -n "autoOpenedRef" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → ≥ 2 matches (the ref + the effect).

### Step 2: Make the main content row stack on mobile

Change line ~403 from:

```tsx
      <div className="flex flex-1 overflow-hidden min-h-0">
```

to:

```tsx
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
```

**Verify**: `grep -n "flex flex-col md:flex-row flex-1 overflow-hidden min-h-0" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → one match.

### Step 3: Make the sidebar a full-width 55vh panel on mobile

Change the sidebar wrapper (line ~412) from:

```tsx
          <div className="w-[360px] flex flex-col border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-right-2 duration-150">
```

to:

```tsx
          <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
```

This keeps the page's existing theme colors (`border-border`, `bg-bg-secondary`) and only changes the
**layout** (full-width bottom panel on mobile → 360px right column at `md`, with the border moving from
top to left and the slide-in animation switching from bottom to right).

**Verify**: `grep -n "w-full h-\[55vh\] md:h-auto md:w-\[360px\]" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → one match.

### Step 4: De-clutter the top bar on narrow viewports

Two small changes so the top bar fits a phone (no wrapping).

(a) Hide the "New Version" **text** below `sm` (the upload icon stays, so the button is still usable).
In the button at lines ~378–385, wrap the label:

```tsx
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Version</span>
```

(b) Hide the "X of N" counter below `sm` (the prev/next chevrons stay). Change line ~346 from:

```tsx
            <span className="text-xs text-text-secondary tabular-nums px-1">
```

to:

```tsx
            <span className="hidden sm:inline text-xs text-text-secondary tabular-nums px-1">
```

**Verify**: `grep -n "hidden sm:inline" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → at least two matches.

### Step 5: Build / typecheck

**Verify**: `cd apps/web && pnpm install --frozen-lockfile && pnpm build` → exit 0 (the page compiles;
no TypeScript or Tailwind errors). If install/build cannot run in your environment, say so and rely on
the grep anchors + the manual check below as the gate.

## Test plan

- **Automated gate**: the Step 1–4 grep anchors + a clean `pnpm build`. There is no component test for
  this page in the repo (consistent with how Plan 001 shipped — anchors + build were its gate).
- **Manual (do if you can run the app; otherwise describe and rely on the gate)**: open
  `/projects/{id}/assets/{assetId}` for a video asset and resize the browser (or DevTools device mode):
  1. **At ≥768px (desktop)**: viewer on the left, 360px comments panel on the right. Panel is **open
     only if the asset has comments** (#5); on an asset with zero comments it starts closed and the
     `Columns2` toggle opens it.
  2. **At ~390px (phone)**: the **viewer is full-width on top**, the comments panel is a full-width
     panel (~55vh) **below** it (not beside), the video is clearly visible (no sliver), the top bar
     fits on one line (no "New Version" wrap), and the `Columns2` toggle hides/shows the panel.
  3. The `Fields` tab and comment input still work inside the mobile panel.

## Done criteria

ALL must hold (run greps from `/Users/neyako/freeframed`, path quoted):

- [ ] `grep -n "flex flex-col md:flex-row flex-1 overflow-hidden min-h-0" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → match
- [ ] `grep -n "w-full h-\[55vh\] md:h-auto md:w-\[360px\]" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → match
- [ ] `grep -n "autoOpenedRef" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → ≥ 2 matches (panel auto-opens only when comments exist, #5)
- [ ] `grep -c "hidden sm:inline" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → ≥ 2
- [ ] `grep -n "useState(true)" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` does **not** match the `sidebarOpen` line (it is now `useState(false)`)
- [ ] `cd apps/web && pnpm build` exits 0 (or, if unrunnable, manual viewport check recorded)
- [ ] Only `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The main content row / sidebar in `assets/[assetId]/page.tsx` no longer matches the "Current state"
  excerpt (it was refactored since `d229011`) — the class strings to replace moved; report what you
  found instead of guessing.
- The share viewer (`share/[token]/page.tsx`) no longer uses the `flex flex-col md:flex-row` +
  `md:w-[360px]` pattern (the reference changed) — note it; the copy target may need rethinking.
- `pnpm build` fails for a reason unrelated to your change (pre-existing break) — report the error;
  do not "fix" unrelated code.
- You find yourself needing to edit `components/review/*` or the dashboard layout to make the page
  usable — that is out of scope; report it as a follow-up rather than expanding this plan.

## Maintenance notes

- This is the **second** surface to get the mobile treatment; the share viewer (Plan 001) was the
  first. If a third review surface appears, factor the shared shell into a component rather than
  copying the Tailwind recipe a third time.
- **Known follow-up (not this plan)**: the dashboard shell `app/(dashboard)/layout.tsx` left nav rail
  does not collapse on mobile and still consumes ~56px. That is a separate, larger change (global
  navigation / drawer) — candidate Plan 013.
- `h-[55vh]` for the mobile panel matches Plan 001 deliberately; if you tune it, tune both pages
  together so the two review surfaces stay consistent.
- Reviewer should scrutinise: desktop layout is byte-for-byte unchanged (only `md:`-prefixed and
  mobile-only classes were added/flipped), and the existing `Columns2` toggle still hides the panel on
  mobile (so the viewer can go full-height).
