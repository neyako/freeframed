# Plan 035: Restyle the five primitive components to the freeframed design language

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/components/ui/button.tsx apps/web/components/ui/input.tsx apps/web/components/shared/badge.tsx apps/web/components/shared/avatar.tsx apps/web/components/shared/empty-state.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (Button/Input are used everywhere; class-contract tests exist)
- **Depends on**: plans/034-design-tokens-foundation.md (tokens, fonts, radii must exist)
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

Plan 034 swapped the token values (monochrome canvas, red `#D71921` sole
accent, Space Grotesk/Space Mono/Doto, 0–4 px radii, no shadows). The five
primitive components still carry the *old* design's shapes: soft shadows on
buttons, sentence-case sans labels, tinted status pills, blue-tinted avatars.
This plan restyles them to the design spec so every screen that composes them
(nearly all of them) snaps to the new language: mono-uppercase "mechanical"
buttons, hairline inputs with a red focus inset, monochrome workflow badges
where **rejected is the only red**, hairline-ringed mono avatars, and quiet
dot-grid empty states.

## Design language (inline reference)

- Labels/controls: `Space Mono` (`font-mono`), uppercase, letterspaced
  (0.08em–0.18em), weight 400.
- One filled red primary action per view; everything else monochrome.
- Press feedback = 1px downward nudge (`active:translate-y-px`), never shadow
  or scale.
- Hairline borders (`border-border`, stronger: `border-border-strong` →
  `var(--border-strong)`, added in 034).
- Badge scale (from the design's badge spec): draft = quiet outline · in
  review = outline + blinking dot (`animate-blink`, added in 034) · approved =
  **solid monochrome inversion** · rejected = **filled red** · archived =
  dashed outline.
- Avatar: circle, hairline ring, mono initials on flat tile; a red-filled
  variant marks "the current user".
- Empty state: squared icon tile on a dot-grid field (`.ff-dotgrid`, added in
  034), one action max.

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/components/ui/button.tsx` — CVA-based; base includes
  `rounded-md font-medium ... active:scale-[0.98]`, variants:
  ```
  primary: 'bg-accent text-text-inverse hover:bg-accent-hover shadow-sm shadow-accent/20 hover:shadow-md hover:shadow-accent/25',
  secondary: 'bg-bg-tertiary text-text-primary hover:bg-bg-hover border border-border hover:border-border-focus',
  ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  destructive: 'bg-status-error text-white hover:brightness-110 shadow-sm shadow-status-error/20',
  sizes: sm 'h-8 px-3 text-sm rounded', md 'h-9 px-4 text-sm', lg 'h-11 px-6 text-base'
  ```
  There is **no `solid` variant** yet. Uses `Loader2` spinner and Radix `Slot`
  for `asChild` — keep both mechanisms.
- `apps/web/components/ui/input.tsx` — renders optional label
  (`text-sm font-medium text-text-secondary`), input
  (`h-10 rounded-md border-border bg-bg-secondary ... focus:border-accent focus:ring-2 focus:ring-accent/20`),
  error (`border-status-error` + `<p className="text-xs text-status-error">`),
  optional leading icon, password eye toggle. Keep all behavior (ids, eye
  toggle, icon slot) — restyle classes only.
- `apps/web/components/shared/badge.tsx` — `statusConfig` record keyed by
  `AssetStatus` (`draft | in_review | approved | rejected | archived` — from
  `types`), each entry `{ label, dot, bg, text }`, rendered as
  `rounded-full px-2 py-0.5 text-2xs font-medium` pill with a dot span.
  `in_review` uses `bg-status-warning/10 text-status-warning`, `approved` green,
  `rejected` red-tinted.
- `apps/web/components/shared/avatar.tsx` — Radix Avatar,
  `rounded-full bg-accent-muted`, fallback initials `font-medium text-accent`,
  sizes `sm h-6 w-6 / md h-8 w-8 / lg h-10 w-10`. (With 034's tokens,
  `bg-accent-muted` is now translucent red — wrong for a neutral avatar.)
- `apps/web/components/shared/empty-state.tsx` — icon tile
  `h-12 w-12 rounded-xl bg-bg-tertiary text-text-tertiary`, title
  `text-sm font-medium`, description `text-xs`, optional secondary Button.
- Tests (`apps/web/components/__tests__/`): `button.test.tsx` (asserts primary
  contains `bg-accent`), `input.test.tsx`, `badge.test.tsx`,
  `avatar.test.tsx` (asserts `rounded-full`), `empty-state.test.tsx`. Suite
  baseline: 136 passed (136).

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | ≥136 passed, 0 failed |
| One file  | `pnpm test -- components/__tests__/button.test.tsx` | pass |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/web/components/ui/button.tsx`
- `apps/web/components/ui/input.tsx`
- `apps/web/components/shared/badge.tsx`
- `apps/web/components/shared/avatar.tsx`
- `apps/web/components/shared/empty-state.tsx`
- Their tests in `apps/web/components/__tests__/` (update assertions if a
  changed class was asserted; add the new cases in the Test plan)

**Out of scope** (do NOT touch):
- Any call site of these components (pages, panels) — later plans adjust the
  few call sites that override styles (e.g. approval-bar's green Approve is
  plan 039).
- `components/ui/confirm-dialog.tsx`, `components/shared/skeleton.tsx`,
  `components/shared/toast.tsx` — they inherit tokens; leave them.
- `tailwind.config.ts`, `globals.css` (034 owns them). If a needed token is
  missing, that's a STOP.

## Git workflow

- Branch: `advisor/035-primitive-components-restyle`
- Conventional commits, e.g. `feat(web): restyle button/input/badge/avatar/empty-state to design system`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Button — mono-uppercase mechanical actions + new `solid` variant

Rewrite `buttonVariants` in `components/ui/button.tsx`:

- Base: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-mono font-normal uppercase tracking-[0.08em] border border-transparent cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary disabled:pointer-events-none disabled:opacity-40 active:translate-y-px`
  (drops `font-medium`, `active:scale-[0.98]`, all shadows).
- Variants:
  - `primary`: `bg-accent text-white hover:bg-accent-hover`
  - `solid` (NEW): `bg-text-primary text-bg-primary hover:bg-text-secondary`
  - `secondary`: `bg-transparent text-text-primary border-border-strong hover:border-text-primary hover:bg-bg-hover`
  - `ghost`: `text-text-secondary hover:text-text-primary hover:bg-bg-hover`
  - `destructive`: `bg-accent text-white hover:bg-accent-hover` (in this design,
    red IS the destructive interrupt — visually identical to primary; keep the
    variant name so ~20 call sites compile unchanged)
- Sizes: `sm: 'h-[34px] px-3.5 text-[11px]'`, `md: 'h-10 px-[18px] text-xs'`,
  `lg: 'h-12 px-[26px] text-[13px]'`.
- Keep `asChild`/`Slot`, `loading`/`Loader2`, `defaultVariants` as they are.

**Verify**: `pnpm test -- components/__tests__/button.test.tsx` → pass
(primary still contains `bg-accent`); `pnpm exec tsc --noEmit` → 0.

### Step 2: Input — hairline field, red focus inset, mono label

In `components/ui/input.tsx`, keep the structure/behavior; change classes:

- Label → `font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-text-secondary`
- Input → `flex h-11 w-full rounded border border-border-strong bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-accent focus:shadow-[inset_0_0_0_1px_var(--accent)] disabled:cursor-not-allowed disabled:opacity-45`
  (the red *inset* line is the design's focus treatment — arbitrary-value
  shadow still works despite 034's boxShadow-scale kill).
- Error state → `border-accent focus:border-accent` and the error text →
  `font-mono text-[11px] tracking-[0.04em] text-accent`.
- Keep icon (`pl-9`) and password (`pr-9`) paddings and the eye toggle.

**Verify**: `pnpm test -- components/__tests__/input.test.tsx` → pass.

### Step 3: Badge — monochrome workflow scale, red = rejected only

Rewrite `statusConfig` + render in `components/shared/badge.tsx`. Target shape
(container + per-status classes replacing `{dot,bg,text}` with one `className`
plus `dotClassName` if needed):

- Container base: `inline-flex items-center gap-1.5 rounded-none border px-2 py-0.5 font-mono text-[10px] font-normal uppercase tracking-[0.14em] leading-[14px]`
- Dot base: `h-1.5 w-1.5 rounded-full bg-current shrink-0`
- Per status:
  - `draft`: `text-text-tertiary border-border bg-transparent`
  - `in_review`: `text-text-primary border-border-strong bg-transparent`, dot
    additionally `animate-blink`
  - `approved`: `bg-text-primary text-text-inverse border-text-primary`
  - `rejected`: `bg-accent text-white border-accent`
  - `archived`: `text-text-tertiary border-border-secondary border-dashed bg-transparent`
- Labels unchanged (`Draft`, `In Review`, `Approved`, `Rejected`, `Archived`).

**Verify**: `pnpm test -- components/__tests__/badge.test.tsx` → pass (update
any assertion that pinned the old tinted classes; label assertions must not
change).

### Step 4: Avatar — hairline ring, mono initials, red "you" variant

In `components/shared/avatar.tsx`:

- Root → `rounded-full overflow-hidden bg-bg-tertiary border border-border-strong shrink-0`
- Fallback → `font-mono font-normal tracking-[0.04em] text-text-primary`
- Sizes → `sm: 'h-[26px] w-[26px] text-[9px]'`, `md: 'h-[34px] w-[34px] text-[11px]'`,
  `lg: 'h-11 w-11 text-[13px]'`
- Add prop `accent?: boolean` (default false) → when true:
  `bg-accent border-accent text-white` on root/fallback (marks the current
  user; call-site adoption happens in later plans — adding the prop is enough
  here).

**Verify**: `pnpm test -- components/__tests__/avatar.test.tsx` → pass
(`rounded-full` assertion survives).

### Step 5: Empty state — quiet screen on a dot grid

In `components/shared/empty-state.tsx`:

- Container: add `ff-dotgrid` to the existing flex classes; padding →
  `py-12 px-6` stays.
- Icon tile → `flex h-[58px] w-[58px] items-center justify-center rounded border border-border-strong bg-bg-primary text-text-secondary`
- Title → `text-base font-medium text-text-primary tracking-[-0.01em]`
- Description → `text-[13px] text-text-secondary max-w-[300px] leading-relaxed`
- Action button: change `variant="secondary"` → `variant="primary"` (the
  design gives the empty state's one action the red primary).

**Verify**: `pnpm test -- components/__tests__/empty-state.test.tsx` → pass.

### Step 6: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke via `pnpm dev`: /login (input + button), any project page (badges
on assets, avatars in header, empty folder → empty state).

## Test plan

Update/extend in `apps/web/components/__tests__/` (model after the existing
files there — plain vitest + testing-library `render`):

- `button.test.tsx`: add a case — `variant="solid"` renders `bg-text-primary`;
  keep the `bg-accent` primary case.
- `badge.test.tsx`: add cases — `rejected` contains `bg-accent`; `approved`
  contains `bg-text-primary`; `in_review` dot has `animate-blink`.
- `avatar.test.tsx`: add a case — `accent` prop renders `bg-accent`.
- Existing tests updated only where they pinned removed classes.
- Verification: `pnpm test` → ≥140 passed, 0 failed.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed, total ≥ 140 (new cases added)
- [ ] `grep -c "shadow-accent\|shadow-sm\|shadow-md" components/ui/button.tsx` → 0
- [ ] `grep -c "solid" components/ui/button.tsx` → ≥2 (variant defined + typed)
- [ ] `grep -c "animate-blink" components/shared/badge.tsx` → 1
- [ ] `grep -c "status-warning\|status-success" components/shared/badge.tsx` → 0
- [ ] `grep -c "ff-dotgrid" components/shared/empty-state.tsx` → 1
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 034 is not merged/DONE (check `grep -c "D71921" app/globals.css` → if 0,
  STOP — this plan's classes reference 034's tokens: `border-strong`,
  `animate-blink`, `ff-dotgrid`, `font-dot`).
- More than 5 test files fail after Step 1 (suggests a call-site contract this
  plan didn't anticipate — e.g. something imports `buttonVariants` and pins
  variant names beyond `primary|secondary|ghost|destructive`).
- `AssetStatus` in `types` has values other than the five listed (badge config
  must stay exhaustive or TS breaks).
- You find yourself editing any file outside Scope to make the gate pass.

## Maintenance notes

- `destructive` === `primary` visually now. If the maintainer wants a distinct
  destructive treatment later, differentiate by *context* (confirm dialogs)
  rather than adding another color.
- Uppercase transform happens in CSS — do not re-write call-site labels to
  uppercase; Vietnamese labels rely on proper casing for diacritics rendering.
- Reviewers should scrutinize: button height changes (`h-9`→`h-10` md) can
  shift tight toolbars; the review-page toolbars are checked in plan 039.
- The Avatar `accent` prop is introduced here but only adopted in plans 037/039
  (header user menu, comment authorship). If those plans are skipped, the prop
  is harmless dead surface.
