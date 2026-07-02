# Plan 054: Align the comment-input timecode chip with the input's first text line

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat bf3d541..HEAD -- apps/web/components/review/comment-input.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (visual)
- **Planned at**: commit `bf3d541`, 2026-07-03

## Why this matters

The inline timecode chip (`00:00:00:00`) inside the comment input sits
visibly higher than the "Leave your comment…" placeholder text next to it
(maintainer screenshot, 2026-07-03). Both editor and guest review screens
show it — the comment input is the single most-used control in the product.

Root cause: the chip and the textarea are top-aligned (`items-start`
container), but their first-line boxes have different heights and offsets.
The textarea's first text line starts at `py-2.5` (10px) and is ~19–20px
tall (13px font, normal line-height). The chip is only ~15px tall
(11px font, `leading-none`, `py-0.5`) and is nudged with an eyeballed
`mt-[9px]` — so its text baseline lands ~3px above the placeholder's.

## Current state

Relevant file: `apps/web/components/review/comment-input.tsx`. The input
area, lines 404–427 (chip at 408–412):

```tsx
      {/* Input area */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <div className="flex items-start gap-0 rounded-lg border border-border bg-bg-tertiary focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
            {/* Inline timecode badge — show when timecode attached (normal mode) or in drawing mode */}
            {hasTimecode && (timecodeAttached || isDrawingMode) && (
              <span className="shrink-0 ml-2.5 mt-[9px] rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-400 leading-none select-none">
                {displayTime(playheadTime)}
              </span>
            )}
            <textarea
              ref={textareaRef}
              className="flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none min-h-[38px] max-h-[120px]"
```

The `items-start` container is correct (textarea grows multi-line; the chip
must stay pinned to the first line) — only the chip's own box needs fixing.

This component is in plan 039's (retheme) drift-check file list. Keep this
diff to the three alignment classes named below — **no color, radius, or
font changes** (the amber chip color is retheme territory).

## Commands you will need

Run all from `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0              |
| Tests     | `pnpm test`              | all pass (141 at plan time) |
| Lint      | `pnpm lint`              | no new errors       |

## Scope

**In scope** (the only file you should modify):

- `apps/web/components/review/comment-input.tsx` — the chip `<span>`'s
  class string only (line ~409).

**Out of scope** (do NOT touch):

- The textarea classes, the `items-start` container, the drawing-mode
  banner (line ~392), the mention dropdown.
- Chip colors (`bg-amber-500/20 text-amber-400`) — retheme (039) territory.
- Any other component.

## Git workflow

- Branch: `advisor/054-comment-timecode-chip-alignment`
- Conventional commit, e.g. `fix(review): align timecode chip with comment input text`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Give the chip the same first-line box as the textarea

In the chip `<span>` (line ~409), change exactly three things:

- `mt-[9px]` → `mt-2.5` (10px — same top offset as the textarea's `py-2.5`)
- `py-0.5` → `py-0`
- `leading-none` → `leading-[19.5px]` (13px × 1.5 — the textarea's
  first-line height, so the chip's text centers on the same line box)

Result:

```tsx
              <span className="shrink-0 ml-2.5 mt-2.5 rounded bg-amber-500/20 px-1.5 py-0 font-mono text-[11px] text-amber-400 leading-[19.5px] select-none">
```

**Verify**: `grep -c "leading-\[19.5px\]" components/review/comment-input.tsx` → 1;
`grep -c "mt-\[9px\]" components/review/comment-input.tsx` → 0.

### Step 2: Gate + visual check

**Verify**: from `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` →
all pass; `pnpm lint` → no new errors.

Visual check (dev stack usually running — `curl -s http://localhost:8000/health`):
open any asset review page, look at the comment input. The chip text and the
"Leave your comment…" placeholder must sit on the same baseline (screenshot
comparison; zoom in DevTools if unsure). Check both one-line and multi-line
input: with 3+ lines typed, the chip stays pinned to the FIRST line. If the
baseline is still off by >1px, adjust only the `leading-[…]` value to the
textarea's real first-line height (measure the textarea's computed
line-height in DevTools) and note the final value in your report.

## Test plan

No new unit tests — JSDOM has no font metrics; this is a 1-line visual fix.
Gate = grep anchors + suite green + the visual check above.

## Done criteria

ALL must hold (run from `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0 and `pnpm test` exits 0
- [ ] `grep -c "mt-\[9px\]" components/review/comment-input.tsx` → 0
- [ ] Visual check passed (or the adjusted leading value reported)
- [ ] `git status --porcelain` shows only `comment-input.tsx` (+ plans/README.md)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The chip `<span>` class string doesn't match the excerpt.
- The input container is no longer `items-start` (someone changed the
  alignment strategy) — re-evaluate instead of stacking fixes.

## Maintenance notes

- Plan 039 (retheme) recolors this chip (amber → mono/red per the design) —
  the `mt-2.5` / `leading-[…]` alignment classes must survive that sweep.
- If the textarea's font size or padding ever changes, the chip's
  `mt`/`leading` must be re-derived (top offset = textarea padding;
  leading = textarea first-line height).
