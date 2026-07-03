# Plan 037: Restyle the app chrome — header wordmark, mono breadcrumbs, theme toggle, drawer shells

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 39bdfc6..HEAD -- apps/web/components/layout/header.tsx apps/web/components/layout/notification-drawer.tsx apps/web/components/layout/uploads-panel.tsx apps/web/components/layout/command-palette.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Known, expected drift (reconciled 2026-07-03):** plan 051 appended
> `pointer-coarse:opacity-100` to the upload-row hover-reveal class in
> `uploads-panel.tsx` (~line 149 — row actions, not the shell/header this
> plan restyles). Structural only; NOT a STOP. Preserve that token.
>
> **Known, expected drift (reconciled 2026-07-03, run 2 — plan 055):** the
> notifications and uploads shells are NO LONGER full-height drawers. Plan
> 055 converted both outer containers to compact anchored popovers:
> `fixed right-2 top-12 z-50 w-[380px] max-w-[calc(100vw-1rem)]
> max-h-[min(70dvh,560px)] rounded-xl border border-border … shadow-2xl flex
> flex-col overflow-hidden animate-in fade-in-0 zoom-in-95
> slide-in-from-top-1 duration-150` (uploads keeps `bg-bg-secondary`,
> notifications `bg-bg-primary`); the notification empty state is now
> `min-h-[260px] py-8` instead of `h-full`. NOT a STOP. Step 5 ("Drawer +
> palette shells") applies its token treatment to these **popover** shells:
> swap color/border/shadow tokens only, and **preserve the
> anchoring/size/overflow classes** (`right-2 top-12`, `max-w-*`,
> `max-h-[min(70dvh,560px)]`, `overflow-hidden`, entry animation). The
> `shadow-2xl` is still present for Step 5's shadow-removal grep to clear.
> Radius: 034 remaps the scale globally — restyling `rounded-xl` → `rounded`
> per the design is fine.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (header is on every dashboard screen; plan 025/027 recently reworked it)
- **Depends on**: plans/034-design-tokens-foundation.md, plans/035-primitive-components-restyle.md
- **Category**: direction (design-system implementation)
- **Planned at**: commit `39bdfc6`, 2026-07-02

## Why this matters

The chrome is the design system's identity carrier: a red brand dot + mono
`freeframed` wordmark, mono-uppercase letterspaced nav labels with a red pip on
the active item, and an inline mechanical theme toggle. The app's header
(rebuilt in plans 025/027 as the sole global nav) still speaks the old
language: PNG logo, sans breadcrumbs, and — since 025 removed the sidebar —
**no theme toggle anywhere except the Settings page**. This plan restyles
`header.tsx` and the shells of the three chrome panels (notifications drawer,
uploads panel, command palette) and adds the design's theme switch to the
header.

## Design spec (inline reference)

From the design's chrome component:

- Brand: `<span 8px red dot /> <span "freeframed" font-mono 15px bold tracking-[-0.01em] />`.
- Nav/breadcrumb items: `font-mono text-[11px] uppercase tracking-[0.12em]`,
  inactive `text-text-tertiary hover:text-text-primary hover:bg-bg-hover`,
  active `text-text-primary` + red pip `h-[5px] w-[5px] rounded-full bg-accent`.
- Bar: sticky, `border-b border-border`, translucent bg + blur
  (`bg-bg-primary/[0.86] backdrop-blur`), ~11px vertical padding.
- Theme toggle: bordered mono button `h-[34px] rounded bg-bg-tertiary border
  border-border hover:border-border-strong px-3 font-mono text-[11px]
  uppercase tracking-[0.12em]` containing a mini track (26×14, knob 10px,
  knob turns red + slides when light) and the label `Dark`/`Light` (label
  hidden below `sm`).
- Panels/dropdowns: flat `bg-bg-elevated border border-border rounded` — no
  shadow (034 killed shadows globally; borders do the lifting).
- Red = sole interrupt: notification unread count stays red; **upload activity
  count is not an interrupt** → monochrome inversion.

## Current state

All excerpts at commit `39bdfc6`.

- `apps/web/components/layout/header.tsx` — post-025 header (breadcrumbs +
  actions). Key regions:
  - Brand (lines ~90–114): custom org logo `<img>` if `useBrandingStore` has
    one, else two PNGs `/logo-icon.png` / `/logo-icon-dark.png` with
    `logo-dark`/`logo-light` visibility classes.
  - Breadcrumbs (lines ~116–139): `text-[13px]`, last crumb
    `font-medium text-text-primary`, links `text-text-tertiary`, separator
    `<ChevronRight className="h-3 w-3" />`.
  - Bell button unread badge (line ~157): `rounded-full bg-status-error ...
    text-[9px] font-bold text-white`.
  - Uploads button count badge (line ~176): `bg-accent ... text-white`.
  - Search trigger (lines ~183–192): `rounded-md border border-border
    bg-bg-secondary/60 px-2.5 py-1 text-xs`, `<kbd>` with `font-mono
    text-[10px]`.
  - User dropdown content (line ~214): `rounded-lg border border-border
    bg-bg-elevated p-1 shadow-xl animate-slide-up`; logout item
    `text-status-error hover:bg-status-error/10`.
  - Imports already include `useThemeStore` (used for logo selection):
    `const { theme } = useThemeStore()`.
- `stores/theme-store.ts` — `useThemeStore` exposes `theme: 'dark'|'light'|'system'`
  and `setTheme(theme)` (applies to DOM + persists + saves to server). Resolve
  display state with the same trick the store uses: treat `system` as the
  `matchMedia('(prefers-color-scheme: dark)')` result.
- `components/layout/notification-drawer.tsx` (7.4K) — compact anchored
  popover under the header bell (drawer → popover by plan 055; see the
  known-drift note above).
- `components/layout/uploads-panel.tsx` (13.9K) — compact anchored popover
  (plan 055); header row at ~line 247 (`flex items-center justify-between
  px-4 h-12 border-b`) unchanged.
- `components/layout/command-palette.tsx` (14.5K) — ⌘K dialog.
- Test baseline: `pnpm test` → 136 passed (136) at `39bdfc6` (more after
  035/036 — record your starting number). No test asserts header classes.

## Commands you will need

| Purpose   | Command (run in `apps/web/`) | Expected on success |
|-----------|------------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit`     | exit 0              |
| Tests     | `pnpm test`                  | 0 failed            |
| Lint      | `pnpm lint`                  | exit 0              |

## Scope

**In scope**:
- `apps/web/components/layout/header.tsx`
- `apps/web/components/layout/notification-drawer.tsx` (shell classes only)
- `apps/web/components/layout/uploads-panel.tsx` (shell/header classes only —
  the progress bar inside is plan 036's)
- `apps/web/components/layout/command-palette.tsx` (container classes only)

**Out of scope** (do NOT touch):
- `app/(dashboard)/layout.tsx` — the shell logic (isAssetViewer header-hiding
  from 025) must not change.
- `stores/theme-store.ts` — consume it, don't modify it.
- `public/logo-*.png` — keep the files; the header just stops using the
  default ones. Auth screens (plan 040) and share viewer (plan 039) handle
  their own branding.
- Breadcrumb *logic* (`buildBreadcrumbs`, SKIP_SEGMENTS, uuid handling) — only
  presentation classes change.
- Drawer/palette inner content rows — token classes inherited from 034 are
  enough; only shells/headers here.

## Git workflow

- Branch: `advisor/037-chrome-header`
- Conventional commits, e.g. `feat(web): restyle header chrome with wordmark and theme toggle`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Brand wordmark

In `header.tsx`, replace the default-logo `<img>` pair (keep the custom
`customLogo` branch — self-hosted orgs override branding) with:

```tsx
<span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-hidden />
<span className="font-mono text-[15px] font-bold tracking-[-0.01em] text-text-primary">
  freeframed
</span>
```

**Verify**: `grep -c "logo-icon.png" components/layout/header.tsx` → 0;
`grep -c "customLogo" components/layout/header.tsx` → ≥2 (branch kept).

### Step 2: Mono breadcrumbs with active pip

Restyle the breadcrumb `<nav>`: items get `font-mono text-[11px] uppercase
tracking-[0.12em]`; non-last crumbs `text-text-tertiary
hover:text-text-primary`; last crumb `text-text-primary` prefixed with
`<span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />`
(inline-flex + gap-1.5). Replace `ChevronRight` separator with a mono slash:
`<span className="text-text-tertiary/60 font-mono text-[10px]">/</span>`
(drop the `ChevronRight` import if now unused). Long Vietnamese project names:
add `truncate max-w-[180px]` on crumb labels.

**Verify**: visual check in dev; `pnpm exec tsc --noEmit` → 0.

### Step 3: Theme toggle button

Add a button between the search trigger and the user dropdown, per the Design
spec's themebtn. Wire-up:

```tsx
const { theme, setTheme } = useThemeStore()
const isLight = (theme === 'system'
  ? typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches
  : theme === 'light')
// onClick: setTheme(isLight ? 'dark' : 'light')
```

Render: bordered button (spec classes above) containing a 26×14 rounded-full
track (`bg-bg-primary border border-border-strong`) with a 10px knob
(`bg-text-secondary`, when light: `translate-x-3 bg-accent`,
`transition-transform duration-200 ease-spring`) and label
`{isLight ? 'Light' : 'Dark'}` in `hidden sm:inline`. `aria-label="Toggle
color theme"`. Guard the `matchMedia` read for SSR (compute in a
`useEffect`/state or check `typeof window` — header is a client component).

**Verify**: in dev, clicking flips `document.documentElement.dataset.theme`
between `dark`/`light` and persists across reload (theme-store handles both).

### Step 4: Action buttons, badges, search, dropdown

- Bell unread badge: `bg-status-error` → `bg-accent` (same red, correct token).
- Uploads count badge: `bg-accent` → `bg-text-primary text-bg-primary`
  (activity is not an interrupt; red belongs to notifications only).
- Both count badges: add `font-dot` (dot-matrix numerals), keep size.
- Search trigger: `text-xs` → `font-mono text-[11px] uppercase
  tracking-[0.12em]`; `hover:border-border-focus` → `hover:border-border-strong`;
  kbd stays mono.
- User dropdown content: `rounded-lg ... shadow-xl` → `rounded border
  border-border bg-bg-elevated p-1` (shadow class is dead anyway — remove it);
  logout item `text-status-error hover:bg-status-error/10` →
  `text-accent hover:bg-accent-muted`.
- Pass `accent` to the user `<Avatar>` (current user marker, prop added in 035).

**Verify**: `grep -c "status-error" components/layout/header.tsx` → 0.

### Step 5: Drawer + palette shells

- `notification-drawer.tsx`: container → `border border-border bg-bg-secondary
  rounded` (top-level panel only); its header/title row → `font-mono text-[11px]
  uppercase tracking-[0.16em] text-text-tertiary`; remove any `shadow-*`
  classes.
- `uploads-panel.tsx`: same treatment for the container + the `h-12 border-b`
  header row title. Do not touch the row internals (036 owns the progress bar).
- `command-palette.tsx`: dialog container → `bg-bg-elevated border
  border-border rounded`; remove `shadow-*`; group headings (if any) →
  mono-uppercase treatment.

**Verify**: `grep -c "shadow-xl\|shadow-2xl" components/layout/header.tsx components/layout/notification-drawer.tsx components/layout/uploads-panel.tsx components/layout/command-palette.tsx` → 0 total.

### Step 6: Full gate

```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```

Visual smoke (`pnpm dev`): wordmark + red dot render; breadcrumbs mono with
pip on the last crumb; theme toggle flips and persists; bell badge red,
uploads badge mono; drawers/palette flat with hairline borders; check both
themes and a `<sm` viewport (toggle label hides, breadcrumbs truncate).

## Test plan

- New: `components/__tests__/header-theme-toggle.test.tsx` — render `Header`
  with mocked stores (follow the store-mocking pattern used in
  `components/projects/__tests__/asset-grid.test.tsx`), assert the toggle
  button exists with `aria-label="Toggle color theme"` and that clicking calls
  `setTheme` with `'light'` when theme is `'dark'`. If mocking all six header
  stores proves brittle, a focused extraction test is acceptable — but do not
  skip the click assertion.
- Existing suite: `pnpm test` → 0 failed.

## Done criteria

Machine-checkable. ALL must hold (run in `apps/web/`):

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` → 0 failed; theme-toggle test added and passing
- [ ] `grep -c "freeframed" components/layout/header.tsx` → ≥1
- [ ] `grep -c "logo-icon" components/layout/header.tsx` → 0
- [ ] `grep -c "Toggle color theme" components/layout/header.tsx` → 1
- [ ] `grep -rc "shadow-xl\|shadow-2xl" components/layout/*.tsx` → 0 per file
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- 034/035 not landed (`grep -c "D71921" app/globals.css` → 0, or Button has no
  `solid` variant) — this plan's classes depend on them.
- `header.tsx` no longer matches the Current state excerpts (another shell
  rework landed — the header has churned in plans 025/027/029; reconcile
  first).
- The theme toggle cannot read a resolved theme without hydration mismatch
  warnings in dev — report the warning rather than suppressing it.
- Branding-store custom logo turns out to be used in more places than the one
  `customLogo` branch (grep `orgLogo` before deleting anything).

## Maintenance notes

- The wordmark is now text — orgs that want a graphic keep using Settings →
  Branding (that path is untouched). If the maintainer wants the default PNGs
  gone from `public/`, do it separately after confirming the auth screens
  (plan 040) and share viewer (plan 039) no longer reference them.
- Uploads badge is deliberately monochrome; if users miss upload activity,
  consider the design's blinking-dot treatment (`animate-blink`) before
  reaching for red.
- The theme toggle writes `'light'`/`'dark'` and therefore drops `'system'`
  once clicked — same behavior as the Settings page today; if `system` must be
  reachable from the header later, make the toggle a three-state cycle.
- Reviewer scrutiny: header height/density — mono uppercase runs wider than
  sans; verify no wrap at 360px width with a long Vietnamese breadcrumb.
