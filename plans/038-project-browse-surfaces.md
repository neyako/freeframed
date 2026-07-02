# Plan 038: Project & asset browsing — flat mono posters, dot-grid fallbacks, data-table list view

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/components/projects/project-card.tsx apps/web/components/projects/folder-card.tsx apps/web/components/projects/collection-card.tsx apps/web/components/projects/asset-card.tsx apps/web/components/projects/asset-grid.tsx apps/web/components/projects/project-settings-dialog.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Known, expected drift (reconciled 2026-07-03):** plan 051 appended
> `pointer-coarse:opacity-100` to hover-reveal class lines in
> `project-card.tsx` (~114), `folder-card.tsx` (~181), `asset-card.tsx`
> (~170), `asset-grid.tsx` (~417/456/543/586), and
> `project-settings-dialog.tsx` (~107). Structural only; NOT a STOP.
> **Preserve the `pointer-coarse:opacity-100` token** on every hover-reveal
> control you restyle — touch users depend on it.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED (asset-grid is 31.5K and recently churned — plans 014/016/022/024/028)
- **Depends on**: plans/034-design-tokens-foundation.md, plans/035-primitive-components-restyle.md
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The browsing surfaces are where the old identity is most visible: project
cards fall back to **stock color gradients** (`getGradientForProject`) — the
design explicitly forbids these ("No stock gradients — the poster is a flat
surface with a dot-matrix count and a scrim-anchored title"). This plan makes
the project card a flat mono poster (dot-grid texture, oversized Doto item
count as the glyph, scrim-anchored title, mono pill tags), conforms the
folder/collection/asset cards, and gives the asset list view the design's
data-table treatment (hairline rows — never zebra, mono column heads, Doto
numerals for sizes).

## Design spec (inline reference)

- **Project card** (design `components/projects/project-card.tsx`): container
  `rounded-lg border border-border bg-bg-secondary hover:border-border-strong`
  — border does the lifting, no shadow, no accent-colored hover border.
  Poster: square, `bg-bg-tertiary` + `.ff-dotgrid` texture, centered glyph =
  item count in `font-dot font-black text-[76px] text-text-tertiary
  opacity-50` (zero-padded 2 digits, e.g. `08`); bottom 84px scrim
  `linear-gradient(to top, var(--scrim), transparent)`; title on the scrim
  15px/600 white, subtitle `font-mono text-[10px] uppercase tracking-[0.08em]
  text-white/70`; top-left pill tags `bg-black/55 backdrop-blur px-2 py-1
  font-mono text-[9px] uppercase tracking-[0.1em] text-white/90 rounded-none`;
  optional top-right red dot (8px) flags "the project that needs eyes".
  Footer: hairline top border, meta `font-mono text-[10px] text-text-tertiary`,
  ghost menu button with hairline hover border.
- **Data table** (design `components/shared/data-table.tsx`): head row
  `bg-bg-tertiary border-b border-border`, `font-mono text-[10px] uppercase
  tracking-[0.16em] text-text-tertiary`; body rows separated by
  `border-b border-border-secondary` hairlines ("never zebra fills"),
  `hover:bg-bg-hover`; filenames `font-mono text-[12–13px]`; numeric cells
  (size) `font-dot font-bold text-[15px]`; dates `font-mono text-xs
  text-text-secondary`; status via the plan-035 Badge (a rejected row is the
  only red on the page).

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/components/projects/project-card.tsx`:
  - `import { getGradientForProject } from '@/lib/gradient-utils'` (line 8),
    used at line 28 and rendered at lines 62–65:
    ```tsx
    <div className={cn('h-full w-full bg-gradient-to-br', gradient)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(255,255,255,0.1),transparent_60%)]" />
    ```
  - Container link (line 51): `rounded-xl ... hover:border-accent/40 ...
    hover:shadow-lg hover:shadow-black/10`.
  - Scrim (line 69): `h-24 bg-gradient-to-t from-black/70 via-black/30
    to-transparent`.
  - Pills (lines 84–96): `rounded-full bg-black/30 backdrop-blur-sm ...
    text-[10px] font-medium` (Public + role).
  - Footer meta (line 101): `text-2xs text-text-tertiary` with
    `{assetCount} items · {formatBytes(...)}`.
  - Poster `<img>` branch when `project.poster_url` exists — keep it (real
    posters stay photographic; scrim goes on top).
  - Dropdown content (line 123): `rounded-xl ... shadow-xl`.
- `apps/web/lib/gradient-utils.ts` — used by exactly two files:
  `project-card.tsx` and `project-settings-dialog.tsx` (verified by grep).
- `apps/web/components/projects/asset-grid.tsx` — grid + a unified list view;
  list section starts at the comment `/* ─── Unified list view (folders +
  assets) ─── */` (line ~383). Grid classes at lines ~73–75
  (`grid-cols-3 sm:grid-cols-4 ...`) — layout stays, only card visuals change.
  This file was reworked by plans 014/016/022/024/028; expect its exact line
  numbers to have drifted — anchor on the section comment and class strings,
  not line numbers.
- `apps/web/components/projects/folder-card.tsx` (8.5K),
  `collection-card.tsx` (2.1K), `asset-card.tsx` (9.2K) — read each before
  editing; conform border/hover/meta typography only (pattern in Step 4).
- `Project` type (`types/`): has `poster_url`, `is_public`, `role`,
  `asset_count`, `storage_bytes`, `created_at`. **It has no "needs review"
  flag** — see Step 2 note about the red corner dot.
- Test baseline: `pnpm test` → 0 failed (count depends on 035/036/037 landing
  order — record your starting number). Existing:
  `components/projects/__tests__/asset-grid.test.tsx` (fixtures pin asset
  names, not classes).

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | 0 failed            |
| One file  | `pnpm test -- components/projects/__tests__/asset-grid.test.tsx` | pass |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope**:
- `apps/web/components/projects/project-card.tsx`
- `apps/web/components/projects/project-settings-dialog.tsx` (only its
  gradient-preview usage of `gradient-utils`)
- `apps/web/components/projects/folder-card.tsx`
- `apps/web/components/projects/collection-card.tsx`
- `apps/web/components/projects/asset-card.tsx`
- `apps/web/components/projects/asset-grid.tsx` (list-view section + card
  chrome only)
- `apps/web/lib/gradient-utils.ts` (delete if unreferenced after the above)
- `apps/web/components/projects/__tests__/` (new/updated tests)

**Out of scope** (do NOT touch):
- Grid layout/columns, drag-drop upload handlers, selection & share-mode
  logic, single-click open behavior in `asset-grid.tsx` (plans 014/016/022/024
  landed these — visual classes only).
- `app/(dashboard)/projects/**/page.tsx` — page-level layout stays.
- `components/shared/badge.tsx` (035 owns it — compose it, don't restyle it).
- The trash view and move-to dialogs.

## Git workflow

- Branch: `advisor/038-browse-surfaces`
- Conventional commits, e.g. `feat(web): flat mono project posters and table-style asset list`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Project card poster — kill the gradient

In `project-card.tsx`:

- Remove the `getGradientForProject` import + `gradient` variable.
- Replace the gradient fallback `<div>` (lines 62–65) with the design poster:
  ```tsx
  <div className="ff-dotgrid flex h-full w-full items-center justify-center bg-bg-tertiary">
    <span className="font-dot text-[76px] font-black tracking-[0.04em] text-text-tertiary opacity-50">
      {String(Math.min(assetCount, 99)).padStart(2, '0')}
    </span>
  </div>
  ```
- Scrim → `h-[84px] bg-gradient-to-t from-[var(--scrim)] to-transparent`
  (this gradient is the sanctioned exception — it's a scrim, not decoration).
- Title stays 15px semibold white; description line →
  `font-mono text-[10px] uppercase tracking-[0.08em] text-white/70`.
- Pills → design spec classes (`rounded-none bg-black/55 ...`, mono 9px
  uppercase); keep the Globe icon.
- Container → `rounded-lg border border-border hover:border-border-strong`
  (drop `hover:border-accent/40 hover:shadow-lg hover:shadow-black/10`).
- Footer meta → `font-mono text-[10px] tracking-[0.04em] text-text-tertiary`;
  dropdown content `rounded-xl ... shadow-xl` → `rounded border-border
  bg-bg-elevated`.
- Red corner dot: the design flags "needs eyes" with a top-right 8px red dot,
  but `Project` has no such field — **do not invent one**. Leave a
  `{/* needs-review corner dot: blocked on a Project.needs_review field */}`
  comment at the tags block.

**Verify**: `grep -c "gradient" components/projects/project-card.tsx` → 1
(only the scrim `bg-gradient-to-t`); `pnpm exec tsc --noEmit` → 0.

### Step 2: Retire `gradient-utils` from settings dialog

`project-settings-dialog.tsx` uses `getGradientForProject` for its poster
preview. Replace that preview with the same dot-grid + Doto glyph fallback as
Step 1 (extract a tiny local `<PosterFallback count={n} className?>` in
`project-card.tsx` and export it, or duplicate the 5 lines — prefer the
export). Then check `grep -rn "gradient-utils" apps/web --include='*.ts*'`:
if only `lib/gradient-utils.ts` itself remains, delete the file.

**Verify**: `grep -rc "gradient-utils" components app` → 0;
`pnpm exec tsc --noEmit` → 0.

### Step 3: Asset list view → data-table treatment

In `asset-grid.tsx`, find the unified list view section (anchor: the comment
`Unified list view (folders + assets)`). Apply the Design spec's table
classes to the existing markup (do not restructure the DOM or handlers):

- Column-header row → `bg-bg-tertiary border-b border-border` + heads
  `font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary`.
- Body rows → `border-b border-border-secondary hover:bg-bg-hover` (remove
  any zebra/`odd:` classes if present).
- Name cell → `font-mono text-[13px]`; size cell → `font-dot font-bold
  text-[15px] text-text-primary`; date/uploader cells → `font-mono text-xs
  text-text-secondary`.
- Keep selection highlights, click handlers, share-mode behavior untouched.

**Verify**: `pnpm test -- components/projects/__tests__/asset-grid.test.tsx`
→ pass.

### Step 4: Conform folder/collection/asset cards

Read each file first. Apply the same chrome pattern, minimal diff:

- Containers: `rounded-lg border border-border hover:border-border-strong`;
  remove `shadow-*` and any accent-colored hover borders.
- Meta lines (counts, sizes, times) → `font-mono text-[10px]
  text-text-tertiary`.
- Thumbnail-less fallbacks → `ff-dotgrid bg-bg-tertiary` with the file-type
  icon in `text-text-tertiary` (folder icon for folders).
- Status badges on asset cards already come from `Badge` (035) — leave them.
- Do not alter aspect-ratio/size logic driven by the view store.

**Verify**: `grep -c "hover:border-accent\|shadow-lg\|shadow-md" components/projects/folder-card.tsx components/projects/collection-card.tsx components/projects/asset-card.tsx` → 0 per file; `pnpm exec tsc --noEmit` → 0.

### Step 5: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke (`pnpm dev`): /projects grid — flat posters with dot-grid + Doto
counts, mono pills; a project with a real `poster_url` still shows the image
with scrim + title; project detail — asset grid cards + list view table
treatment; both themes.

## Test plan

- New: `components/projects/__tests__/project-card.test.tsx` — render with a
  posterless project `{asset_count: 8}` → glyph text `08` present; with
  `poster_url` → `<img>` rendered; `is_public` → `Public` pill. Model store/
  api mocks after `asset-grid.test.tsx` (SWR/api mocking pattern lives there).
- Updated: none expected — `asset-grid.test.tsx` fixtures pin names/handlers,
  not classes. If a class assertion fails, update it to the new class.
- Verification: `pnpm test` → 0 failed, ≥ starting count + 3.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed; project-card tests added and passing
- [ ] `grep -rc "gradient-utils" components app` → 0 (and the lib file deleted if unreferenced)
- [ ] `grep -c "ff-dotgrid" components/projects/project-card.tsx` → ≥1
- [ ] `grep -c "font-dot" components/projects/project-card.tsx` → ≥1
- [ ] `grep -rc "hover:border-accent" components/projects/*.tsx` → 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- 034/035 not landed (`grep -c "D71921" app/globals.css` → 0 — `ff-dotgrid`
  and `font-dot` would silently render as nothing).
- The asset-grid list-view section can't be found by its comment anchor, or
  its markup differs structurally from a head-row + body-rows shape (the file
  churns often — reconcile before restyling).
- `getGradientForProject` has grown call sites beyond the two named files.
- Removing gradients breaks a test that snapshots poster markup (report the
  snapshot rather than blindly updating it).

## Maintenance notes

- The red "needs eyes" corner dot is deliberately NOT implemented — it needs a
  backend field (e.g. `Project.has_pending_review`). When that lands, render
  `<span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-accent" />`
  in the tags block (comment left in place).
- `PosterFallback` (if extracted) is the canonical "no thumbnail" treatment —
  reuse it for any future entity card instead of inventing new fallbacks.
- Reviewer scrutiny: light theme on the poster scrim — `--scrim` is a warm
  dark translucency; confirm white title text still passes contrast on light
  posters (design accepts white-on-scrim in both themes).
- Deleting `lib/gradient-utils.ts` may orphan its unit test if one exists
  (grep `lib/__tests__` — none found at 39bdfc6, but re-check).
