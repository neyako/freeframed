# Plan 036: Add switch, segmented, and progress primitives; migrate their inline ancestors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/components/projects/appearance-popover.tsx apps/web/components/projects/project-settings-dialog.tsx "apps/web/app/(dashboard)/projects/[id]/settings/page.tsx" apps/web/components/layout/uploads-panel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (new components + 4 contained call-site migrations)
- **Depends on**: plans/034-design-tokens-foundation.md (tokens/fonts). Independent of 035.
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The design system defines three primitives the app currently improvises
inline with hardcoded colors that ignore theming entirely: a **mechanical
toggle switch** (off = quiet grey; on = red fill, knob slides home), a
**segmented control** (mutually exclusive options in one hairline enclosure),
and **progress** (a segmented dot-matrix bar + a thin continuous track). Today
`appearance-popover.tsx` hand-rolls a `Segment` and a `ToggleRow` with
`border-white/10`, `bg-white/5`, `bg-[#1a1a1f]` — invisible-to-broken in light
theme — and the uploads panel draws its own progress div. This plan creates
`components/ui/switch.tsx`, `components/ui/segmented.tsx`,
`components/ui/progress.tsx` per the design spec and migrates the four inline
ancestors, deleting the hardcoded colors.

## Design spec (inline reference)

- **Switch** (design `components/ui/switch.tsx`): track 52×28 px,
  `border-radius: 999px`, bg `--bg-tertiary`, border `--border-strong`; knob
  22 px circle, 2 px inset, bg `--text-secondary`. On: track bg
  `--accent-muted`, border `--accent`; knob slides right and fills `--accent`.
  Motion ~220 ms `cubic-bezier(0.16,1,0.3,1)` (Tailwind `ease-spring` exists in
  the config). Small size: 40×22 track, 16 px knob. Disabled: opacity 0.4.
- **Segmented** (design `components/ui/segmented.tsx`): container
  `inline-flex p-[3px] gap-[3px] bg-bg-tertiary border border-border rounded`;
  option `px-[15px] py-2 font-mono text-[11px] uppercase tracking-[0.1em]
  text-text-secondary hover:text-text-primary rounded-none`; active option
  "lifts" onto the base surface: `bg-bg-primary text-text-primary border
  border-border-strong`; **accent variant** active: `bg-accent text-white
  border-accent`; stretch variant: container `flex w-full`, options
  `flex-1 justify-center`.
- **Progress** (design `components/ui/progress.tsx`):
  - Segmented bar: row of cells `flex gap-[3px]`; cell `h-3 flex-1
    rounded-[1px] border border-border-secondary bg-bg-hover`; filled cell
    `bg-text-primary border-text-primary`; when the bar is complete, the last
    ~25% of cells turn red (`bg-accent border-accent`) "to say done".
  - Continuous track: `h-1.5 w-full rounded-full bg-bg-hover overflow-hidden`
    with `h-full bg-text-primary` fill (accent variant: `bg-accent`).
  - Header row: label `font-mono text-[11px] uppercase tracking-[0.14em]
    text-text-secondary`; value in **`font-dot font-bold text-[15px]`**
    (dot-matrix numerals; `font-dot` exists after 034), accent when complete.

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/components/projects/appearance-popover.tsx` — contains the inline
  ancestors to migrate:
  - `Segment<T extends string>` (lines ~25–52): options
    `{value, label?, icon?}`, active = `bg-accent text-white`, container
    `flex rounded-md border border-white/10 overflow-hidden`.
  - `ToggleRow` (lines ~56–85): Radix `Switch.Root`
    `h-5 w-9 rounded-full`, `checked ? 'bg-accent' : 'bg-white/15'`, thumb
    `h-4 w-4 bg-white`, `translate-x-[18px]/[2px]`.
  - Popover content (line ~150): `bg-[#1a1a1f] border-white/10 shadow-2xl` —
    hardcoded, must become tokens.
  - `SelectRow` (native `<select>`, `bg-white/5 border-white/10`) — restyle
    classes to tokens in place; do NOT build a Select primitive in this plan.
- `apps/web/components/projects/project-settings-dialog.tsx` — imports
  `* as Switch from '@radix-ui/react-switch'` and renders its own styled
  Root/Thumb (grep `Switch.Root` to locate).
- `apps/web/app/(dashboard)/projects/[id]/settings/page.tsx` — same pattern,
  own Radix switch styling.
- `apps/web/components/layout/uploads-panel.tsx` — upload row progress at
  lines ~114–120:
  ```tsx
  <div className="mt-2 h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
    ... style={{ width: `${progressValue}%` }}
  ```
  and a percent text `Uploading {upload.progress}%` (line ~129).
- Conventions: CVA + `cn` from `@/lib/utils` (exemplar:
  `components/ui/button.tsx`); Radix wrappers keep `'use client'`,
  `React.forwardRef`, named exports. Tests live in
  `components/__tests__/*.test.tsx` (exemplar: `button.test.tsx`).
- `@radix-ui/react-switch` is already a dependency (`apps/web/package.json`).
- Test baseline: `pnpm test` → 136 passed (136) at `39bdfc6` (more if 035
  landed first — record the number you start with).

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | 0 failed            |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope**:
- `apps/web/components/ui/switch.tsx` (create)
- `apps/web/components/ui/segmented.tsx` (create)
- `apps/web/components/ui/progress.tsx` (create)
- `apps/web/components/__tests__/switch.test.tsx`, `segmented.test.tsx`,
  `progress.test.tsx` (create)
- Call-site migrations only: `components/projects/appearance-popover.tsx`,
  `components/projects/project-settings-dialog.tsx`,
  `app/(dashboard)/projects/[id]/settings/page.tsx`,
  `components/layout/uploads-panel.tsx`

**Out of scope** (do NOT touch):
- Building a Select/Dropdown primitive (SelectRow gets token classes only).
- Any other component that *could* use these primitives (video player quality
  picker, share panels…) — later plans adopt them.
- `components/review/progress-bar.tsx` — that's the video timeline scrubber,
  NOT a progress bar; plan 039 owns it.
- `tailwind.config.ts` / `globals.css`.

## Git workflow

- Branch: `advisor/036-switch-segmented-progress`
- Conventional commits, e.g. `feat(web): add switch/segmented/progress primitives`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `components/ui/switch.tsx`

Wrap Radix (`import * as RadixSwitch from '@radix-ui/react-switch'`), export
`Switch` with props `{ size?: 'sm' | 'md' }` + Radix root props, forwardRef.
Classes (md):

- Root: `relative inline-flex h-7 w-[52px] shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-bg-tertiary transition-colors duration-200 data-[state=checked]:border-accent data-[state=checked]:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent`
- Thumb: `block h-[22px] w-[22px] translate-x-[2px] rounded-full bg-text-secondary transition-transform duration-200 ease-spring data-[state=checked]:translate-x-[26px] data-[state=checked]:bg-accent`
- sm: root `h-[22px] w-10`, thumb `h-4 w-4 data-[state=checked]:translate-x-[20px]`
  (adjust the two translate values by eye in dev if the knob overshoots the
  border — target: 2 px visual inset both ends).

**Verify**: `pnpm exec tsc --noEmit` → 0.

### Step 2: Create `components/ui/segmented.tsx`

Generic component (no Radix needed):

```tsx
interface SegmentedOption<T extends string> { value: T; label?: string; icon?: React.ReactNode }
interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void
  accent?: boolean; stretch?: boolean; className?: string; optionClassName?: string
}
export function Segmented<T extends string>({ ... })
```

Render per the Design spec above; buttons `type="button"`, active option
`aria-pressed`/`data-active`. `optionClassName` lets dense call sites shrink
padding (the appearance popover uses `px-3 py-1.5`).

**Verify**: `pnpm exec tsc --noEmit` → 0.

### Step 3: Create `components/ui/progress.tsx`

Export two components:

- `SegmentedProgress({ value, cells = 12, label, showValue = true, className })`
  — clamps `value` 0–100, fills `round(value/100 * cells)` cells; when
  `value >= 100` the last `ceil(cells/4)` cells get the accent classes; value
  text `font-dot font-bold text-[15px]` (`text-accent` when complete); label
  per Design spec. Pure render — no animation needed beyond the cell
  `transition-colors`.
- `ProgressTrack({ value, accent = false, className })` — continuous thin
  track per Design spec, fill `style={{ width: `${clamped}%` }}`.

**Verify**: `pnpm exec tsc --noEmit` → 0.

### Step 4: Migrate `appearance-popover.tsx`

- Delete the local `Segment` and `ToggleRow`; import `Segmented` and `Switch`.
  `Segment<ViewLayout>` call sites become
  `<Segmented options={...} value={layout} onChange={setLayout} optionClassName="px-3 py-1.5" />`
  (icons pass through unchanged). `ToggleRow` becomes a small local wrapper
  around `<Switch size="sm">` keeping its `{label, checked, onCheckedChange}`
  signature, or inline `<Switch>` rows — executor's choice, but the label
  styling becomes `text-sm text-text-secondary`.
- Popover.Content: `bg-[#1a1a1f] border-white/10 shadow-2xl` →
  `bg-bg-elevated border-border` (radius class can stay — 034 squared it).
- `SelectRow`: replace `bg-white/5 border-white/10` → `bg-bg-tertiary
  border-border`, `hover:bg-white/10` → `hover:bg-bg-hover`, and the
  `<option className="bg-[#232328]">` → `bg-bg-elevated` (option styling is
  best-effort across browsers; acceptable).
- Trigger button `hover:bg-white/5` → `hover:bg-bg-hover`.

**Verify**: `grep -c "white/1\|white/5\|#1a1a1f\|#232328" components/projects/appearance-popover.tsx` → 0;
`pnpm test` → 0 failed.

### Step 5: Migrate the two settings switches + uploads progress

- `project-settings-dialog.tsx` and `app/(dashboard)/projects/[id]/settings/page.tsx`:
  replace each styled `Switch.Root/Switch.Thumb` pair with `<Switch>` from
  `@/components/ui/switch` (keep `checked`/`onCheckedChange` wiring
  identical). Remove the now-unused `@radix-ui/react-switch` imports.
- `uploads-panel.tsx`: replace the inline progress div (lines ~114–120) with
  `<ProgressTrack value={progressValue} accent className="mt-2" />` — red fill
  gives uploads the "live" interrupt the design uses for activity. Keep the
  `Uploading {upload.progress}%` text but set it in
  `font-dot text-[13px] font-bold`.

**Verify**: `grep -rc "Switch.Root" components/projects/project-settings-dialog.tsx "app/(dashboard)/projects/[id]/settings/page.tsx"` → 0 in both;
`pnpm exec tsc --noEmit` → 0.

### Step 6: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke (`pnpm dev`): project grid → "Appearance" popover (segments +
switches, both themes), project settings dialog (switch), an upload in
progress (track).

## Test plan

New files in `components/__tests__/`, modeled on `button.test.tsx`:

- `switch.test.tsx`: renders unchecked (`data-state="unchecked"`); fires click
  → `onCheckedChange` called; `disabled` blocks it.
- `segmented.test.tsx`: renders all options; active option has `data-active`
  (or `aria-pressed="true"`); clicking another option calls `onChange` with
  its value; `accent` active option contains `bg-accent`.
- `progress.test.tsx`: `SegmentedProgress value={50} cells={12}` renders 6
  filled cells; `value=100` renders accent cells; `ProgressTrack value={42}`
  fill has `width: 42%`.
- Verification: `pnpm test` → 0 failed, total ≥ starting count + 8.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed; new switch/segmented/progress tests present and passing
- [ ] `components/ui/switch.tsx`, `segmented.tsx`, `progress.tsx` exist
- [ ] `grep -rn "react-switch" components app | grep -v "components/ui/switch"` → only matches inside `components/ui/switch.tsx`
- [ ] `grep -c "#1a1a1f\|#232328" components/projects/appearance-popover.tsx` → 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- 034 not landed (`grep -c "D71921" app/globals.css` → 0) — `font-dot`,
  `border-strong`, `ease-spring` classes would silently no-op.
- `appearance-popover.tsx` no longer contains the local `Segment`/`ToggleRow`
  (someone migrated it already — reconcile instead of duplicating).
- The view-store API (`useViewStore`) doesn't match the popover's current
  usage (drift in state shape).
- Radix Switch's `data-state` attributes don't drive styling as specified
  (version mismatch) — report rather than hand-rolling a non-Radix switch.

## Maintenance notes

- Future quality/view pickers should use `Segmented` (the video player's
  quality picker and time-format picker are candidates — deliberately deferred
  to keep plan 039 typographic-only).
- `SegmentedProgress` is the design's showcase bar; adopt it for transcode
  progress or storage quotas when those UIs appear (`asset-metadata.tsx`
  processing state is a candidate).
- If a future plan adds a Select primitive, replace `SelectRow` in the
  appearance popover — its native `<option>` styling is the one place this
  plan leaves imperfect.
- Reviewer scrutiny: the popover is used on the project page toolbar — check
  it in **light theme** specifically; the old hardcoded `white/*` classes were
  invisible there, so any leftover will show as a regression.
