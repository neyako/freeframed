# Plan 065: Conform the review video player (transport bar, custom quality dropdown, drop Fields tab)

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report — do not improvise. A reviewer maintains `plans/README.md`;
> do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- apps/web/components/review/video-player.tsx "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (presentation + one tab removal; no player logic changes)
- **Depends on**: soft — round-8 branch `advisor/062-app-review-conformance` restyled
  the review *page* (this plan edits the *player* + removes a tab the page renders).
  If 062 is merged, the review-page excerpt below still matches (verify in drift check).
- **Category**: design-conformance / UX
- **Planned at**: commit `a7d1e10`, 2026-07-04

## Why this matters

Three player issues on the asset review screen:

1. The transport bar (`video-player.tsx`) predates the `app-review.dc.html`
   player spec — generic 28px icon buttons, a plain play button, a native
   `<select>` for quality. Plan 062 restyled the review *page* around it but not
   this shared player component.
2. The quality selector is an OS-native `<select>` (renders the platform popup),
   which looks foreign in the monochrome UI.
3. The right panel's "Fields" tab shows only Name/Type/Version/Processing —
   thin, and the maintainer chose to **remove it** and give Comments the full
   height.

## Current state

### `apps/web/components/review/video-player.tsx`

Transport bar container (line ~358):
```tsx
<div className="flex items-center justify-between h-12 px-2 sm:px-4 bg-bg-secondary/80 border-t border-border shrink-0">
```

Play button (lines ~361–371): `h-7 w-7 rounded text-text-primary hover:bg-bg-hover`.
Loop (lines ~373–384): `h-7 w-7 rounded`, accent when active.
Speed (lines ~386–392): `h-7 px-1.5 text-xs font-medium ... tabular-nums` showing `{playbackRate}x`.
Volume (lines ~394–404): `h-7 w-7 rounded text-text-tertiary`.
Center timecode (lines ~408–430): a `bg-bg-tertiary` pill with `font-dot` value + a
`ChevronUp`, opening the time-format dropdown (lines ~431–463) — **this dropdown
is the exemplar for the new quality dropdown** (custom, `bg-bg-elevated`, mono
header, check-marked options).
Quality selector (lines ~469–489) — the native select to replace:
```tsx
{qualityLevels.length > 0 && (
  <select
    value={currentQuality}
    onChange={(e) => setQuality(parseInt(e.target.value, 10))}
    className="bg-transparent text-text-secondary text-xs border border-border rounded px-1.5 py-1 cursor-pointer shrink-0 hover:text-text-primary transition-colors"
    aria-label="Quality"
  >
    <option value={-1} className="bg-bg-secondary">Auto</option>
    {qualityLevels.map((level) => (
      <option key={level.index} value={level.index} className="bg-bg-secondary">{level.label}</option>
    ))}
  </select>
)}
```
Fullscreen (lines ~491–502): `h-7 w-7 rounded text-text-tertiary`.

`qualityLevels: QualityLevel[]` each has `{ index, height, bitrate, label }`;
`currentQuality` is `-1` for Auto; `setQuality(levelIndex)` sets it.

### `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`

Right-panel tab state (line 59): `const [activeTab, setActiveTab] = useState<'comments' | 'fields'>('comments')`.
The Segmented tabs (lines ~447–457) and the `activeTab === 'comments' ? (<Comments>) : (<Fields div>)`
branch (lines ~461–520) — the Fields branch renders Name/Type/Version/Processing rows.

### Player spec (inlined from `app-review.dc.html`)

Transport controls row: `padding:4px 16px 12px`, three-column (left controls /
center timecode / right controls). Specifics:
- **Play**: 34×34px, `background:var(--bg-tertiary); border:1px solid var(--border-primary); border-radius:var(--radius-md); color:var(--text-primary)`; hover `border-color:var(--border-strong)`. (Tailwind: `h-[34px] w-[34px] rounded-md border border-border bg-bg-tertiary text-text-primary hover:border-border-strong`.)
- **Loop / Volume / Fullscreen**: borderless, `color:var(--text-tertiary)`, hover `color:var(--text-primary)`, ~15–17px icons. (Tailwind: `text-text-tertiary hover:text-text-primary`, no bg, no border.)
- **Speed**: mono 12px `1×` in `--text-secondary`. (Tailwind: `font-mono text-xs text-text-secondary`; keep the click-to-cycle behavior.)
- **Center timecode**: `ff-dot-num` 16px in a `bg-tertiary` + `border-primary` + `radius-md` pill, `padding 5px 14px`. The app already uses `font-dot` here — conform the container to `rounded-md border border-border bg-bg-tertiary px-3.5 py-1`.
- **Quality**: a compact control; per finding #4 build a **custom dropdown** (NOT native `<select>`) matching the time-format dropdown already in this file.

### Repo conventions

- Tailwind tokens only (`bg-bg-tertiary`, `border-border`, `border-border-strong`,
  `text-text-{primary,secondary,tertiary}`, `bg-bg-elevated`, `bg-accent`,
  `font-dot`, `font-mono`). No hex.
- The custom-dropdown pattern (state + outside-click close + absolute panel) is
  already implemented for the time-format picker in this same file — copy it.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**:
- `apps/web/components/review/video-player.tsx` (transport bar + quality dropdown)
- `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx` (remove Fields tab)

**Out of scope** (do NOT touch):
- `hooks/use-video-player.ts` — player logic, quality API unchanged.
- `components/review/progress-bar.tsx` — the scrub/comment track is its own
  component; leave it.
- `components/review/comment-panel.tsx`, `comment-input.tsx` — unchanged.
- The library page right panel (`projects/[id]/page.tsx`) — it has a similar
  Comments/Fields tab; a follow-up may address it, NOT this plan.
- `VideoFrameConstraint`, keyboard shortcuts, `initialStreamUrl` logic — unchanged.

## Git workflow

- Branch: `advisor/065-review-player-conformance`
- Commit: `fix(web): conform review player transport bar + custom quality dropdown, drop Fields tab (plan 065)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Play button → spec (bordered 34px)

Change the play button (lines ~361–371) className to:
```tsx
className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-border bg-bg-tertiary text-text-primary hover:border-border-strong transition-colors"
```
Keep the `onClick={togglePlay}`, `aria-label`, and the Play/Pause icon swap.

**Verify**: `grep -c "h-\[34px\] w-\[34px\]" apps/web/components/review/video-player.tsx` → `1`

### Step 2: Loop / volume / fullscreen → borderless tertiary; speed → mono

- Loop (lines ~373–384): keep the active-accent state, but change the base
  className to borderless: `flex h-7 w-7 items-center justify-center rounded transition-colors` +
  active `text-accent`, inactive `text-text-tertiary hover:text-text-primary` (drop `hover:bg-bg-hover` and the `bg-accent/10`).
- Volume (lines ~394–404) and Fullscreen (lines ~491–502): drop `hover:bg-bg-hover`,
  keep `text-text-tertiary hover:text-text-primary`.
- Speed (lines ~386–392): change to `font-mono text-xs text-text-secondary hover:text-text-primary`
  (drop `font-medium`); keep the `{playbackRate}x` and click-to-cycle.

**Verify**: `grep -c "hover:bg-bg-hover" apps/web/components/review/video-player.tsx` →
should drop to `0` (the time-format dropdown option rows use `hover:bg-bg-hover`
too — if so, expected value is the count of those rows; report the number you see
and confirm none of the transport *buttons* still use it).

### Step 3: Center timecode pill → spec container

On the timecode trigger button (line ~411) change
`rounded-md bg-bg-tertiary px-2 sm:px-3 py-1 hover:bg-bg-hover` to
`rounded-md border border-border bg-bg-tertiary px-3.5 py-1 hover:border-border-strong`.
Keep the `font-dot` value span and the `ChevronUp` + time-format dropdown intact.

**Verify**: `grep -c "font-dot" apps/web/components/review/video-player.tsx` → unchanged (≥1)

### Step 4: Quality native `<select>` → custom dropdown

Replace the native `<select>` (lines ~469–489) with a custom dropdown modeled on
the time-format dropdown in this file. Add state and an outside-click handler
(mirror `timeFormatOpen` / `timeFormatRef`):

```tsx
const [qualityOpen, setQualityOpen] = useState(false)
const qualityRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  if (!qualityOpen) return
  const handleClick = (e: MouseEvent) => {
    if (qualityRef.current && !qualityRef.current.contains(e.target as Node)) setQualityOpen(false)
  }
  document.addEventListener('mousedown', handleClick)
  return () => document.removeEventListener('mousedown', handleClick)
}, [qualityOpen])
```

Render (replacing the `<select>` block):
```tsx
{qualityLevels.length > 0 && (
  <div className="relative shrink-0" ref={qualityRef}>
    <button
      onClick={() => setQualityOpen((p) => !p)}
      className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
      aria-label="Quality"
    >
      {currentQuality === -1 ? 'Auto' : (qualityLevels.find((l) => l.index === currentQuality)?.label ?? 'Auto')}
      <ChevronUp className={cn('h-3 w-3 text-text-tertiary transition-transform', qualityOpen && 'rotate-180')} />
    </button>
    {qualityOpen && (
      <div className="absolute bottom-full right-0 mb-2 z-50 w-36 rounded border border-border bg-bg-elevated py-1.5 animate-in fade-in zoom-in-95 duration-100">
        <button
          className={cn('flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors', currentQuality === -1 ? 'text-text-primary' : 'text-text-secondary hover:bg-bg-hover')}
          onClick={() => { setQuality(-1); setQualityOpen(false) }}
        >
          Auto {currentQuality === -1 && <Check className="h-4 w-4 text-accent" />}
        </button>
        {qualityLevels.map((level) => (
          <button
            key={level.index}
            className={cn('flex w-full items-center justify-between px-3 py-2 text-[13px] transition-colors', currentQuality === level.index ? 'text-text-primary' : 'text-text-secondary hover:bg-bg-hover')}
            onClick={() => { setQuality(level.index); setQualityOpen(false) }}
          >
            {level.label} {currentQuality === level.index && <Check className="h-4 w-4 text-accent" />}
          </button>
        ))}
      </div>
    )}
  </div>
)}
```
`Check` and `ChevronUp` are already imported in this file. Do not add a native
`<select>` back.

**Verify**: `grep -c "<select" apps/web/components/review/video-player.tsx` → `0`;
`grep -c "qualityOpen" apps/web/components/review/video-player.tsx` → `≥4`

### Step 5: Remove the Fields tab (review page → Comments full height)

In `apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx`:
- Delete the `activeTab` state (line 59) and any `setActiveTab` references.
- Remove the `<Segmented ... Comments/Fields ... />` control block (lines ~447–457).
- Replace the `activeTab === 'comments' ? ( ...CommentPanel+CommentInput... ) : ( ...Fields div... )`
  conditional with just the Comments branch content (CommentPanel + CommentInput),
  rendered unconditionally, filling the panel height.
- Remove the now-unused `Segmented` import IF it is no longer referenced in the
  file (grep first).

**Verify**: `grep -c "activeTab" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `0`;
`grep -c "Fields" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `0`

### Step 6: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass
(fix only class-string assertions that reference changed strings; if a review
test asserts on the Fields tab, update it to expect Comments-only); `pnpm build` → exit 0.

## Test plan

No new test file required. Run `pnpm test` — if a review/asset-page test asserts
the Fields tab or the native select exists, update the assertion to match the new
behavior (Comments-only panel; custom quality dropdown button). Keep behavioral
assertions (comment submit, playback controls) intact. If a failure is behavioral
rather than a class/label assertion, STOP.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "<select" apps/web/components/review/video-player.tsx` → `0`
- [ ] `grep -c "h-\[34px\] w-\[34px\]" apps/web/components/review/video-player.tsx` → `1`
- [ ] `grep -c "activeTab" "apps/web/app/(dashboard)/projects/[id]/assets/[assetId]/page.tsx"` → `0`
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- Excerpts don't match the live files (drift — likely from 062 merge; re-read and
  compare before proceeding).
- Removing `activeTab` reveals the Fields branch also holds logic used elsewhere
  (it should be pure presentation) — report.
- The `Segmented` import is used elsewhere in the review page — then keep the
  import, only remove the tab usage.

## Maintenance notes

- The custom quality dropdown and the time-format dropdown now share a pattern;
  if a third player dropdown appears, extract a small `PlayerDropdown` component.
- The library page (`projects/[id]/page.tsx`) still has a Comments/Fields tab in
  its asset preview panel — a future plan may remove it for consistency; out of
  scope here.
