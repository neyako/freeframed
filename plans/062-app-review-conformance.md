# Plan 062: Conform the asset review screen (top bar, stage, comments sidebar) to the app-review design spec

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f7fd883..HEAD -- "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx" apps/web/components/review/version-switcher.tsx apps/web/components/review/comment-panel.tsx`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P1 (the product's core screen)
- **Effort**: M
- **Risk**: MED (file carries mobile-UX anchors from plans 029/056 that must survive)
- **Depends on**: none hard; 059–061 recommended first for consistent review. Soft: 057/058 merged.
- **Category**: design-conformance
- **Planned at**: commit `f7fd883`, 2026-07-04
- **Amended**: 2026-07-04 after a first execution hit the Step-4 STOP (dot-grid
  bleeding through the transport bar). Root cause: `video-player.tsx:358` and
  `audio-player.tsx:281` both use `bg-bg-secondary/80` — dead (opaque) before
  plan 057's alpha tokens, genuinely translucent after. Step 4b now authorizes
  the two one-token fixes; the corresponding STOP condition is retired. All
  other steps from the first execution were verified and stand.

## Why this matters

`app-review.dc.html` (design project, 2026-07-03) specifies the review screen:
a hairline top bar with the asset title, a mono "VERSION:" label + red version
chip + secondary mono buttons; a **dot-grid viewer stage** (the system's
signature texture behind media); and a 372px comments sidebar with segmented
tabs and a mono filter row. The current screen (plans 021/029/032/039/056
shaped it) still has Frame.io-era chrome: sentence-case 13px buttons,
`bg-bg-secondary` top bar, pill tabs with `shadow-sm`, and a plain black stage.
The transport bar and composer were already rethemed (039/054) — this plan
finishes the shell around them.

## Current state

- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` — the
  editor review screen (`ReviewScreenInner`): top bar, viewer column,
  mobile "Show comments" bar, sidebar with tabs.
- `apps/web/components/review/version-switcher.tsx` — "Version:" label + red
  chip dropdown (already red; label needs mono).
- `apps/web/components/review/comment-panel.tsx` — sidebar toolbar
  ("All comments" dropdown + filter/sort/search icons, lines ~874–990) and
  comment list. Only the toolbar label typography is in scope here.
- ALREADY conformant — do not restyle: `video-player.tsx` (039: Doto timecode,
  red playhead, 052 mobile compression), `comment-input.tsx` (039/054: chip
  alignment `leading-[19.5px]`), `progress-bar.tsx`, `share-dialog.tsx` (058).

Key excerpts as of `f7fd883` (`[assetId]/page.tsx`):

Top bar (lines 335–349):
```tsx
<div className="flex items-center justify-between border-b border-border px-3 h-12 bg-bg-secondary shrink-0">
  <div className="flex items-center gap-1 min-w-0 flex-1">
    <Link href={`/projects/${asset.project_id}`}
      className="flex items-center justify-center h-7 w-7 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0">
      <ArrowLeft className="h-4 w-4" />
    </Link>
    <span className="text-[13px] text-text-primary font-medium truncate">
      {asset.name}
    </span>
```

New Version button (lines 394–401):
```tsx
<button onClick={() => versionFileInputRef.current?.click()}
  className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-8 text-xs font-medium border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
  title="Upload new version">
  <Upload className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">New Version</span>
</button>
```

Sidebar toggle (lines 403–414): `h-8 w-8 rounded-md`, bg-hover states.

Viewer column (lines 419–424):
```tsx
<div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
  <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0">
    {renderMediaViewer()}
  </div>
```

MUST-SURVIVE mobile anchors (plans 029/056 — verify these survive your edit):
- lines 426–434: the `md:hidden` "Show comments" bar (`Show comments{comments.length > 0 ? \` (${comments.length})\` : ''}`)
- line 406: sidebar toggle gated `hidden md:flex`
- line 438: sidebar container `w-full h-[55vh] md:h-auto md:w-[360px] ... animate-in slide-in-from-bottom-2 md:slide-in-from-right-2`
- lines 439–445: the `md:hidden` "Hide comments" handle

Pill tabs (lines 448–473):
```tsx
<div className="px-4 pt-3 pb-2 shrink-0">
  <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5">
    <button onClick={() => setActiveTab('comments')}
      className={cn('flex-1 py-1.5 text-[13px] font-medium rounded-md transition-all',
        activeTab === 'comments' ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary')}>
      Comments
    </button>
    ... (same for 'fields')
```

`version-switcher.tsx` (lines 53–60):
```tsx
<span className="text-xs text-text-tertiary shrink-0">Version:</span>
<DropdownMenu.Trigger asChild>
  <button className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors outline-none">
    v{currentVersion?.version_number ?? sorted[sorted.length - 1].version_number}
```
Its dropdown content (line ~68) carries `rounded-xl ... shadow-2xl`.

`comment-panel.tsx` toolbar visibility button (lines 880–895):
```tsx
<button className={cn("flex items-center gap-1.5 text-[13px] font-medium transition-colors rounded-md px-2 py-1",
  visOpen ? "bg-bg-tertiary text-text-primary" : "text-text-secondary hover:text-text-primary")} ...>
  {visLabel}
  <ChevronDown className="h-3.5 w-3.5" />
</button>
```

### Design spec (inlined from `app-review.dc.html` + `freeframe.css`)

- Top bar: `--bg-primary` (not secondary), bottom hairline, padding 11px.
  Back button: 32px, transparent border → `--border-primary` on hover (no bg
  fill). Title: **14px weight 600 tracking -0.01em**. Right side:
  - "VERSION:" mono 11px uppercase tracking 0.14em tertiary
  - version chip: 26px tall, `--accent` bg, white, mono 11px tracking 0.08em,
    radius 0 (`--radius-sm`)
  - "New version" / "Share": secondary `ff-btn--sm` (34px, mono uppercase,
    `--border-strong` border)
  - panel toggle: 34px icon secondary button.
- Viewer stage: **`ff-dotgrid` texture** on the stage container, media centered
  with padding 22px.
- Sidebar: **372px**, `--bg-secondary`, left hairline. Top: segmented
  Comments/Fields stretch control (= repo `Segmented` primitive with
  `stretch`). Below: filter row — "ALL COMMENTS ▾" mono 11px uppercase
  tracking 0.12em `--text-secondary`, right cluster of 26px filter/sort/search
  icon buttons (13px icons, tertiary → primary hover), bottom hairline
  `--border-secondary`.
- Empty state + composer: already implemented per spec (EmptyState primitive,
  039/054 composer) — out of scope.
- No shadows anywhere; dropdowns are `--bg-elevated` + hairline.

### Repo conventions

- Tokens as Tailwind utilities; never hex/named colors, no `/90` unless it
  already exists (057 makes them compile).
- `Segmented` primitive: `components/ui/segmented.tsx`
  (`options/value/onChange/stretch/className`). Exemplar usage after plan 061:
  the library page right panel.
- Mobile behavior in this file is settled by plans 029/056 — visual classes
  may change, breakpoint gates (`hidden md:flex`, `md:hidden`, `h-[55vh]`)
  may NOT.

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |
| Build     | `pnpm build`             | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`
- `apps/web/components/review/version-switcher.tsx`
- `apps/web/components/review/comment-panel.tsx` (toolbar typography ONLY —
  lines ~874–990 region)
- `apps/web/components/review/video-player.tsx` — **Step 4b's one-token edit
  on line 358 ONLY**; everything else in the file stays untouched.
- `apps/web/components/review/audio-player.tsx` — **Step 4b's one-token edit
  on line 281 ONLY**.

**Out of scope** (do NOT touch):
- Everything else in `video-player.tsx` / `audio-player.tsx`, and all of
  `image-viewer.tsx` — 039 done; deferred conformance pass is separate.
- `comment-input.tsx` — 054's alignment anchors (`leading-[19.5px]`) live here.
- `share-dialog.tsx` + all `share-*` files — plan 058.
- `folder-share-viewer.tsx` (guest screen) — same spec applies but rounds 5/6
  anchors are dense there; explicitly deferred (see Maintenance notes).
- `review-provider.tsx`, stores, hooks — no logic changes.

## Git workflow

- Branch: `advisor/062-app-review-conformance`
- Commit style: `fix(web): review screen conforms to app-review spec (plan 062)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Top bar shell

In `[assetId]/page.tsx`:
- bar container: `px-3 h-12 bg-bg-secondary` → `px-3 sm:px-5 h-14 bg-bg-primary`.
- back link: `h-7 w-7 rounded-md ... hover:bg-bg-hover` →
  `h-8 w-8 rounded border border-transparent text-text-secondary hover:text-text-primary hover:border-border transition-colors`.
- title span: `text-[13px] text-text-primary font-medium truncate` →
  `text-sm font-semibold tracking-[-0.01em] text-text-primary truncate`.
- asset prev/next nav buttons (center cluster): apply the same
  border-hover treatment as the back link (keep `disabled:` classes and
  the `{currentIndex + 1} of {totalAssets}` counter; make the counter
  `font-dot text-xs`).

**Verify**: `grep -c "bg-bg-secondary shrink-0" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `0` (top bar no longer secondary; the sidebar container keeps its own `bg-bg-secondary` — that grep string is unique to the old bar line)

### Step 2: Top bar actions go mono

- "New Version" button → mono secondary per spec:
```tsx
className="inline-flex h-[34px] items-center gap-2 rounded border border-border-strong px-3.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary hover:border-text-primary hover:bg-bg-hover transition-colors"
```
  label text → `New version`; keep the `hidden sm:inline` gate and icon.
- sidebar toggle: `h-8 w-8 rounded-md` states →
  `h-[34px] w-[34px] rounded border` with
  active `border-border-strong text-text-primary` /
  inactive `border-border text-text-secondary hover:text-text-primary hover:border-border-strong`.
  **Keep the `hidden md:flex` gate exactly** (plan 056 anchor).

**Verify**: `grep -c "hidden md:flex" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1` (unchanged)

### Step 3: Version switcher typography

In `version-switcher.tsx`:
- label: `text-xs text-text-tertiary` →
  `font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary`.
- chip trigger: `rounded-md px-2.5 py-1 ... text-xs font-medium hover:bg-accent/90` →
  `rounded-sm h-[26px] px-2.5 font-mono text-[11px] tracking-[0.08em] hover:bg-accent-hover`
  (keep `bg-accent text-white`, the `v{...}` content and ChevronDown).
- dropdown content: `rounded-xl` → `rounded-lg`; delete `shadow-2xl`.
- leave `versionStatusConfig` status colors — they collapse via tokens (034)
  and are inside the dropdown, not the chip.

**Verify**: `grep -c "shadow-2xl" components/review/version-switcher.tsx` → `0`

### Step 4: Dot-grid stage

Viewer column div (line 421): add the texture and stage padding:
`className="ff-dotgrid flex-1 flex flex-col bg-bg-primary overflow-hidden min-w-0"`.
Do NOT wrap or pad the players themselves — `ff-dotgrid` is background-only.

**Verify**: `grep -c "ff-dotgrid" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`

### Step 4b: Opaque transport surfaces (amendment)

The transport bars became translucent when plan 057's alpha tokens landed
(`/80` was previously a dead modifier), so the Step-4 texture bleeds through.
The design spec puts transport bars on an opaque surface with a top hairline.
Two one-token edits — change `bg-bg-secondary/80` → `bg-bg-secondary`, nothing
else on either line:

`components/review/video-player.tsx:358` (current):
```tsx
<div className="flex items-center justify-between h-12 px-2 sm:px-4 bg-bg-secondary/80 border-t border-border shrink-0">
```
The `px-2 sm:px-4` (plan 052 mobile anchor) and every other class must stay
byte-identical.

`components/review/audio-player.tsx:281` (current): same class pattern
(`... h-12 px-4 bg-bg-secondary/80 border-t border-border ...`) — same
one-token change.

**Verify**: `grep -rn "bg-bg-secondary/80" components/review/video-player.tsx components/review/audio-player.tsx` → 0 matches; `grep -c "px-2 sm:px-4" components/review/video-player.tsx` → unchanged from before your edit

### Step 5: Sidebar width + segmented tabs

- sidebar container: `md:w-[360px]` → `md:w-[372px]` — change ONLY the width
  token in that class string; every other class on that line (055/056 mobile
  anchors, animations) stays byte-identical.
- Replace the pill-tab block (lines 448–473) with the primitive (import
  `{ Segmented }` from `@/components/ui/segmented`):
```tsx
<div className="px-4 pt-3.5 pb-2.5 shrink-0">
  <Segmented
    stretch
    options={[
      { value: 'comments', label: 'Comments' },
      { value: 'fields', label: 'Fields' },
    ] as const}
    value={activeTab}
    onChange={setActiveTab}
  />
</div>
```

**Verify**: `grep -c "shadow-sm" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `0`; `grep -c "md:w-\[372px\]" ...` → `1`

### Step 6: Comment-panel toolbar goes mono

In `comment-panel.tsx` toolbar (lines ~874–990 only):
- toolbar row: add `border-b border-border-secondary` to the
  `flex items-center justify-between px-4 py-2.5 shrink-0` container.
- visibility trigger: `text-[13px] font-medium ... rounded-md px-2 py-1` →
  `font-mono text-[11px] uppercase tracking-[0.12em]` with
  open `text-text-primary` / closed `text-text-secondary hover:text-text-primary`
  (drop the bg + padding + rounded classes); ChevronDown → `h-3 w-3`.
- the three icon buttons (filter/sort/search): `h-7 w-7 rounded-md` →
  `h-[26px] w-[26px] rounded-none`; active state `text-accent bg-accent/10` →
  `text-accent` (no bg); inactive `text-text-tertiary hover:text-text-primary`
  (drop `hover:bg-bg-tertiary`). Icons stay `h-4 w-4` or drop to `h-3.5 w-3.5`
  (either fine).
- Do not touch the `Dropdown` internals, filter state logic, or anything below
  the toolbar (comment cards, replies).

**Verify**: `pnpm test -- comment-panel` → all pass (this file has heavy test
coverage; failures must be class-string assertions only)

### Step 7: Gate + anchor audit

**Verify** in `apps/web/`:
1. `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass; `pnpm build` → exit 0.
2. Anchor audit (all on `[assetId]/page.tsx`):
   - `grep -c "Show comments"` → `1`
   - `grep -c "Hide comments"` → `1`
   - `grep -c "h-\[55vh\]"` → `1`
   - `grep -c "hidden md:flex"` → `1`

## Test plan

No new tests (presentation-only). Must-pass suites: full `pnpm test`, with
special attention to `comment-panel` tests (behavioral coverage of
filters/visibility — behavior must not change) and any review-page tests.
Update class-string assertions only.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] All four Step-7 anchor greps match
- [ ] `grep -c "ff-dotgrid" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `1`
- [ ] `grep -rn "bg-bg-secondary/80" components/review/` → 0 matches (Step 4b)
- [ ] `grep -rn "shadow-sm\|shadow-2xl" "app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx" components/review/version-switcher.tsx` → 0 matches
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Excerpts don't match the live code (drift).
- Any Step-7 anchor grep fails after your edits — you clobbered a 029/056
  mobile anchor; revert that hunk and report.
- The dot-grid texture still bleeds through a transport bar AFTER Step 4b's
  two edits (means a third translucent surface exists — report it, don't hunt).
- Step 4b requires touching anything beyond the two cited class strings.
- A `comment-panel` test failure is behavioral (filter/visibility logic),
  not a class-string assertion.
- `Segmented`'s generic typing fights `activeTab`'s `'comments' | 'fields'`
  state type.

## Maintenance notes

- **Deferred on purpose**: the guest share screen (`folder-share-viewer.tsx`)
  renders the same review layout for guests and should eventually get the
  identical treatment (top bar, dot-grid stage, 372px/segmented sidebar). It
  carries plans 047–049/051/056 anchors; plan it as its own follow-up with a
  fresh anchor inventory — do NOT piggyback it here.
- The spec's centered Doto timecode chip in the transport bar is already
  live (039); if a future player rework moves it, `app-review.dc.html` is the
  reference.
- Fields-tab contents (right sidebar) have no dedicated spec section; token
  hygiene there is fine as-is.
