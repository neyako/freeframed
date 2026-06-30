# Plan 016: Open an asset on a single click/tap (instead of double-click)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. When done, update the status row for
> this plan in `plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**:
> `git -C /Users/neyako/freeframed diff --stat d229011..HEAD -- apps/web/components/projects/asset-grid.tsx`
> If it changed, compare the "Current state" excerpt before editing; on a
> mismatch, STOP.

## Status

- **Target repo**: FreeFrame — `/Users/neyako/freeframed` (`apps/web`)
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (one handler change; share-mode selection preserved)
- **Depends on**: none
- **Category**: UX (touch / mobile)
- **Planned at**: commit `d229011`, 2026-06-29

## Why this matters

Opening an asset for review currently requires a **double-click** (`onDoubleClick`); a single click only
selects/highlights it. On touch devices there is no natural "double-tap to open", so the asset grid feels
broken on mobile, and even on desktop a single click to open is the expected file-browser behaviour
(Drive/Dropbox open the preview on one click). This plan makes a **single click/tap open** the asset,
while preserving **multi-select in share mode** (where a tap should still toggle the selection checkbox).

## Current state — `apps/web/components/projects/asset-grid.tsx`

The asset card wrapper (lines ~332–340):

```tsx
            <div
              key={asset.id}
              className={cn(
                'rounded-lg transition-all cursor-pointer',
                selectedAssetId === asset.id && 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary',
              )}
              onClick={(e) => onAssetSelect?.(asset, e)}
              onDoubleClick={() => onAssetOpen?.(asset)}
            >
```

Relevant existing pieces in this component:
- `shareMode` prop (line ~105) — when true, the grid is in multi-select mode for building a share.
- `toggleAssetSelect(assetId)` (line ~147) — toggles an asset in the `selectedAssetIds` set (the
  share-mode checkbox uses it).
- `onAssetOpen?.(asset)` — opens the asset (the project page wires it to `router.push(.../assets/{id})`).
- `onAssetSelect?.(asset, e)` — single-highlight (the project page wires it to set a "selected" asset).

### Conventions

- Keep `cn()` styling and the existing props. Do not change the project page (`onAssetOpen` /
  `onAssetSelect` callbacks stay; this plan only changes which gesture triggers which).

## Commands you will need

| Purpose | Command (repo root) | Expected |
|---------|---------------------|----------|
| Install web deps | `cd apps/web && pnpm install --frozen-lockfile` | exit 0 |
| Build | `cd apps/web && pnpm build` | exit 0 |
| Anchor grep | see Done criteria | match |

## Scope

**In scope** (one file): `apps/web/components/projects/asset-grid.tsx` — change the asset card's
click behaviour so a single click opens (normal mode) or toggles selection (share mode).

**Out of scope**:
- `apps/web/app/(dashboard)/projects/[id]/page.tsx` and the `onAssetOpen`/`onAssetSelect` callbacks —
  unchanged.
- Folder cards (their open-on-click already works, lines ~401–402).
- The review page, share viewer, any API.

## Git workflow

- Branch: `advisor/016-single-click-asset-preview`
- Conventional commit (e.g. `feat(web): open assets on a single click/tap`).
- Do NOT push unless instructed.

## Steps

### Step 1: Single click opens (share mode toggles selection)

Change the asset card wrapper's handlers (lines ~338–339) from:

```tsx
              onClick={(e) => onAssetSelect?.(asset, e)}
              onDoubleClick={() => onAssetOpen?.(asset)}
```

to:

```tsx
              onClick={(e) => {
                if (shareMode) {
                  e.stopPropagation()
                  toggleAssetSelect(asset.id)
                } else {
                  onAssetOpen?.(asset)
                }
              }}
              onDoubleClick={() => onAssetOpen?.(asset)}
```

This makes a single click/tap **open** the asset in normal browsing, while in **share mode** a tap still
toggles the selection checkbox (so multi-asset share building keeps working). `onDoubleClick` stays as a
harmless fallback (double-click also opens). The previous single-click "highlight" (`onAssetSelect`) is
intentionally superseded by opening — that's the requested behaviour.

**Verify**: `grep -n "toggleAssetSelect(asset.id)" apps/web/components/projects/asset-grid.tsx` → match
(now called from the card click, in addition to any checkbox use).

### Step 2: Build

**Verify**: `cd apps/web && pnpm build` → exit 0. If unrunnable, rely on the grep anchor + a manual
check and say so.

## Test plan

- **Automated gate**: the Step 1 grep anchor + a clean `pnpm build`.
- **Manual (if you can run it)**:
  1. **Normal mode**: single-click (desktop) / single-tap (mobile) an asset → it **opens** the review
     page. (Double-click still opens, no double-trigger navigation error.)
  2. **Share mode**: enter share/multi-select mode → a tap toggles the asset's checkbox instead of
     opening; building a multi-asset share still works.
  3. Folder cards still open on click as before.

## Done criteria

ALL must hold:

- [ ] `grep -n "toggleAssetSelect(asset.id)" apps/web/components/projects/asset-grid.tsx` → match
- [ ] `grep -n "if (shareMode)" apps/web/components/projects/asset-grid.tsx` → match (within the asset card onClick)
- [ ] `cd apps/web && pnpm build` exits 0 (or manual check recorded)
- [ ] Only `apps/web/components/projects/asset-grid.tsx` changed (`git -C /Users/neyako/freeframed status --porcelain`)
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report if:

- The asset card no longer uses `onClick`/`onDoubleClick` with `onAssetSelect`/`onAssetOpen` as in
  "Current state" (it was refactored since `d229011`).
- `toggleAssetSelect` or the `shareMode` prop no longer exists with that name/signature — report what
  you found; don't invent a selection mechanism.
- Single-click-to-open turns out to interfere with an in-grid editing affordance (e.g. inline rename) —
  report it; a guard (`if click target is interactive, ignore`) may be needed.

## Maintenance notes

- If a future drag-to-select or marquee selection is added in normal mode, reconcile it with
  single-click-opens (e.g. only open if the pointer didn't move / it wasn't a drag).
- The project page's `onAssetSelect` callback is now effectively unused for the grid card click (it may
  still be used elsewhere); leaving it wired is harmless. If you remove it later, check no other caller
  depends on it.
- Mobile double-tap zoom: single-tap-to-open avoids the double-tap gesture entirely, which is the point;
  keep `onDoubleClick` only as a desktop fallback.
