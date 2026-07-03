# Plan 060: Conform the Projects page (and dashboard home cards) to the app-projects design spec

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f7fd883..HEAD -- "apps/web/app/(dashboard)/projects/page.tsx" "apps/web/app/(dashboard)/page.tsx"`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (layout-only; no data-flow changes)
- **Depends on**: none hard. Soft: 057 (alpha tokens) merged so any surviving `/NN` classes render.
- **Category**: design-conformance
- **Planned at**: commit `f7fd883`, 2026-07-04

## Why this matters

`app-projects.dc.html` (added to the design project 2026-07-03) specifies the
Projects screen: a wide centered container, a large light-weight page title with
a Doto project count, mono-uppercase section headers, a `minmax(240px,1fr)` card
grid, and a dashed "New project" tile in the system's hairline language. The
current page predates the screen spec: small `text-lg` title, `rounded-xl`
everywhere, a **violet→fuchsia gradient icon** in the list rows (the retheme
explicitly killed gradients app-wide), blue/amber role pills, and pill-shaped
count chips. This is the first screen a user sees; it currently reads as a
different product than the rethemed review surfaces.

## Current state

- `apps/web/app/(dashboard)/projects/page.tsx` — the Projects screen. Contains
  `ProjectListRow`, `ProjectSection`, and `ProjectsPage` (default export).
- `apps/web/app/(dashboard)/page.tsx` — dashboard home ("Good morning") with
  `AssetCard` + `Section`; pre-retheme card styles. Secondary scope.
- `apps/web/components/projects/project-card.tsx` — ALREADY conformant
  (plan 038: `ff-dotgrid` Doto poster fallback, scrim, mono meta). Do not restyle.
- `apps/web/components/ui/segmented.tsx` — `Segmented` primitive from plan 036.
  Props: `options: {value,label,icon?}[]`, `value`, `onChange`, `stretch?`. Use it
  for the grid/list toggle.
- `apps/web/components/ui/button.tsx` — `Button` already renders the mono
  uppercase `ff-btn` language (plan 035); `variant="primary"` is the red button.

Key excerpts as of `f7fd883` (`app/(dashboard)/projects/page.tsx`):

Page container + header (lines 279–291):
```tsx
<div className="p-6 space-y-6">
  {/* Header */}
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-lg font-semibold text-text-primary">Projects</h1>
      {projects && projects.length > 0 && (
        <p className="mt-0.5 text-sm text-text-tertiary">
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
```

View toggle (lines 292–317) — hand-rolled, `rounded-lg`, `bg-accent-muted` active:
```tsx
<div className="flex items-center rounded-lg border border-border overflow-hidden">
  <button onClick={() => setViewMode("grid")} className={cn("p-1.5 transition-colors",
    viewMode === "grid" ? "bg-accent-muted text-accent" : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary")}
    title="Grid view"><LayoutGrid className="h-4 w-4" /></button>
  <button onClick={() => setViewMode("list")} ...><List className="h-4 w-4" /></button>
</div>
```

Section header (lines 131–137):
```tsx
<div className="flex items-center gap-2">
  {icon}
  <h2 className="text-sm font-medium text-text-secondary">{title}</h2>
  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-bg-tertiary px-1.5 text-[10px] font-medium text-text-tertiary">
    {projects.length}
  </span>
</div>
```

Grid + "New Project" tile (lines 157–180):
```tsx
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
  ...
  <button onClick={onNewProject}
    className="group flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-border bg-bg-secondary/30 aspect-square hover:border-accent/40 hover:bg-bg-secondary/60 transition-all duration-200">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-tertiary text-text-tertiary group-hover:bg-accent group-hover:text-white transition-colors">
      <Plus className="h-5 w-5" />
    </div>
    <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">New Project</span>
  </button>
```

List row gradient + role pills (lines 58, 82–97):
```tsx
<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500">
...
  project.role === "owner" ? "bg-accent/10 text-accent"
    : project.role === "editor" ? "bg-blue-500/10 text-blue-400"
    : project.role === "reviewer" ? "bg-amber-500/10 text-amber-400"
    : "bg-bg-tertiary text-text-tertiary",
```

Empty-state first-project banner (lines 139–155) — `rounded-xl border-2` +
accent hover, same treatment problem as the tile.

Dashboard home (`app/(dashboard)/page.tsx`): `AssetCard` (lines 24–52) uses
`rounded-lg`, `hover:border-border-focus`, `group-hover:text-accent`,
`text-status-warning` due-date; `Section` header (lines 72–79) uses
`text-sm font-semibold`.

### Design spec (inlined from `app-projects.dc.html` + `freeframe.css`)

- Container: `max-width 1360px`, centered, padding `clamp(24px,4vw,44px)`
  top / `clamp(16px,4vw,40px)` sides / 96px bottom; vertical gap 36px.
- Title block: `h1` — sans, `clamp(26px,4vw,36px)`, weight **500**,
  `letter-spacing -0.02em`, `line-height 1`. Below it the count line:
  mono 11px uppercase tracking 0.14em tertiary, with the number in **Doto**
  (13px, `--text-secondary`) — e.g. `<Doto>1</Doto> project`.
- Header right: segmented grid/list control (the `ff-segmented` = repo
  `Segmented` primitive) + red primary "New project" button (13px plus icon).
- Section header: folder icon (15px, tertiary) + mono 11px uppercase tracking
  0.16em `--text-secondary` label + count chip: **Doto 12px tertiary, 1px
  `--border-primary` border, radius 2px, padding 2px 7px** (rectangular, not pill).
- Card grid: `repeat(auto-fill, minmax(240px,1fr))`, gap 14px.
- "New project" tile: `min-height 280px`, **1px dashed `--border-strong`**,
  radius `--radius-lg` (3px), tertiary text; hover: border-color and text →
  `--text-secondary` (NO accent, NO bg change). Inner icon box: 44×44px, 1px
  solid `--border-strong`, `--bg-secondary`, radius 2px, plus icon 18px.
  Label: mono 11px uppercase tracking 0.16em.
- Red is the *sole* interrupt: role pills, list icons, hovers are monochrome.

### Repo conventions

- Tokens as Tailwind utilities (`text-text-secondary`, `border-border-strong`,
  `font-dot`, `bg-accent`, …) — never hex/named colors (`violet-600` must die).
- Radii: `rounded` = 2px, `rounded-lg` = 3px, `rounded-xl` = 4px (034 remap).
  Prefer `rounded`/`rounded-lg` per spec values above.
- Exemplar of the poster-card language: `components/projects/project-card.tsx`.

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |
| Build     | `pnpm build`             | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/web/app/(dashboard)/projects/page.tsx`
- `apps/web/app/(dashboard)/page.tsx` (steps 6 only — card/section class strings)

**Out of scope** (do NOT touch):
- `components/projects/project-card.tsx` — already conformant (038).
- The New-Project dialog markup inside `projects/page.tsx` (lines 319–390) —
  dialogs follow the shared dialog treatment; leave as is.
- `components/ui/*` — primitives are settled (035/036).
- All data fetching, SWR keys, `handleCreate`, routing — class strings and
  JSX structure of presentational elements only.

## Git workflow

- Branch: `advisor/060-app-projects-conformance`
- Commit style: `fix(web): projects page conforms to app-projects spec (plan 060)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Page scaffold + title block

In `ProjectsPage` return:
- container `div`: `p-6 space-y-6` → `mx-auto w-full max-w-[1360px] px-4 sm:px-8 lg:px-10 pt-6 sm:pt-10 pb-24 space-y-9`
- header row: `flex items-center justify-between` → `flex flex-wrap items-end justify-between gap-5`
- `h1`: → `font-sans text-[clamp(26px,4vw,36px)] font-medium tracking-[-0.02em] leading-none text-text-primary`
- count line `<p>` → mono/Doto pair:
```tsx
<p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
  <span className="font-dot text-[13px] font-bold text-text-secondary">{projects.length}</span>{" "}
  project{projects.length !== 1 ? "s" : ""}
</p>
```

**Verify**: `grep -c "max-w-\[1360px\]" "app/(dashboard)/projects/page.tsx"` → `1`

### Step 2: View toggle → Segmented primitive

Replace the hand-rolled toggle div with the shared primitive. Import
`{ Segmented }` from `@/components/ui/segmented`:

```tsx
<Segmented
  options={[
    { value: "grid", label: "Grid view", icon: <LayoutGrid className="h-[13px] w-[13px]" /> },
    { value: "list", label: "List view", icon: <List className="h-[13px] w-[13px]" /> },
  ] as const}
  value={viewMode}
  onChange={setViewMode}
/>
```

The "New Project" `Button` next to it: change label text to `New project`
(sentence case per spec) — variant/size unchanged.

**Verify**: `grep -c "Segmented" "app/(dashboard)/projects/page.tsx"` → ≥2
(import + usage); `grep -c "bg-accent-muted text-accent" "app/(dashboard)/projects/page.tsx"` → `0`

### Step 3: Section headers

In `ProjectSection`:
- `h2` → `font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary` (keep element/text)
- count chip → `<span className="rounded-[2px] border border-border px-[7px] py-0.5 font-dot text-xs font-bold text-text-tertiary">{projects.length}</span>`
- callers already pass tertiary 16px lucide icons — fine.

**Verify**: `grep -c "rounded-full bg-bg-tertiary" "app/(dashboard)/projects/page.tsx"` → `0`

### Step 4: Grid + New-project tile + first-project banner

- Grid container: `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`
  → `grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5` (both the
  section grid and the loading-skeleton grid at lines 396–408; skeletons:
  `rounded-xl` → `rounded-lg`, keep structure).
- New-project tile (grid variant) → spec shape:
```tsx
<button
  onClick={onNewProject}
  className="flex min-h-[280px] flex-col items-center justify-center gap-3.5 rounded-lg border border-dashed border-border-strong text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary"
>
  <span className="flex h-11 w-11 items-center justify-center rounded border border-border-strong bg-bg-secondary">
    <Plus className="h-[18px] w-[18px]" />
  </span>
  <span className="font-mono text-[11px] uppercase tracking-[0.16em]">New project</span>
</button>
```
- First-project banner (empty section, lines 139–155): same language —
  `rounded-lg border border-dashed border-border-strong bg-transparent`,
  icon box as above (h-11 w-11, no accent hover), title stays sans 14px,
  subtitle → `font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary`.
  Remove all `group-hover:bg-accent` / `hover:border-accent/40` classes.

**Verify**: `grep -c "hover:border-accent/40" "app/(dashboard)/projects/page.tsx"` → `0`;
`grep -c "border-2 border-dashed" "app/(dashboard)/projects/page.tsx"` → `0`

### Step 5: List rows go monochrome

In `ProjectListRow`:
- icon box: `rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500` →
  `rounded border border-border bg-bg-tertiary`; icon `text-white` →
  `text-text-tertiary`.
- meta line `text-2xs` → `font-mono text-[10px] tracking-[0.04em] text-text-tertiary`.
- role pill: collapse the color ladder to one mono badge for every role:
  `"hidden sm:inline-flex items-center rounded-[2px] border border-border-strong px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary"`
  (delete the `cn(...)` ternary entirely; `roleName` text unchanged).
- list-view "New Project" row icon box: `rounded-lg border-2 border-dashed` →
  `rounded border border-dashed border-border-strong`.
- list wrapper `rounded-xl` → `rounded-lg`.

**Verify**: `grep -c "violet-600\|fuchsia-500\|blue-500\|amber-500" "app/(dashboard)/projects/page.tsx"` → `0`

### Step 6: Dashboard home card sweep (`app/(dashboard)/page.tsx`)

Minimal token conformance (no layout change):
- `AssetCard` link: `rounded-lg ... hover:border-border-focus hover:bg-bg-tertiary`
  → `rounded-lg border border-border bg-bg-secondary p-3 hover:border-border-strong transition-colors`
  (drop the bg change; `border-border-focus` is the red focus token — hover must
  be mono).
- name `group-hover:text-accent` → remove the hover class.
- due-date `text-status-warning` → `font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary`.
- `Section` `h2` → `font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary`;
  count `(N)` span → `font-dot text-xs font-bold text-text-tertiary` rendering
  just the number (drop parentheses).

**Verify**: `grep -c "status-warning\|group-hover:text-accent" "app/(dashboard)/page.tsx"` → `0`

### Step 7: Gate

**Verify**: in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm build` → exit 0.

## Test plan

No new test file required (class-string-only change). Existing coverage that may
assert on these files: `app/(dashboard)/projects/[id]/__tests__/` (different
page — should be untouched) and `components/projects/__tests__/project-card.test.tsx`
(out-of-scope file). If any test fails, it must be a class-string assertion on
an in-scope file; update the assertion, never the behavior.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -rn "violet-600\|fuchsia-500" "app/(dashboard)/projects/page.tsx"` → 0 matches
- [ ] `grep -c "font-dot" "app/(dashboard)/projects/page.tsx"` → ≥2 (count line + section chips)
- [ ] `grep -c "minmax(240px,1fr)" "app/(dashboard)/projects/page.tsx"` → ≥1
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Excerpts don't match the live code (drift).
- `Segmented`'s API differs from the excerpt in "Current state" (someone
  changed the primitive) — report, don't fork a local copy.
- Grid `minmax(240px,1fr)` makes `ProjectCard` posters visibly break (they're
  `aspect-square` and should scale; if the card's internal layout fights the
  new column width, STOP rather than editing `project-card.tsx`).
- A failing test is behavioral, not a class-string assertion.

## Maintenance notes

- The spec's `data-screen-label` and dc-import mechanics are design-tool
  artifacts — never port them.
- The desktop-void concern from the Codex audit (one project on a wide screen)
  is answered by the spec's `minmax(240px,1fr)` + dashed tile combination.
- If a `needs_review` project field ever lands, the card corner-dot marker in
  `project-card.tsx` (038 comment) is the hook — not this page.
- Dashboard home has no dedicated screen spec; step 6 is token hygiene only.
  A real "home" design may replace that page later.
