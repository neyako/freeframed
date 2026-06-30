# Plan 021: Rework the editor/review page for mobile (full-bleed viewer + bottom-sheet comments)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx" "apps/web/app/(dashboard)/layout.tsx" apps/web/app/share/[token]/page.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: MED
- **Depends on**: none (interacts with plan 025 — see Maintenance notes)
- **Category**: bug / UX
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

On a phone the editor/review page (`/projects/{id}/assets/{assetId}`) is hard to
use (screenshots, iPhone 14 Pro Max): the global 52px nav rail still eats
horizontal space even though the viewer has its own top bar and back button; and
the comments panel only opens from a small top-corner icon, which guests/editors
miss. Plan 011 made the panel *stack* below the video on mobile, but the page
still wastes width on the rail and lacks the discoverable bottom-sheet comment
affordance that the **guest** share viewer already has (plan 013). This plan
brings the editor's mobile ergonomics up to the share viewer's standard.

The work is deliberately small and mechanical: (1) stop reserving the global nav
rail on the full-screen asset-viewer route, and (2) port plan 013's proven
mobile comment affordances (floating "Comments" button when closed, in-panel
"Hide comments" handle, hide the top-bar toggle on mobile) from the share viewer
into the editor page. No redesign of the desktop layout.

## Current state

Files:

- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` — the
  editor/review page. The component is `ReviewScreenInner`. It is rendered
  `absolute inset-0` (line 329) inside the dashboard `<main>`, so it overlays
  the page area but is still offset by `<main>`'s left margin.
- `apps/web/app/(dashboard)/layout.tsx` — dashboard shell. Always renders
  `<Sidebar>` and gives `<main>` a left margin equal to the rail width; it
  already hides the `<Header>` on the asset-viewer route via `isAssetViewer`.
- `apps/web/app/share/[token]/page.tsx` — the **reference implementation** for
  the mobile comment affordances (plan 013). Copy its patterns; do not edit it.

The dashboard shell today (`apps/web/app/(dashboard)/layout.tsx:25-62`):

```tsx
// Hide header on asset viewer pages — the viewer has its own top bar
const isAssetViewer = /\/projects\/[^/]+\/assets\/[^/]+/.test(pathname);
// ...
<Sidebar
  collapsed={sidebarCollapsed}
  onToggle={() => setSidebarCollapsed((c) => !c)}
/>
<main
  className={cn(
    "flex flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-spring",
    sidebarCollapsed ? "ml-[52px]" : "ml-[220px]",
  )}
>
  {!isAssetViewer && <Header onSearchOpen={() => setCommandOpen(true)} />}
  <div className="relative flex-1 overflow-y-auto">{children}</div>
</main>
```

The editor top bar's sidebar toggle (`…/assets/[assetId]/page.tsx:399-410`):

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

The editor main content + sidebar (`…/assets/[assetId]/page.tsx:414-514`):

```tsx
<div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
  <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
    {renderMediaViewer()}
  </div>
  {sidebarOpen && (
    <div className="w-full h-[55vh] md:h-auto md:w-[360px] flex flex-col border-t md:border-t-0 border-l-0 md:border-l border-border bg-bg-secondary shrink-0 animate-in slide-in-from-bottom-2 md:slide-in-from-right-2 duration-150">
      {/* tabs + CommentPanel + CommentInput / Fields */}
    </div>
  )}
</div>
```

The reference mobile affordances in the share viewer to copy:

1. **In-panel "Hide comments" handle** (`apps/web/app/share/[token]/page.tsx:569-576`):
   ```tsx
   <button
     onClick={onClose}
     className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-zinc-400 border-b border-white/[0.06]"
   >
     <ChevronDown className="h-4 w-4" />
     Hide comments
   </button>
   ```
2. **Floating bottom "Comments" button when closed** (`…/share/[token]/page.tsx:808-816`):
   ```tsx
   {!sidebarOpen && (
     <button
       onClick={() => setSidebarOpen(true)}
       className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-4 py-2.5 text-sm font-medium text-white shadow-lg border border-white/10"
     >
       <MessageSquare className="h-4 w-4" />
       Comments{commentCount ? ` (${commentCount})` : ''}
     </button>
   )}
   ```
3. **Hide the top-bar toggle on mobile** — share viewer's toggle has
   `hidden md:flex` (`…/share/[token]/page.tsx:443-454`).

Repo conventions: editor page uses the `bg-bg-*` / `text-text-*` design tokens
(not the share viewer's raw `zinc`/`white` palette). When porting the affordances
above, **translate the colors to the editor's tokens** (e.g. `text-zinc-400` →
`text-text-tertiary`, `bg-white/10` → `bg-bg-hover`, `border-white/[0.06]` →
`border-border`). The editor page imports `Columns2`, `Upload`, etc. from
`lucide-react` (lines 23-31) — add `MessageSquare` and `ChevronDown` to that
import if not present. `cn` is imported (line 33). `comments` is in scope (from
`useComments`, lines 120-127).

## Commands you will need

| Purpose   | Command                              | Expected on success   |
|-----------|--------------------------------------|-----------------------|
| Install   | `pnpm install`                       | exit 0                |
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors     |
| Lint      | `cd apps/web && pnpm lint`           | exit 0                |
| Tests     | `cd apps/web && pnpm test`           | all pass              |

## Scope

**In scope**:
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` (edit)
- `apps/web/app/(dashboard)/layout.tsx` (edit — one targeted change, step 1)

**Out of scope** (do NOT touch):
- `apps/web/app/share/[token]/page.tsx` — reference only.
- `apps/web/components/layout/sidebar.tsx` — do NOT restructure the global rail
  here; that is plan 025's job. This plan only stops *reserving space* for it on
  the asset-viewer route.
- The desktop (`md:`/`lg:`) layout of the editor — leave desktop behavior
  identical. Every change must be gated by a mobile breakpoint (`md:hidden`,
  default-mobile classes) so desktop is unaffected.
- `renderMediaViewer()` internals and the `VideoPlayer`/`ImageViewer`/
  `AudioPlayer` components.

## Git workflow

- Branch: `advisor/021-editor-mobile-rework`
- Conventional commits (e.g. `fix(web): make editor review page usable on mobile`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Don't reserve the global nav rail on the full-screen viewer route

In `apps/web/app/(dashboard)/layout.tsx`, the asset viewer is full-screen
(`absolute inset-0`) and has its own back button, so the global rail is dead
weight there on every screen size. Make `<main>` use zero left margin on the
asset-viewer route, and hide the `<Sidebar>` there.

- Change the `<main>` className margin logic so that when `isAssetViewer` is
  true the margin is `ml-0`, otherwise the existing
  `sidebarCollapsed ? "ml-[52px]" : "ml-[220px]"`.
- Wrap the `<Sidebar>` render in `{!isAssetViewer && ( … )}`.

Target:

```tsx
{!isAssetViewer && (
  <Sidebar
    collapsed={sidebarCollapsed}
    onToggle={() => setSidebarCollapsed((c) => !c)}
  />
)}

<main
  className={cn(
    "flex flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-spring",
    isAssetViewer ? "ml-0" : sidebarCollapsed ? "ml-[52px]" : "ml-[220px]",
  )}
>
```

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Hide the editor top-bar toggle on mobile

In the editor page, add `hidden md:flex` to the `Columns2` toggle button so it
no longer competes for space in the cramped mobile top bar (the mobile floating
button from step 4 replaces it on phones). Change its className base from
`'flex items-center justify-center h-8 w-8 …'` to
`'hidden md:flex items-center justify-center h-8 w-8 …'`.

**Verify**: `grep -n "hidden md:flex" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → at least 1 match.

### Step 3: Add the in-panel "Hide comments" handle (mobile only)

Inside the `{sidebarOpen && ( … )}` panel container, as the **first child**, add a
mobile-only collapse handle that calls `setSidebarOpen(false)`, styled with the
editor's tokens:

```tsx
<button
  onClick={() => setSidebarOpen(false)}
  className="md:hidden flex items-center justify-center gap-1.5 w-full py-2 text-xs text-text-tertiary border-b border-border"
>
  <ChevronDown className="h-4 w-4" />
  Hide comments
</button>
```

Add `ChevronDown` to the `lucide-react` import if absent.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 4: Add the floating bottom "Comments" button (mobile only, when closed)

Immediately after the main content `<div className="flex flex-col md:flex-row …">`
closing tag (i.e. as a sibling inside the page's root `absolute inset-0`
container), add:

```tsx
{!sidebarOpen && (
  <button
    onClick={() => setSidebarOpen(true)}
    className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-bg-hover backdrop-blur px-4 py-2.5 text-sm font-medium text-text-primary shadow-lg border border-border"
  >
    <MessageSquare className="h-4 w-4" />
    Comments{comments.length ? ` (${comments.length})` : ''}
  </button>
)}
```

Add `MessageSquare` to the `lucide-react` import if absent. `comments` is already
in scope (from `useComments`).

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "absolute bottom-4 left-1/2" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1 match.

### Step 5: Lint + test

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.

## Test plan

Layout/responsive behavior is driven by CSS breakpoints, which jsdom does not
evaluate — a unit test asserting "panel is a bottom sheet at 390px" would be
fake. Keep tests light and assert only DOM presence/wiring:

- The editor page needs `ReviewProvider` + SWR mocks to render; **do not** stand
  up that harness just for this. The gate is typecheck + lint + the existing
  suite staying green, plus manual verification (note in PR):
  - Rebuild the all-in-one image from this branch; open an asset on a phone-width
    viewport (or Chrome devtools iPhone 14 Pro Max). Confirm: no left rail; video
    fills the width; a floating "Comments" button appears; tapping it opens a
    bottom sheet with a "Hide comments" handle; desktop layout is unchanged.

Verification: `cd apps/web && pnpm test` → all pass (no regressions).

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0 (no regressions)
- [ ] `apps/web/app/(dashboard)/layout.tsx` hides `<Sidebar>` and uses `ml-0`
      when `isAssetViewer`
- [ ] Editor top-bar `Columns2` toggle is `hidden md:flex`
- [ ] Editor page has a `md:hidden` "Hide comments" handle and a `md:hidden`
      floating "Comments" button
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live code (drift).
- Removing the rail margin on the asset route breaks the desktop editor layout
  (it should not — the viewer is `absolute inset-0`).
- Plan 025 (global nav rework) has already landed and changed
  `layout.tsx`'s rail/margin structure — if so, re-read 025's result and adapt
  step 1 to its new shape (the *intent* — no wasted rail on the viewer route —
  still holds), then report what you changed.

## Maintenance notes

- **Interaction with plan 025**: 025 moves the global nav into the top header.
  On the asset-viewer route the header is already hidden, so 025 and this plan
  don't fight; but whichever lands second should re-confirm step 1 still makes
  sense. If 025 lands first and eliminates the rail entirely, step 1 may become
  a no-op — verify and note it.
- A reviewer should check that desktop (`md:`+) rendering is pixel-identical to
  before: every change here is mobile-gated.
- Deferred: a true mobile transport redesign for `VideoPlayer` (larger touch
  targets, swipe-to-seek). Out of scope; this plan only fixes page-level layout.
