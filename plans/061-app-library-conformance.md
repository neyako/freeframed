# Plan 061: Conform the project library screen (sidebar, navigator, storage) to the app-library design spec

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f7fd883..HEAD -- "apps/web/app/(dashboard)/projects/[id]/page.tsx" apps/web/components/projects/folder-tree.tsx apps/web/components/projects/sort-popover.tsx apps/web/components/projects/appearance-popover.tsx`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED (touches the page with the most interactive wiring; class-strings only)
- **Depends on**: 060 recommended first (shared language, no file overlap). Soft: 057 merged.
- **Category**: design-conformance
- **Planned at**: commit `f7fd883`, 2026-07-04

## Why this matters

`app-library.dc.html` (design project, 2026-07-03) specifies the project
library screen: a 250px asset sidebar with mono-uppercase labels and an
accent-muted active folder, a bottom-pinned storage block with a 4px red-fill
track, a navigator row of mono-uppercase text controls ("Appearance",
"Sorted by Date"), and secondary/primary action buttons. The current page keeps
several pre-retheme artifacts: a hardcoded `#1a1a1f` popover, `white/5` hovers,
amber storage-warning colors (green/amber died in plan 034's token collapse),
sentence-case 13px controls, and a 288px sidebar. This is the screen editors
live in.

## Current state

- `apps/web/app/(dashboard)/projects/[id]/page.tsx` — the library screen:
  left sidebar (folder tree + storage), navigator via `AssetGrid`'s `actions`
  prop, right details panel, trash view.
- `apps/web/components/projects/folder-tree.tsx` — tree rows incl. root +
  "Recently Deleted" entries.
- `apps/web/components/projects/sort-popover.tsx` — "Sorted by" trigger +
  dropdown; hardcoded dark hex.
- `apps/web/components/projects/appearance-popover.tsx` — "Appearance" trigger
  (check its trigger button when editing; same treatment as sort).
- `apps/web/components/projects/asset-grid.tsx` — navigator bar wrapper
  (lines 245–264) only; the grid internals were rethemed in 038.
- `apps/web/components/projects/asset-card.tsx` — ALREADY conformant (038,
  `ff-dotgrid` fallback). Do not restyle.
- `apps/web/components/ui/segmented.tsx` — `Segmented` primitive
  (`options/value/onChange/stretch`), for the right-panel tabs.

Key excerpts as of `f7fd883` (`projects/[id]/page.tsx`):

Sidebar shell + header (lines 374–402):
```tsx
<div className="hidden lg:flex w-72 flex-col border-r border-border bg-bg-secondary shrink-0">
  {/* Assets section */}
  <div className="p-3 space-y-0.5">
    <div className="flex items-center justify-between px-2 mb-1">
      <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
        Assets
      </span>
```

Storage block (lines 441–472) — amber logic to remove:
```tsx
const isCritical = pct >= 90;
const isWarning = pct >= 80;
...
<span className={cn(
  "text-[10px] tabular-nums",
  isCritical ? "text-status-error font-medium" : isWarning ? "text-amber-400 font-medium" : "text-text-tertiary",
)}>
  {formatBytes(used)} / {formatBytes(limit)}
</span>
...
<div className="h-1 w-full rounded-full bg-bg-hover overflow-hidden">
  <div className={cn("h-full rounded-full transition-all duration-300",
    isCritical ? "bg-status-error" : isWarning ? "bg-amber-400" : "bg-accent")}
    style={{ width: `${Math.max(pct, 1)}%` }} />
```

Trash rows (lines 526–578): `hover:bg-white/5`, restore link
`text-xs text-accent hover:underline`.

"New Folder" action button (lines 722–732) — hand-rolled, non-mono:
```tsx
<button className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[13px] transition-colors" ...>
  <FolderPlus className="h-4 w-4" />
  <span className="hidden sm:inline">New Folder</span>
</button>
```

Right-panel tabs (lines 825–857) — underline tabs, not segmented:
```tsx
<button onClick={() => setRightTab("comments")}
  className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2",
    rightTab === "comments" ? "border-accent text-text-primary" : "border-transparent text-text-tertiary hover:text-text-secondary")}>
```

`folder-tree.tsx` row (lines 100–107):
```tsx
className={cn(
  'group flex items-center gap-1 px-2 py-1 rounded-md text-[13px] cursor-pointer transition-colors',
  isActive ? 'bg-accent/10 text-accent font-medium'
           : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
  isDragOver && 'ring-2 ring-accent/50 bg-accent/5',
)}
```

`sort-popover.tsx` trigger + content (lines 24–40):
```tsx
<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors">
  <ArrowUpDown className="h-4 w-4" />
  <span>Sorted by</span>
  <span className="text-text-primary font-medium">{activeLabel}</span>
</button>
...
<Popover.Content ... className="z-50 w-48 rounded-xl border border-white/10 bg-[#1a1a1f] shadow-2xl py-1.5 ...">
```

`asset-grid.tsx` navigator (lines 245–264): `AppearancePopover` | 1px divider |
`SortPopover` | spacer | `actions` — structure already matches the spec; only
the triggers need restyling (in their own files).

### Design spec (inlined from `app-library.dc.html` + `freeframe.css`)

- Sidebar: **250px**, `--bg-secondary`, right hairline. Header: "ASSETS" mono
  **10px** uppercase tracking **0.2em** tertiary; right side two 24px icon
  buttons (new folder +, collapse) — borderless, tertiary → primary on hover.
- Nav items: mono **12px** tracking 0.04em, padding 8px 10px, radius 2px.
  Active: `color: --accent; background: --accent-muted`. Inactive: tertiary;
  hover `--text-primary` + `--bg-hover`. "Recently deleted" is a nav item with
  a trash icon, same treatment.
- Storage block: pinned bottom, top hairline, padding 16px 18px 20px.
  Label "STORAGE" mono 10px tracking 0.18em tertiary; value mono 10px
  `--text-secondary` (`480.6 MB / 10 GB`). Track: **4px** tall, `--bg-hover`,
  pill; fill `--accent` (red) — *no green/amber states exist in this system*.
- Navigator row: left group = "APPEARANCE" and "SORTED BY **DATE**" as
  borderless mono 11px uppercase tracking 0.14em buttons (value part in
  `--text-primary`), separated by a 1px×18px divider. Right group = icon-only
  Members secondary button, "Share" secondary, "New folder" secondary,
  "Upload" **primary red** — all `ff-btn--sm` (34px, mono uppercase).
- Popover/dropdown surfaces app-wide: `--bg-elevated` + `--border-primary`
  hairline, radius 3px, **no shadows** (034 killed the shadow scale — `shadow-2xl`
  compiles to `0 0 #0000`, so dropping it is cosmetic-neutral cleanup).

### Repo conventions

- Tokens as Tailwind utilities; `bg-accent-muted`, `border-border-strong`,
  `font-dot` etc. exist. Never `white/5`, never hex literals.
- `Button` (`components/ui/button.tsx`) `variant="secondary"|"primary"`
  `size="sm"` already renders the spec's `ff-btn--sm`. Use it for New Folder.
- Exemplar mono nav item: the restyled share popup rows in
  `components/review/share-dialog.tsx` (plan 058) — read for tone, do not edit.

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |
| Build     | `pnpm build`             | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/web/app/(dashboard)/projects/[id]/page.tsx`
- `apps/web/components/projects/folder-tree.tsx`
- `apps/web/components/projects/sort-popover.tsx`
- `apps/web/components/projects/appearance-popover.tsx`

**Out of scope** (do NOT touch):
- `components/projects/asset-grid.tsx` and `asset-card.tsx` — 038's territory;
  the navigator *wrapper* there already matches.
- `components/review/share-dialog.tsx` + all `share-*` files — plan 058 owns them.
- `components/projects/project-members-dialog.tsx`, `name-dialog.tsx`,
  `move-to-dialog.tsx` — shared dialog treatment, separate concern.
- All handlers, SWR keys, drag-drop logic, upload wiring — presentation only.
- `app/(dashboard)/projects/[id]/__tests__/page-upload-drop.test.tsx` — update
  only if a changed class string breaks an assertion.

## Git workflow

- Branch: `advisor/061-app-library-conformance`
- Commit style: `fix(web): library screen conforms to app-library spec (plan 061)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Sidebar shell + header

In `projects/[id]/page.tsx`:
- sidebar container: `w-72` → `w-[250px]`.
- "Assets" label → `font-mono text-[10px] uppercase tracking-[0.2em] text-text-tertiary`
  (replace `text-2xs font-semibold ... tracking-wider`).
- The two header icon buttons (Plus / PanelLeftClose) → `flex h-6 w-6 items-center
  justify-center rounded-sm text-text-tertiary hover:text-text-primary transition-colors`.
- Collapsed-rail variant (lines 362–372) unchanged.

**Verify**: `grep -c "w-\[250px\]" "app/(dashboard)/projects/[id]/page.tsx"` → `1`

### Step 2: Folder tree rows go mono

In `folder-tree.tsx`, everywhere a row/nav class string appears (the `FolderNode`
row excerpted above, plus the root-project row and the "Recently Deleted" row —
grep `text-[13px]` in the file to find all of them):
- `text-[13px]` → `font-mono text-xs tracking-[0.04em]`
- `rounded-md` → `rounded`
- active: `bg-accent/10 text-accent font-medium` → `bg-accent-muted text-accent`
- drag-over: `ring-2 ring-accent/50 bg-accent/5` → `ring-1 ring-accent bg-accent-muted`
- inactive/hover treatment unchanged (`text-text-secondary hover:text-text-primary hover:bg-bg-hover`);
  for the "Recently Deleted" row prefer `text-text-tertiary` base if it isn't already.

**Verify**: `grep -c "accent/10\|accent/5\|accent/50" components/projects/folder-tree.tsx` → `0`

### Step 3: Storage block — kill amber, spec typography

Replace the storage IIFE's presentation (keep `used/limit/pct` math):
- delete `isCritical` / `isWarning`.
- label: `<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">Storage</span>`
- value: `<span className={cn("font-mono text-[10px] tracking-[0.02em] tabular-nums", pct >= 90 ? "text-accent" : "text-text-secondary")}>`
- track: keep `h-1 rounded-full bg-bg-hover overflow-hidden`; fill →
  `"h-full rounded-full bg-accent transition-all duration-300"` (always red).
- outer paddings: `p-2` block → `px-4 pb-5 pt-4 space-y-2` and drop the inner
  `px-2.5 py-1.5` wrapper padding and the trailing `<div className="h-5" />` spacer.

**Verify**: `grep -c "amber-400" "app/(dashboard)/projects/[id]/page.tsx"` → `0`

### Step 4: Trash view tokens

In the `showTrash` branch:
- heading → `font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary`
  (text "Recently deleted").
- rows: `rounded-lg hover:bg-white/5` → `rounded hover:bg-bg-hover`.
- type captions (`Folder`, `{item.type}`) → add `font-mono text-[10px] uppercase tracking-[0.1em]`.
- Restore buttons: `text-xs text-accent hover:underline` →
  `font-mono text-[10px] uppercase tracking-[0.14em] text-accent hover:text-accent-hover`
  — note: `accent-hover` isn't a registered text color; use
  `text-accent hover:opacity-80` instead if `text-accent-hover` fails to compile
  (check with tsc/build; `accent.hover` IS in tailwind.config colors, so
  `hover:text-accent-hover` should compile — prefer it).

**Verify**: `grep -c "white/5" "app/(dashboard)/projects/[id]/page.tsx"` → `0`

### Step 5: Navigator triggers (sort + appearance popovers)

`sort-popover.tsx`:
- trigger → `flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:text-text-primary transition-colors`
  (drop padding/rounded/bg — borderless text button per spec); icon `h-3.5 w-3.5`;
  keep `Sorted by` then value span `text-text-primary` (drop `font-medium`).
- content → `z-50 w-48 rounded-lg border border-border bg-bg-elevated py-1.5`
  + keep the animation data-classes; delete `shadow-2xl`, `border-white/10`, `bg-[#1a1a1f]`, `rounded-xl`.
- option rows: `text-sm` → `font-mono text-xs`; `hover:bg-white/5` → `hover:bg-bg-hover`.

`appearance-popover.tsx`: apply the same treatment to its trigger (label
"Appearance", mono 11px uppercase, `text-text-secondary` base per spec) and its
`Popover.Content` surface if it carries `shadow`/hex/`white/N` classes; leave
the internal option rows' layout alone (036 migrated its controls).

**Verify**: `grep -rn "#1a1a1f\|white/10\|white/5" components/projects/sort-popover.tsx components/projects/appearance-popover.tsx` → 0 matches

### Step 6: Action buttons row

In `projects/[id]/page.tsx` `actions` prop (lines 700–740):
- Replace the hand-rolled New Folder `<button>` with
  `<Button variant="secondary" size="sm" onClick={...}><FolderPlus className="h-4 w-4" /><span className="hidden sm:inline">New folder</span></Button>`.
- Share button label `Share` (unchanged), Members icon-only (unchanged) —
  both already `Button variant="secondary"`.
- Upload stays `<Button size="sm">` (primary red per 035 default).
- Sentence-case labels: `New Folder` → `New folder` (Button renders uppercase
  anyway; normalize source text).

**Verify**: `grep -c "rounded-lg border border-border text-text-secondary" "app/(dashboard)/projects/[id]/page.tsx"` → `0`

### Step 7: Right-panel tabs → Segmented

Replace the two underline tab buttons (lines 825–848) with the primitive
(import `{ Segmented }` from `@/components/ui/segmented`):

```tsx
<div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
  <Segmented
    stretch
    className="flex-1"
    options={[
      { value: "comments", label: "Comments" },
      { value: "fields", label: "Fields" },
    ] as const}
    value={rightTab}
    onChange={setRightTab}
  />
  {selectedAsset && (
    <button onClick={() => setSelectedAsset(null)} className="px-2 text-text-tertiary hover:text-text-primary transition-colors">
      <X className="h-4 w-4" />
    </button>
  )}
</div>
```

Drop the now-unused `MessageSquare` from the tab (it's still used by the
empty state below — keep the import).

**Verify**: `grep -c "border-b-2" "app/(dashboard)/projects/[id]/page.tsx"` → `0`

### Step 8: Gate

**Verify**: in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm build` → exit 0. Also re-run
`pnpm test -- page-upload-drop` explicitly (this page has a dedicated test).

## Test plan

No new tests (class-string-only). Must-pass existing suites:
`page-upload-drop.test.tsx` (drag-drop wiring on this page — behavioral; if it
fails, you broke structure, not style → STOP), plus the full `pnpm test` gate.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -rn "amber-400\|white/5\|#1a1a1f" "app/(dashboard)/projects/[id]/page.tsx" components/projects/folder-tree.tsx components/projects/sort-popover.tsx components/projects/appearance-popover.tsx` → 0 matches
- [ ] `grep -c "bg-accent-muted" components/projects/folder-tree.tsx` → ≥1
- [ ] `grep -c "Segmented" "app/(dashboard)/projects/[id]/page.tsx"` → ≥2
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Excerpts don't match the live code (drift — especially if plan 058's merge
  touched this page's share-dialog usage).
- `page-upload-drop.test.tsx` fails for any non-class-string reason.
- The Segmented swap in Step 7 breaks the `rightTab` typing (its generic should
  infer `"comments" | "fields"` from the `as const` options; if not, STOP).
- You need to edit `asset-grid.tsx` to make the navigator row read correctly —
  report what's missing instead.

## Maintenance notes

- The spec's storage figures (`480.6 MB / 10 GB`) are sample data; the 10 GB
  limit is still hardcoded in this page — future backend quota field replaces it.
- Mobile: this sidebar is `hidden lg:flex`; the spec is desktop-only here.
  Rounds 5/6 own mobile behavior — nothing in this plan may change breakpoints.
- The right-panel underline-tab pattern also exists on the review screen; plan
  062 replaces that one. If 062 executed first, match its exact Segmented usage.
