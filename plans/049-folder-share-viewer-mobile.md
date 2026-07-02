# Plan 049: Make the folder/project guest share viewer usable on phones

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/components/share/folder-share-viewer.tsx`
> Plans 047 and 048 also edit this file (the `ShareReviewInner` function) and
> are expected to land first — their changes don't overlap the lines below.
> Any OTHER drift in the excerpts is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (touch-open behavior decision, see Step 4)
- **Depends on**: plans/048-guest-asset-share-mobile-layout.md (same file; ordering only)
- **Category**: bug (mobile UX)
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

A guest opening a **folder or project** share link on a phone gets a desktop
layout crushed into 390px: a fixed 320px details/comments panel is open by
default, leaving ~70px for the actual content grid. Worse, on touch devices
assets can effectively not be opened at all — opening requires a
**double-click** (no reliable double-tap equivalent), download buttons only
appear on hover, and the logged-in viewer's avatar menu opens on `:hover`
only (touch users can't reach "Back to Dashboard"/"Log out"). Guests are the
one audience guaranteed to include phone users.

## Current state

Relevant file: `apps/web/components/share/folder-share-viewer.tsx` — the
`FolderShareViewer` component (line ~1019) plus its child `AssetGridCard`
(line ~275). All problems are in this file.

1. Panel open by default, `folder-share-viewer.tsx:1041`:

```tsx
  const [panelOpen, setPanelOpen] = React.useState(true)
```

2. Content row never stacks, `:1341`:

```tsx
      {/* ─── Content area ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
```

3. Fixed-width right panel, `:1569-1570`:

```tsx
        {panelOpen && (
          <div className="w-[320px] shrink-0 border-l border-border bg-bg-secondary flex flex-col overflow-hidden">
```

4. Open-asset requires double-click — grid card `:288-289`:

```tsx
      onClick={() => onSelect(asset)}
      onDoubleClick={() => onOpen(asset)}
```

   and the list-row equivalent `:1493-1494`:

```tsx
                                  onClick={() => setSelectedAsset(asset)}
                                  onDoubleClick={() => openInViewer && setViewingAsset(asset)}
```

5. Hover-only download button on grid cards, `:327-329`:

```tsx
        {allowDownload && (
          <button
            className="absolute top-2 right-2 flex items-center justify-center h-6 w-6 rounded-md bg-bg-primary/70 hover:bg-bg-primary/90 text-text-primary backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity"
```

   and on list rows, `:1515-1517` (`opacity-0 group-hover:opacity-100`).

6. Hover-only viewer avatar dropdown, `:1260-1265`:

```tsx
          {viewerName ? (
            <div className="relative group shrink-0">
              <button className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-text-primary bg-green-600 hover:ring-2 hover:ring-green-400/50 transition-all">
                {viewerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </button>
              {/* Dropdown */}
              <div className="hidden group-hover:block absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-bg-elevated shadow-xl py-1">
```

7. Fixed-width search input, `:1386-1394` (`h-8 w-52 pl-8 …`).

8. Root uses `min-h-screen`, `:1253` (fine for a scrolling page — but the
   inner layout relies on `flex-1 overflow-hidden`, so the panel change in
   Step 3 keeps heights consistent; only change what the steps name).

Conventions: `md` (768px) is the repo's mobile/desktop breakpoint; the
mobile bottom-sheet pattern is `w-full h-[55vh] md:h-auto md:w-[320px] …
border-t md:border-t-0 md:border-l` (see
`app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx:427` and, after
plan 048, `ShareReviewInner` in this same file). The header panel toggle
(`:1330-1336`, PanelRightClose/Open) already exists — it becomes the mobile
open/close affordance.

Design constraint: plans 034–040 (pending monochrome retheme) restyle this
file's colors. **Layout/behavior classes only** — no color, radius, or font
changes.

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass            |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only file you should modify):

- `apps/web/components/share/folder-share-viewer.tsx` — `FolderShareViewer`,
  `AssetGridCard`, and the list-row JSX only.

**Out of scope** (do NOT touch):

- `ShareReviewInner` / `ShareReviewScreen` in the same file (plans 047/048).
- `apps/web/components/projects/asset-grid.tsx` — the authed grid already
  opens on single click (plan 016).
- Hover-affordance fixes in OTHER files — that is plan 051.
- Any color/typography/radius change (retheme, plans 034–040).

## Git workflow

- Branch: `advisor/049-folder-share-viewer-mobile`
- Conventional commits, e.g. `fix(share): responsive folder share viewer + touch affordances`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Panel closed by default on mobile

Replace line ~1041 with a lazy initializer (client component — `window` is
available on first render in the browser, but guard for SSR):

```tsx
  const [panelOpen, setPanelOpen] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  )
```

**Verify**: `grep -n "panelOpen, setPanelOpen" apps/web/components/share/folder-share-viewer.tsx`
shows the matchMedia initializer.

### Step 2: Stack content area below `md`

Line ~1341: `flex flex-1 overflow-hidden` →
`flex flex-col md:flex-row flex-1 overflow-hidden`.

**Verify**: grep for the new string → 1 match inside `FolderShareViewer`.

### Step 3: Right panel becomes a bottom sheet below `md`

Line ~1570:

```tsx
          <div className="w-full h-[55vh] md:h-auto md:w-[320px] shrink-0 border-t md:border-t-0 md:border-l border-border bg-bg-secondary flex flex-col overflow-hidden">
```

**Verify**: `grep -c "md:w-\[320px\]" apps/web/components/share/folder-share-viewer.tsx` → 1; bare `"w-[320px]"` without the `md:` prefix → 0.

### Step 4: Single-tap opens assets on touch devices

Add a coarse-pointer flag near the top of `FolderShareViewer` (after the
existing state declarations):

```tsx
  const [isTouch, setIsTouch] = React.useState(false)
  React.useEffect(() => {
    setIsTouch(window.matchMedia('(hover: none)').matches)
  }, [])
```

Then change the two click sites so a tap opens the viewer directly (the
select-then-inspect flow needs the side panel, which is hidden on mobile):

- Grid: change the `onSelect` prop passed to `AssetGridCard` (line ~1465)
  from `onSelect={setSelectedAsset}` to:

```tsx
                                onSelect={(a) => {
                                  if (isTouch && openInViewer) setViewingAsset(a)
                                  else setSelectedAsset(a)
                                }}
```

- List rows (line ~1493): `onClick={() => setSelectedAsset(asset)}` →

```tsx
                                  onClick={() => {
                                    if (isTouch && openInViewer) setViewingAsset(asset)
                                    else setSelectedAsset(asset)
                                  }}
```

Keep both `onDoubleClick` handlers unchanged (desktop behavior).
`AssetGridCard` itself needs no change for this step.

**Verify**: `grep -c "hover: none" apps/web/components/share/folder-share-viewer.tsx` → 1;
`pnpm exec tsc --noEmit` → 0.

### Step 5: Touch-visible download buttons

In this file only, change the two hover-gated download buttons so they are
always visible below `md` and hover-revealed at `md+`:

- `:329` (grid card): `opacity-0 group-hover:opacity-100` →
  `opacity-100 md:opacity-0 md:group-hover:opacity-100`
- `:1515-1517` (list row): `opacity-0 group-hover:opacity-100` →
  `opacity-100 md:opacity-0 md:group-hover:opacity-100`
  (keep the rest of each class string unchanged)

**Verify**: `grep -c "md:group-hover:opacity-100" apps/web/components/share/folder-share-viewer.tsx` → 2.

### Step 6: Avatar menu opens on click, not hover

Replace the hover-only dropdown (`:1260-1298`) with a click-toggled one.
Add state near the other `FolderShareViewer` state:

```tsx
  const [viewerMenuOpen, setViewerMenuOpen] = React.useState(false)
```

- On the avatar `<button>`: add `onClick={() => setViewerMenuOpen((v) => !v)}`.
- On the dropdown wrapper div: `hidden group-hover:block` →
  `${viewerMenuOpen ? 'block' : 'hidden'} md:group-hover:block` — i.e. clicking
  toggles it everywhere, hover still works on desktop. Use `cn()` (already
  imported) rather than a template string, matching file style:

```tsx
              <div className={cn(
                'absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-bg-elevated shadow-xl py-1',
                viewerMenuOpen ? 'block' : 'hidden md:group-hover:block',
              )}>
```

- Close on outside click: add a `React.useEffect` gated on `viewerMenuOpen`
  that registers a `mousedown` listener and closes the menu when the click
  target is outside the wrapper (use a ref on the `relative group` div; follow
  the existing outside-click pattern in
  `apps/web/components/review/share-dialog.tsx:74-95`).

**Verify**: `grep -c "hidden group-hover:block" apps/web/components/share/folder-share-viewer.tsx` → 0;
`pnpm exec tsc --noEmit` → 0.

### Step 7: Search input flexes on small screens

Line ~1386-1394: on the wrapper div `relative flex items-center shrink-0`,
change `shrink-0` to `grow sm:grow-0`; on the input, `w-52` → `w-full sm:w-52`.
The parent row (`:1355`) already wraps (`flex-wrap`).

**Verify**: `grep -c "w-full sm:w-52" apps/web/components/share/folder-share-viewer.tsx` → 1.

### Step 8: Full gate

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm lint` → no new errors.

Live check (only if dev stack running + a folder/project share link exists):
device emulation at 390×844 — grid fills the width, panel closed by default,
header toggle opens it as a bottom sheet, tapping a card opens the viewer,
download buttons visible without hover. Desktop ≥768px unchanged (panel open,
click selects, double-click opens, hover reveals downloads).

## Test plan

Behavior is viewport/pointer-conditional inside a large client component —
grep anchors + type/test gate + live check are the verification. Do not add
JSDOM tests asserting class strings. If you can cheaply extract and unit-test
a pure helper (e.g. the open-vs-select decision), you may, but it is not
required.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0
- [ ] All grep anchors from Steps 1–7 hold
- [ ] `git status --porcelain` shows only `folder-share-viewer.tsx` (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts don't match beyond plans 047/048's documented changes.
- The header panel toggle (`:1330-1336`) has been removed — mobile would have
  no way to open the panel.
- You find `FolderShareViewer` split into multiple files (a deferred round-4
  idea) — the line references are void; report.
- Step 4's behavior decision seems wrong in testing (e.g. the maintainer
  wants tap-to-select + explicit open button instead) — implement as
  specified, but flag the alternative in your report.

## Maintenance notes

- Plan 039 (retheme) sweeps this file for color tokens — keep this diff
  purely structural so the merge stays trivial.
- The `isTouch` flag (Step 4) is per-load; a tablet with attached keyboard
  changing pointer modes mid-session keeps its initial behavior — acceptable.
- Deferred here: pagination "Load more" is fine on mobile; the
  double-download-All flow and the accent-color injection are untouched.
- Reviewer: scrutinize Step 6's outside-click effect for listener leaks
  (must clean up on close/unmount).
