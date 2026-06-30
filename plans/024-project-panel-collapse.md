# Plan 024: Hide the comments panel until an asset is selected, and make the assets panel collapsible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/web/stores/view-store.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Category**: UX
- **Depends on**: none
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

On the project page (screenshot) the right-hand comments panel is always open and
shows a dead "Select an asset to view comments" empty state, wasting a 360px
column when nothing is selected. And the left "Assets" panel (folder tree +
storage) can't be collapsed, so on smaller laptops the grid is squeezed from both
sides. Two small changes reclaim that space: only show the comments panel once an
asset is actually selected, and add a collapse/expand toggle for the assets panel.

## Current state

File: `apps/web/app/(dashboard)/projects/[id]/page.tsx`. Store:
`apps/web/stores/view-store.ts`.

The right panel renders whenever `rightPanelOpen` is true, regardless of selection
(`…/projects/[id]/page.tsx:755-968`):

```tsx
{rightPanelOpen && (
  <div className="hidden xl:flex w-[360px] flex-col border-l border-border bg-bg-secondary shrink-0">
    <>
      {/* Tabs (comments/fields) … */}
      {selectedAsset ? (
        rightTab === "comments" ? ( /* CommentPanel */ ) : ( /* Fields */ )
      ) : (
        /* No asset selected */
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-bg-tertiary flex items-center justify-center">
              <MessageSquare className="h-8 w-8 text-text-tertiary/50" />
            </div>
            <p className="text-sm text-text-secondary">
              Select an asset to view comments
            </p>
          </div>
        </div>
      )}
    </>
  </div>
)}
```

`rightPanelOpen` / `toggleRightPanel` come from `useViewStore` (the toggle button
lives in the shared `Header`, `apps/web/components/layout/header.tsx:104-122`).
`selectedAsset` is page state (`…/page.tsx:66`).

The left assets panel is always rendered, no collapse control
(`…/projects/[id]/page.tsx:328-419`):

```tsx
<div className="hidden lg:flex w-72 flex-col border-r border-border bg-bg-secondary shrink-0">
  <div className="p-3 space-y-0.5">
    <div className="flex items-center justify-between px-2 mb-1">
      <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
        Assets
      </span>
      {canCreateFolder && ( /* New folder + button */ )}
    </div>
    <FolderTree … />
  </div>
  <div className="flex-1" />
  {/* Storage indicator … */}
</div>
```

The view-store (`apps/web/stores/view-store.ts`) already persists view prefs and
has the `rightPanelOpen` precedent:

```ts
interface ViewSettings { /* … */ rightPanelOpen: boolean }
interface ViewStore extends ViewSettings { /* … */ toggleRightPanel: () => void }
// defaults: rightPanelOpen: true
// toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
```

`ChevronsLeft` is the icon used for the global sidebar collapse
(`apps/web/components/layout/sidebar.tsx`); `PanelLeftOpen`/`PanelLeftClose`
exist in `lucide-react` and mirror the header's `PanelRight*` usage. `cn` is
imported in the page.

## Commands you will need

| Purpose   | Command                              | Expected on success   |
|-----------|--------------------------------------|-----------------------|
| Install   | `pnpm install`                       | exit 0                |
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors     |
| Lint      | `cd apps/web && pnpm lint`           | exit 0                |
| Tests     | `cd apps/web && pnpm test`           | all pass              |

## Scope

**In scope**:
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` (edit)
- `apps/web/stores/view-store.ts` (edit — add `leftPanelOpen` + `toggleLeftPanel`)

**Out of scope** (do NOT touch):
- `apps/web/components/layout/header.tsx` — keep the existing right-panel toggle
  as-is; the left-panel toggle lives on the project page (the assets panel only
  exists there).
- `apps/web/components/projects/asset-grid.tsx` and `folder-tree.tsx`.
- The right panel's tabs / `CommentPanel` / Fields content — only the *gating
  condition* and the dead empty-state change.

## Git workflow

- Branch: `advisor/024-project-panel-collapse`
- Conventional commits (e.g. `feat(web): collapse project panels`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `leftPanelOpen` to the view store

In `apps/web/stores/view-store.ts`, mirror `rightPanelOpen`:
- Add `leftPanelOpen: boolean` to `ViewSettings`.
- Add `toggleLeftPanel: () => void` to `ViewStore`.
- Default `leftPanelOpen: true`.
- Implement `toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),`.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Only show the comments panel when an asset is selected

In `apps/web/app/(dashboard)/projects/[id]/page.tsx`:
- Change the right-panel gate from `{rightPanelOpen && (` to
  `{rightPanelOpen && selectedAsset && (`.
- Because `selectedAsset` is now guaranteed truthy inside, the
  `selectedAsset ? (…) : (/* No asset selected */)` ternary's **else branch is
  dead** — remove the entire "No asset selected" `<div>` block (the
  `MessageSquare` empty state shown in Current state) and collapse the ternary to
  just its truthy body. Keep the `rightTab === "comments" ? … : …` logic intact.
- If removing that block leaves `MessageSquare` unused **in this file**, leave the
  import — it is still used elsewhere in the right panel (the empty-comments state
  at `…:808-823`). Verify with grep before removing any import.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "Select an asset to view comments" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → **no** matches.

### Step 3: Make the left assets panel collapsible

In the page, read `leftPanelOpen` / `toggleLeftPanel` from `useViewStore`
(the page already calls `useViewStore` for `rightPanelOpen` — extend that
destructure).

- Wrap the existing left panel `<div className="hidden lg:flex w-72 …">…</div>`
  in `{leftPanelOpen && ( … )}`.
- Add a collapse button to the "Assets" header row (next to the New-folder `+`),
  calling `toggleLeftPanel`, e.g.:
  ```tsx
  <button
    onClick={toggleLeftPanel}
    className="text-text-tertiary hover:text-text-primary transition-colors"
    title="Collapse panel"
  >
    <PanelLeftClose className="h-3.5 w-3.5" />
  </button>
  ```
- When collapsed, render a slim re-open rail so the panel is recoverable:
  ```tsx
  {!leftPanelOpen && (
    <div className="hidden lg:flex w-9 shrink-0 flex-col items-center border-r border-border bg-bg-secondary pt-3">
      <button
        onClick={toggleLeftPanel}
        className="text-text-tertiary hover:text-text-primary transition-colors"
        title="Show panel"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
    </div>
  )}
  ```
  Place this rail as a sibling immediately before/after the `{leftPanelOpen && …}`
  block so exactly one of the two renders.
- Add `PanelLeftClose, PanelLeftOpen` to the `lucide-react` import in the page.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "toggleLeftPanel" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → ≥2 matches.

### Step 4: Lint + test

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.

## Test plan

- These are stateful UI gates with no pure logic worth a dedicated unit test, and
  the page needs heavy SWR/store mocking to render — do **not** stand up that
  harness. The gate is typecheck + lint + the existing suite staying green, plus
  manual verification (note in PR):
  - Open a project: the right comments column is absent until an asset is clicked;
    clicking an asset shows it; the header panel toggle still hides/shows it while
    an asset is selected.
  - The "Assets" panel collapses via its header button to a slim rail and expands
    again; the choice persists across reloads (it's in the persisted view store).

Verification: `cd apps/web && pnpm test` → all pass (no regressions).

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0 (no regressions)
- [ ] `view-store.ts` exports `leftPanelOpen` + `toggleLeftPanel`
- [ ] `grep -n "Select an asset to view comments" "apps/web/app/(dashboard)/projects/[id]/page.tsx"` → no matches
- [ ] Left assets panel collapses/expands and persists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live code (drift).
- Removing the "No asset selected" block forces you to touch the right panel's
  tabs or comment logic beyond collapsing the dead ternary branch.
- `MessageSquare` (or any import) becomes unused *only* because of your change but
  removing it would touch unrelated code — leave it and report.

## Maintenance notes

- A reviewer should confirm the header's existing right-panel toggle still works
  for a selected asset, and that no layout shift/overflow appears when the left
  panel collapses to the slim rail.
- Deferred: a mobile (`<lg`) collapse for the assets panel — it's already hidden
  below `lg`, so not needed now.
