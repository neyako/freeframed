# Plan 052: Video transport bar fits narrow viewports (no clipped controls)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 364e798..HEAD -- apps/web/components/review/video-player.tsx`
> Plan 047 adds a `poster` prop to this file (different lines). Any OTHER
> drift in the excerpts below is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (047 touches the same file at different lines; if both
  are dispatched, run 047 first)
- **Category**: bug (mobile UX)
- **Planned at**: commit `364e798`, 2026-07-03

## Why this matters

At phone widths ≤ ~375px, the video player's bottom transport bar overflows
its container and the right-side controls (quality select, **fullscreen
button**) clip off the screen edge. Measured live on 2026-07-03 at a 360px
viewport: the bar's `scrollWidth` was 390px vs `clientWidth` 356px — 34px of
controls unreachable. The player is shared by the editor review page AND the
guest share screen, so both audiences hit this. (Independently reported in a
second audit pass; confirmed by measurement.)

## Current state

Relevant file: `apps/web/components/review/video-player.tsx` — the transport
bar is lines ~354–501.

Bar container, `video-player.tsx:355`:

```tsx
      {/* Bottom transport bar (matches audio player style) */}
      <div className="flex items-center justify-between h-12 px-4 bg-bg-secondary/80 border-t border-border shrink-0">
```

Left group, `:357` — Play, Loop, Speed, Mute, each `gap-2`:

```tsx
        <div className="flex items-center gap-2">
```

Center timecode button, `:406-410`:

```tsx
          <button
            onClick={() => setTimeFormatOpen((p) => !p)}
            className="flex items-center gap-1.5 rounded-md bg-bg-tertiary px-3 py-1 hover:bg-bg-hover transition-colors"
          >
            <span className="font-mono text-sm text-text-primary tabular-nums tracking-wide">
```

Right group, `:464`:

```tsx
        <div className="flex items-center gap-2">
```

Width budget at 360px (measured): total content 390px. Needed savings ≥34px.
The changes below reclaim ~40px below `sm` (640px) without removing any
control: container padding −16, group gaps −8, timecode padding −8, timecode
font −~10.

Conventions: `sm` = 640px; classes only, no color/radius changes (retheme
plans 034–040 own visual restyling; 036 may later migrate the quality picker
to a `Segmented` — out of scope here).

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass            |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only file you should modify):

- `apps/web/components/review/video-player.tsx` — the transport-bar class
  strings only.

**Out of scope** (do NOT touch):

- `apps/web/components/review/audio-player.tsx` — has its own bar; fix only
  if the same measurement shows overflow there (it likely doesn't — fewer
  controls); if you find it overflows, note it in your report instead.
- `apps/web/components/review/progress-bar.tsx` — full-width, fine.
- Removing/hiding any control (Loop, Speed, Quality) — everything stays
  reachable at all widths.
- Any color/typography-token change (retheme territory).

## Git workflow

- Branch: `advisor/052-video-transport-bar-narrow-fit`
- Conventional commit, e.g. `fix(review): transport bar fits narrow viewports`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Compress the bar below `sm`

Apply these class changes in `video-player.tsx`:

1. Bar container (`:355`): `px-4` → `px-2 sm:px-4`
2. Left group (`:357`): `gap-2` → `gap-1 sm:gap-2`
3. Right group (`:464`): `gap-2` → `gap-1 sm:gap-2`
4. Timecode button (`:408`): `px-3` → `px-2 sm:px-3`
5. Timecode text span (`:410`): `text-sm` → `text-xs sm:text-sm`

Everything else on those lines stays byte-identical.

**Verify**: `grep -c "sm:px-4\|sm:gap-2\|sm:px-3\|sm:text-sm" apps/web/components/review/video-player.tsx` → ≥4 total matches across the bar.

### Step 2: Gate + measurement

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all
pass; `pnpm lint` → no new errors.

Live measurement (only if dev stack running): open an asset review page,
DevTools device emulation at **360×700**, run in the console:

```js
const bar = [...document.querySelectorAll('div')].find(d => d.className?.includes?.('h-12') && d.className.includes('justify-between') && d.className.includes('bg-bg-secondary'))
;({ scrollW: bar.scrollWidth, clientW: bar.clientWidth, fits: bar.scrollWidth <= bar.clientWidth })
```

Expected: `fits: true`. Repeat at 320px width; if it still overflows at 320,
additionally hide the Loop button below `sm` (`hidden sm:flex` on the Loop
button only) and re-measure — note this extra change in your report.

## Test plan

No new unit tests — JSDOM has no layout. Gate = grep anchor + suite green +
the 360px measurement above (or, without a running stack, the class changes
themselves whose arithmetic is documented in Current state).

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0
- [ ] Step 1 grep anchor holds
- [ ] `git status --porcelain` shows only `video-player.tsx` (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The transport bar markup doesn't match the excerpts (beyond 047's `poster`
  addition elsewhere in the file).
- The bar has been replaced by a redesigned control strip (retheme landed
  first) — the fix belongs in the new component; report.
- After Step 1 AND the Loop fallback, 320px still overflows — the bar needs a
  real responsive redesign (two-row or overflow menu), which is out of scope.

## Maintenance notes

- Plan 036 (retheme) may migrate the quality select / time-format picker to
  `Segmented` — carry the `sm:` compression classes into any new markup.
- Adding another control to this bar re-introduces the risk; measure at 360px
  before merging any such change.
