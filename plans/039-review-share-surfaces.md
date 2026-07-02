# Plan 039: Review & share surfaces — Doto timecodes, red timeline, mono approvals, tokenized panels

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/components/review/video-player.tsx apps/web/components/review/progress-bar.tsx apps/web/components/review/approval-bar.tsx apps/web/components/review/comment-input.tsx apps/web/components/review/comment-panel.tsx apps/web/components/share/folder-share-viewer.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (core review flow; big files; guest surface has no auth net)
- **Depends on**: plans/034-design-tokens-foundation.md, plans/035-primitive-components-restyle.md
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The review screen is FreeFrame's product core and the design's showcase: the
tokens page sets a Doto timecode `00:24:17:08` in red as the system's hero
image. Today the player's timecode is generic mono, the playback progress is a
**hardcoded indigo gradient left over from the old blue theme**
(`#6366f1 → #818cf8` — it ignored the token system even before the redesign),
tooltips/dropdowns hardcode `#1e1e22`/`#2a2a30` + `white/10`, and the approve
action is green. This plan applies the design language: dot-matrix numerals
for time, red as the playhead/interrupt, monochrome approvals (approve =
solid inversion; reject = red), and tokens instead of hex so the guest share
surface follows the theme.

This is a **typographic/token pass only** — no layout, no behavior, no
player-logic changes.

## Design spec (inline reference)

- Timecode/numerals: `font-dot font-bold` (Doto, added in 034), tracking
  0.02em; the *active* timecode may be red (`text-accent`), figures elsewhere
  mono-white.
- Red = sole interrupt: playhead/progress fill red; rejected red; everything
  else monochrome (`--text-*`, `--border-*`, `--bg-*`).
- Approve = solid monochrome inversion (Button `variant="solid"` from 035);
  Reject = red (`variant="primary"` styling); "Approved" state text mono,
  "Rejected" state text red.
- Floating panels: `bg-bg-elevated border border-border rounded` — hairline,
  no shadow (034 killed shadows), no `white/N` alpha borders.
- Labels: `font-mono` uppercase tracked; body text Space Grotesk.

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/components/review/video-player.tsx`:
  - Timecode display (line ~410):
    ```tsx
    <span className="font-mono text-sm text-text-primary tabular-nums tracking-wide">
    ```
  - Time-format dropdown (line ~429): `rounded-xl border border-white/10
    bg-[#2a2a30] shadow-2xl ...`; option hover `hover:bg-white/5`; active
    check `text-accent` (fine — red after 034).
- `apps/web/components/review/progress-bar.tsx` (the timeline scrubber):
  - Playback fill (lines ~412–415): `style={{ ..., background:
    'linear-gradient(90deg, #6366f1, #818cf8)' }}` ← hardcoded indigo.
  - Track (line ~382): `h-1 group-hover/progress:h-1.5 ... bg-border
    rounded-full`; buffered range `bg-border-secondary` (line ~389) — both
    fine as mono tokens, keep.
  - Time-range comment spans (line ~401): `bg-yellow-400/40`.
  - Comment-marker tooltip (lines ~241, ~262): `bg-[#1e1e22] border
    border-white/10 rounded-lg shadow-2xl` + matching rotated caret.
  - Frame-preview thumbnail (line ~465): `border border-white/15 shadow-xl`;
    its timecode chip (line ~472): `bg-black/90 text-white text-[11px]
    font-mono`.
- `apps/web/components/review/approval-bar.tsx`:
  - `statusConfig` (lines ~24–43): approved `text-status-success`, rejected
    `text-status-error`, pending `text-text-tertiary`.
  - Approve button (lines ~261–270): `<Button variant="primary"
    className="bg-status-success hover:opacity-90">`.
  - Reject button (lines ~251–260): `<Button variant="secondary"
    className="text-status-error border-status-error/30 ...">`.
  - Summary counts (lines ~205–221): `text-status-success` /
    `text-status-error` `text-2xs font-medium`.
  - RejectNoteDialog panel (line ~76): `rounded-xl ... shadow-xl`.
- `apps/web/components/review/comment-input.tsx` (line ~409): timecode chip
  `...amber-500/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-400...`.
- `apps/web/components/review/comment-panel.tsx`: timestamp (line ~485)
  `text-[11px] text-text-tertiary font-mono` (fine); clickable timecode
  (line ~502) `... font-mono text-accent hover:bg-accent/25` (fine after 034).
- `apps/web/components/share/folder-share-viewer.tsx` (65.6K — the guest
  share screen, also hosts the single-asset guest view via plan 032): uses
  `branding?.logo_url` (line ~1299) with a fallback branch. Treat via
  targeted greps only (Step 5) — do NOT hand-edit broadly.
- Note: after 034, `--status-success` is monochrome and `--status-error` IS
  the red accent — so some of these classes already *render* correctly; this
  plan replaces them with the semantically right classes so the intent
  survives any future token change.

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | 0 failed            |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope**:
- `apps/web/components/review/video-player.tsx`
- `apps/web/components/review/progress-bar.tsx`
- `apps/web/components/review/approval-bar.tsx`
- `apps/web/components/review/comment-input.tsx` (timecode chip classes only)
- `apps/web/components/review/comment-panel.tsx` (timecode/label classes only)
- `apps/web/components/share/folder-share-viewer.tsx` (targeted hardcoded
  colors + brand fallback only)

**Out of scope** (do NOT touch):
- Player logic: hls.js wiring, `useVideoPlayer`, seek/scrub handlers, keyboard
  shortcuts, annotation canvas/overlay, `review-provider.tsx`.
- Layout: the mobile affordances from plans 021/029 (floating comments button,
  `matchMedia` defaults) and the share-screen structure from 032/033.
- `audio-player.tsx`, `image-viewer.tsx` — same treatment later if wanted;
  keeping this plan reviewable.
- `share-video-player.tsx`, `version-switcher.tsx`, share-link panels (030's
  restored controls) — inherit tokens; leave.
- Comment threading/resolve logic in `comment-panel.tsx` (42.5K) — classes on
  the two named lines only.

## Git workflow

- Branch: `advisor/039-review-share-surfaces`
- Conventional commits, e.g. `feat(web): design-language pass on review player, approvals, guest share`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Video player — Doto timecode + tokenized dropdown

In `video-player.tsx`:

- Timecode span (line ~410) → `font-dot text-[15px] font-bold text-text-primary
  tracking-[0.02em]` (drop `tabular-nums` — Doto digits are uniform; keep the
  `/` separator span `text-text-tertiary`).
- Time-format dropdown container (line ~429) → `rounded border border-border
  bg-bg-elevated py-1.5` (drop `shadow-2xl`, `border-white/10`, `bg-[#2a2a30]`);
  option hover `hover:bg-white/5` → `hover:bg-bg-hover`; heading already
  uppercase — set `font-mono tracking-[0.16em]`.

**Verify**: `grep -c "#2a2a30\|white/10\|white/5" components/review/video-player.tsx` → 0.

### Step 2: Timeline scrubber — red playhead, mono markers

In `progress-bar.tsx`:

- Playback fill (line ~415): replace the indigo `linear-gradient` with
  `background: 'var(--accent)'` (or add `bg-accent` class and drop the style
  entry — keep the `width` style).
- Time-range comment spans (line ~401): `bg-yellow-400/40` →
  `bg-text-primary/30` (comments are content, not interrupts — mono per the
  design; the red lane belongs to the playhead).
- Tooltip + caret (lines ~241, ~262): `bg-[#1e1e22] border-white/10
  shadow-2xl` → `bg-bg-elevated border-border` (caret borders too).
- Frame preview (line ~465): `border-white/15 shadow-xl` → `border-border-strong`;
  its timecode chip (line ~472): add `font-dot`, keep `bg-black/90 text-white`
  (it overlays video — black is correct in both themes).
- Do not change track heights, hover growth, marker positioning math, or drag
  handlers.

**Verify**: `grep -c "6366f1\|818cf8\|yellow-400\|#1e1e22" components/review/progress-bar.tsx` → 0.

### Step 3: Approval bar — mono approve, red reject

In `approval-bar.tsx`:

- `statusConfig`: approved → `text-text-primary`, rejected → `text-accent`,
  pending stays `text-text-tertiary`.
- Approve button → `<Button variant="solid" size="sm" ...>` with **no
  className color override** (variant added in 035).
- Reject button → `<Button variant="ghost" size="sm"
  className="text-accent hover:bg-accent-muted">` (quiet until hovered; red
  text carries the intent — primary red is reserved for the one filled action
  per view, which on this screen is Approve's counterpart NOT being filled;
  two filled buttons side-by-side is what the design avoids).
- Summary counts → `font-mono text-[10px] uppercase tracking-[0.1em]`:
  approved `text-text-secondary`, rejected `text-accent`, pending
  `text-text-tertiary`.
- "You approved" → `text-text-primary`; "You rejected" → `text-accent`.
- RejectNoteDialog panel → `rounded border border-border bg-bg-elevated`
  (drop `shadow-xl`); its textarea focus → `focus:border-accent`.

**Verify**: `grep -c "status-success\|status-error" components/review/approval-bar.tsx` → 0;
`pnpm exec tsc --noEmit` → 0.

### Step 4: Comment timecode chips

- `comment-input.tsx` (line ~409): the amber timecode chip → `bg-accent-muted
  border border-accent-line text-accent font-mono text-[11px]` (red-tinted —
  the clickable timecode is the design's red-numeral motif; `accent-line`
  token added in 034).
- `comment-panel.tsx` (line ~502): already `text-accent`; add `font-dot` to
  the timecode text if the element renders only digits/colons, else leave
  `font-mono`.

**Verify**: `grep -c "amber-" components/review/comment-input.tsx` → 0.

### Step 5: Guest share surface — targeted token sweep + brand fallback

In `folder-share-viewer.tsx` (65.6K — greps only, no broad edits):

1. `grep -n "white/1\|white/5\|#[0-9a-fA-F]\{6\}\|shadow-xl\|shadow-2xl" components/share/folder-share-viewer.tsx`
2. For each hit that is a *panel/border/hover* color: map to tokens
   (`border-white/10`→`border-border`, `bg-white/5 hover`→`bg-bg-hover`,
   solid hex panels→`bg-bg-elevated`, drop dead `shadow-*`). Leave hits that
   overlay video/imagery (`bg-black/*` scrims) untouched.
3. Brand fallback near line ~1299: where `branding?.logo_url` is absent and a
   default logo/text renders, use the wordmark pattern from plan 037:
   red dot (8px) + `font-mono text-[15px] font-bold` `freeframed`.
4. Guest-facing labels ("Shared with you", counts, etc.) that are already
   small/uppercase → conform to `font-mono tracking-[0.12em]`; do not
   restructure.

If a hit's purpose is ambiguous, skip it and list it in your report instead
of guessing.

**Verify**: `pnpm test` → 0 failed (share tests exist:
`components/share/__tests__/share-video-player.test.tsx`, plus share-dialog
tests under `components/review/__tests__/`).

### Step 6: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke (`pnpm dev`): open an asset review page — Doto timecode, red
playhead, mono comment ranges, tooltip flat; approve/reject states; a guest
share link (dev share or the all-in-one image) — themed panels, wordmark
fallback. Check both themes.

## Test plan

- No new test files required (this is a class-level pass over logic-heavy
  files; snapshot-free). Guard rails:
  - `pnpm test` → 0 failed (share + review suites cover render paths).
  - The grep-based done criteria below are the regression net for the
    hardcoded colors.
- If any existing test pins a changed class (none found at `39bdfc6`), update
  the assertion to the new class in the same commit.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed
- [ ] `grep -c "6366f1\|818cf8" components/review/progress-bar.tsx` → 0
- [ ] `grep -c "font-dot" components/review/video-player.tsx` → ≥1
- [ ] `grep -c "status-success" components/review/approval-bar.tsx` → 0
- [ ] `grep -c "amber-" components/review/comment-input.tsx` → 0
- [ ] `grep -c "variant=\"solid\"" components/review/approval-bar.tsx` → 1
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- 035 not landed (Button has no `solid` variant — `grep -c "solid"
  components/ui/button.tsx` → 0). Hard dependency for Step 3.
- The progress-bar playback fill is no longer an inline `linear-gradient`
  (drift — someone already tokenized it; reconcile).
- Changing the comment-range color to mono makes ranges indistinguishable
  from the buffered bar in dev — report with a screenshot; candidate fallback
  is `bg-accent-line` (translucent red), but that trades against
  "red = interrupt" and is the maintainer's call.
- The folder-share-viewer grep sweep turns up more than ~25 hits (bigger
  hardcode debt than recon saw — split into a follow-up rather than a mega
  diff).

## Maintenance notes

- Approve is now mono-inverted, not green — the strongest philosophical bet of
  this design ("the scale is monochrome by design… reserves the filled red for
  the one state that stops you"). If review feedback says approvals need a
  positive color, revisit `--status-success` in `globals.css` (034), not the
  components.
- The comment-range mono choice (Step 2) is flagged for the maintainer; the
  STOP condition names the alternative.
- `audio-player.tsx` and `image-viewer.tsx` were deliberately left for a
  follow-up conformance pass — they share the timecode/panel patterns; copy
  Steps 1–2 treatments.
- Reviewer scrutiny: Doto is `preload: false` (034) — watch for timecode
  flash-of-fallback on first load of the review page; if visible, flip
  preload in `app/layout.tsx`.
