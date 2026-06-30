# Plan 021: Rework the editor/review page for mobile (mobile comment affordances)

> **STATUS: DONE (partial) — merged to `main` 2026-07-01 (`57fa5c4`).** This plan
> shipped its mobile comment affordances on the editor/review page. Its original
> Step 1 (stop reserving the global nav rail on the viewer route) was **dropped as
> obsolete** — plan **025** removed the rail entirely first, so there is nothing
> left to reserve. This file was refreshed on 2026-07-01 to match what actually
> landed; it is a record, not an open task. No further execution is needed unless
> the "Residual / deferred" section is picked up.

## Status

- **Priority**: P1
- **Effort**: M–L (actual: S — only the page-level affordances shipped)
- **Risk**: MED (actual: LOW — all changes mobile-gated)
- **Depends on**: plan 025 (which superseded Step 1)
- **Category**: bug / UX
- **Planned at**: commit `4d0c20f`, 2026-06-30
- **Refreshed at**: commit `33764b7`, 2026-07-01 (post-025-merge reality)
- **Merged**: `57fa5c4` (partial merge — assetId-page hunk kept, `layout.tsx` hunk dropped)

## Why this matters (resolved)

On a phone the editor/review page (`/projects/{id}/assets/{assetId}`) was hard to
use: (a) the global nav rail ate horizontal width even though the viewer has its
own top bar, and (b) the comments panel only opened from a small top-corner icon
that editors missed.

Both are now fixed, by two plans:

- **(a) the rail** — solved by **plan 025**, not this one. 025 deleted the left
  rail outright and moved nav into the top header; the dashboard `<main>` now has
  **no left margin on any route**, and the header is already hidden on the viewer
  route. So 021's original Step 1 ("hide `<Sidebar>` + `ml-0` on the viewer
  route") became a no-op and was dropped during the merge.
- **(b) the comment affordances** — solved by this plan: it ported plan 013's
  proven mobile pattern (floating "Comments" button when closed, in-panel "Hide
  comments" handle, hide the top-bar toggle on mobile) from the share viewer into
  the editor page. Desktop layout unchanged — every change is `md:`-gated.

## Current state (post-merge, `33764b7`)

Files:

- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` — the
  editor/review page (component `ReviewScreenInner`). **Carries this plan's shipped
  changes.**
- `apps/web/app/(dashboard)/layout.tsx` — dashboard shell, **post-025**. No
  `<Sidebar>`, no `ml-*` margin, header hidden on the viewer route. Reference
  only — this plan no longer touches it.
- `apps/web/app/share/[token]/page.tsx` — the reference implementation (plan 013)
  the affordances were ported from. Not edited.

The post-025 shell (`apps/web/app/(dashboard)/layout.tsx:42-48`) — note: no rail,
no margin, so Step 1 has nothing to do:

```tsx
return (
  <div className="flex h-screen overflow-hidden bg-bg-primary">
    <main className="flex flex-1 flex-col overflow-hidden">
      {!isAssetViewer && <Header onSearchOpen={() => setCommandOpen(true)} />}
      <div className="relative flex-1 overflow-y-auto">{children}</div>
    </main>
    {/* … */}
  </div>
);
```

What shipped on the editor page (all present on `main` @ `33764b7`):

1. **Top-bar toggle hidden on mobile** (`…/assets/[assetId]/page.tsx:404`):
   the `Columns2` button base class is now
   `'hidden md:flex items-center justify-center h-8 w-8 rounded-md transition-colors'`.
2. **In-panel "Hide comments" handle** (`…/assets/[assetId]/page.tsx:431-432`),
   first child of the `{sidebarOpen && (…)}` panel, `md:hidden`, calls
   `setSidebarOpen(false)`, uses editor tokens (`text-text-tertiary`,
   `border-border`).
3. **Floating bottom "Comments" button when closed**
   (`…/assets/[assetId]/page.tsx:529-532`):
   ```tsx
   className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-bg-hover backdrop-blur px-4 py-2.5 text-sm font-medium text-text-primary shadow-lg border border-border"
   // …
   <MessageSquare className="h-4 w-4" />
   Comments{comments.length ? ` (${comments.length})` : ''}
   ```
4. `ChevronDown` + `MessageSquare` added to the `lucide-react` import
   (`…/assets/[assetId]/page.tsx:25,31`).

## Verification (as merged)

Run on `apps/web` against `main` @ `33764b7`:

| Purpose   | Command                              | Result          |
|-----------|--------------------------------------|-----------------|
| Typecheck | `npx tsc --noEmit`                   | exit 0          |
| Lint      | `pnpm lint`                          | exit 0 (warnings only, pre-existing) |
| Tests     | `pnpm test`                          | 133 passed (133) |

Anchor checks (all pass):
- `grep -c "md:hidden absolute bottom" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1
- `grep -c "Hide comments" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1
- `grep -c "hidden md:flex items-center justify-center h-8 w-8" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → 1
- `grep -c "Sidebar" "apps/web/app/(dashboard)/layout.tsx"` → 0 (025's rail removal intact)

## Steps (historical — what was executed)

- ~~**Step 1: Don't reserve the global nav rail on the viewer route**~~ —
  **DROPPED. Superseded by plan 025**, which removed the rail and all `<main>`
  margins entirely. The 021 branch's `layout.tsx` hunk was discarded at merge
  time (resolved to main's post-025 version); its intent — "no wasted rail on the
  viewer route" — is fully met by 025.
- **Step 2: Hide the editor top-bar toggle on mobile** — DONE (`hidden md:flex`
  on the `Columns2` button, line 404).
- **Step 3: Add the in-panel "Hide comments" handle (mobile only)** — DONE
  (lines 431-432).
- **Step 4: Add the floating bottom "Comments" button (mobile, when closed)** —
  DONE (lines 529-532).
- **Step 5: Lint + test** — DONE (green; see Verification).

## Test plan (as executed)

Responsive behavior is CSS-breakpoint driven; jsdom does not evaluate it, so no
unit test asserts the bottom-sheet geometry. The gate was typecheck + lint + the
existing suite staying green (133/133), plus manual mobile verification: on a
phone-width viewport the editor shows no left rail, the video fills the width, a
floating "Comments" button appears, tapping it opens the stacked panel with a
"Hide comments" handle, and the desktop layout is unchanged.

## Residual / deferred (not done — open if revisited)

- **True bottom-sheet transport for `VideoPlayer`** — larger touch targets,
  swipe-to-seek. Out of scope here; this plan only fixed page-level comment
  affordances. Would be a fresh plan against `renderMediaViewer()` internals.
- The mobile comment panel is a stacked `w-full h-[55vh]` region (the 011/013
  recipe), not a draggable sheet. If a real drag-to-resize sheet is wanted, that
  is new work, not a 021 gap.

## Maintenance notes

- **`layout.tsx` is now owned by plan 025.** Do not re-add rail/margin logic for
  the viewer route here — there is no rail. If a future change reintroduces any
  global chrome, re-confirm the viewer route stays full-bleed.
- All editor-page changes from this plan are `md:`-gated; a reviewer touching the
  editor page should keep desktop (`md:`+) rendering identical and preserve the
  `comments.length` count in the floating button label.
- The affordance markup is duplicated between the share viewer
  (`share/[token]/page.tsx`) and the editor page. If a third surface needs it,
  consider extracting a shared `MobileCommentToggle` component rather than copying
  a third time.
