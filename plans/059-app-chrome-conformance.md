# Plan 059: Conform the global header to the app-chrome design spec

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f7fd883..HEAD -- apps/web/components/layout/header.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none hard. Soft: plans 057/058 (branch `advisor/058-share-popup-redesign`) should be merged first so `/NN` opacity classes compile; this plan avoids new `/NN` classes so it works either way.
- **Category**: design-conformance
- **Planned at**: commit `f7fd883`, 2026-07-04

## Why this matters

The maintainer's design project ("FreeFrame Design System", Claude Design) gained
screen-level specs on 2026-07-03. `app-chrome.dc.html` specifies the global header:
a 34px control row on a ~56–62px bar, mono-uppercase breadcrumb with the *section*
in tertiary and the *current page* in primary with a red dot, and icon buttons that
gain a hairline border on hover instead of a background fill. The current header
(rethemed by plan 037) is close in spirit but off in scale (44px bar, 28px icon
buttons), hover treatment (background fills), and breadcrumb color hierarchy.
This plan closes those gaps so the shell matches the spec on every page.

## Current state

- `apps/web/components/layout/header.tsx` — the only file in scope. Sticky
  header rendered by `app/(dashboard)/layout.tsx`. Contains: brand wordmark,
  breadcrumb nav, notifications bell, uploads button, search trigger, theme
  toggle, avatar dropdown.

Key excerpts as of `f7fd883`:

Header container (line 104):
```tsx
<header className="sticky top-0 z-20 flex h-11 items-center justify-between border-b border-border bg-bg-primary/90 backdrop-blur-sm px-4">
```

Breadcrumb nav (lines 125–151) — every crumb currently same treatment; last
crumb has the red dot:
```tsx
<nav className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] min-w-0">
  ...
  {isLast ? (
    <span className="inline-flex items-center gap-1.5 text-text-primary min-w-0">
      <span className="h-[5px] w-[5px] rounded-full bg-accent shrink-0" aria-hidden />
      <span className="truncate max-w-[180px]">{crumb.label}</span>
    </span>
  ) : crumb.href ? (
    <Link href={crumb.href} className="text-text-tertiary hover:text-text-primary transition-colors truncate max-w-[180px]">
```

Notifications bell (lines 157–167; uploads button 176–186 is identical in shape):
```tsx
<button
  onClick={() => setNotifOpen((v) => !v)}
  className={cn(
    'relative flex h-7 w-7 items-center justify-center rounded-md transition-colors',
    notifOpen
      ? 'bg-bg-hover text-text-primary'
      : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
  )}
  title="Notifications"
>
  <Bell className="h-4 w-4" strokeWidth={notifOpen ? 2 : 1.5} />
```

Search trigger (lines 195–204):
```tsx
<button
  onClick={onSearchOpen}
  className="flex items-center gap-1.5 rounded border border-border bg-bg-secondary/60 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:border-border-strong hover:text-text-primary transition-colors"
>
  <Search className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">Search</span>
  <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-bg-tertiary/50 px-1 py-0.5 font-mono text-[10px] text-text-tertiary">
    <span>⌘</span>K
  </kbd>
</button>
```

Theme toggle (lines 206–221) — already spec-conformant (34px, mono, track+knob).
Avatar (lines 224–236) — already spec-conformant (`accent` red avatar).

### Design spec (inlined from `app-chrome.dc.html` + `freeframe.css` — the executor does not need design-project access)

- Chrome bar: 34px controls with 11px vertical padding (≈56px total),
  `background: color-mix(bg-primary 86%, transparent)` + blur, hairline bottom
  border. Controls gap 8px.
- Breadcrumb: `font-mono 11px uppercase tracking 0.18em`. Section (e.g.
  "Projects") in `--text-tertiary`; `/` separator in tertiary; current page in
  `--text-primary` prefixed by a 6px red dot. Only shown when a page exists.
- Icon buttons (bell, uploads): **34×34px**, `border: 1px solid transparent`,
  color `--text-secondary`; hover: `color: --text-primary; border-color:
  --border-primary`. No background fill on hover.
- Search button: 34px tall, `background: --bg-tertiary; border: 1px solid
  --border-primary`, mono 11px uppercase tracking 0.14em `--text-tertiary`;
  hover `border-color: --border-strong; color: --text-secondary`. Kbd chip:
  `border: 1px solid --border-strong; radius 2px; padding 1px 5px; 10px`.
- The spec shows no unread-count badges; the app's badges are functional —
  **keep them**, restyled positions unchanged.

### Repo conventions

- Design tokens are Tailwind utilities from `apps/web/tailwind.config.ts`:
  `bg-bg-primary/tertiary`, `border-border` (= `--border-primary`),
  `border-border-strong`, `text-text-{primary,secondary,tertiary}`,
  `bg-accent`, `font-mono`, `font-dot`. Use these — never hex literals.
- Exemplar of the 34px mono control: the theme-toggle button in this same file
  (lines 206–221).

## Commands you will need

Run all in `apps/web/`:

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, no errors   |
| Tests     | `pnpm test`              | all pass            |
| Build     | `pnpm build`             | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `apps/web/components/layout/header.tsx`
- `apps/web/components/layout/__tests__/` — update existing header tests only if
  an assertion on a changed class string fails.

**Out of scope** (do NOT touch):
- `app/(dashboard)/layout.tsx` — shell logic owned by plan 025.
- `notification-drawer.tsx`, `uploads-panel.tsx` — popover shells owned by 055/037.
- `command-palette.tsx` — palette internals unchanged.
- The breadcrumb *logic* (`buildBreadcrumbs`, `SKIP_SEGMENTS`, stores) — class
  strings only.

## Git workflow

- Branch: `advisor/059-app-chrome-conformance`
- Commit style: `fix(web): header conforms to app-chrome spec (plan 059)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Bar scale

In the `<header>` element change `h-11` → `h-14` and `px-4` → `px-4 sm:px-6`.
Keep `bg-bg-primary/90 backdrop-blur-sm` (equivalent of the spec's color-mix;
requires 057's alpha tokens which are already authored — if `/90` renders
opaque, that's 057's territory, not yours).

**Verify**: `grep -c "h-14" components/layout/header.tsx` → `1`

### Step 2: Breadcrumb hierarchy

In the breadcrumb `<nav>`:
- change `tracking-[0.12em]` → `tracking-[0.18em]`
- non-last crumbs stay `text-text-tertiary` (already correct)
- last-crumb red dot: `h-[5px] w-[5px]` → `h-1.5 w-1.5` (6px per spec)
- separator: keep.

**Verify**: `grep -c "tracking-\[0.18em\]" components/layout/header.tsx` → `1`

### Step 3: Icon buttons (bell + uploads)

Replace both buttons' class logic with the spec treatment — 34px, transparent
border → hairline on hover/active, no bg fill. Target shape (bell shown; apply
the same to uploads with its own state var):

```tsx
className={cn(
  'relative flex h-[34px] w-[34px] items-center justify-center rounded border transition-colors',
  notifOpen
    ? 'border-border text-text-primary'
    : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
)}
```

Keep icons `h-4 w-4`, keep the `strokeWidth` toggle, keep both count badges
exactly as they are.

**Verify**: `grep -c "hover:bg-bg-hover" components/layout/header.tsx` → the two
icon buttons no longer match; only the avatar/dropdown items may still use it.
Expected: count drops from 5 (baseline) to ≤3.

### Step 4: Search trigger

Restyle to the spec's 34px tertiary-bg button:

```tsx
className="flex h-[34px] items-center gap-2 rounded border border-border bg-bg-tertiary px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:border-border-strong hover:text-text-secondary transition-colors"
```

Kbd chip: `rounded-[2px] border border-border-strong bg-transparent px-[5px] py-px font-mono text-[10px] tracking-[0.06em] text-text-tertiary` (drop `bg-bg-tertiary/50`, drop the inner `gap-0.5`; render `⌘K` as one string).

**Verify**: `grep -c "bg-bg-secondary/60" components/layout/header.tsx` → `0`

### Step 5: Gate

**Verify**: in `apps/web/`: `pnpm exec tsc --noEmit` → 0 errors; `pnpm test` →
all pass (fix only assertions that reference the exact class strings changed
above); `pnpm build` → exit 0.

## Test plan

No new test file. `components/layout/__tests__/` has header coverage from 037 —
run `pnpm test -- header` and update any class-string assertions that now fail,
keeping the behavioral assertions (badge rendering, toggle handlers) untouched.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "h-\[34px\] w-\[34px\]" components/layout/header.tsx` → `2` (bell + uploads)
- [ ] `grep -c "h-11" components/layout/header.tsx` → `0`
- [ ] `grep -c "bg-bg-secondary/60" components/layout/header.tsx` → `0`
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live file (drift — 037/055 rework landed on top).
- Any header test failure is *behavioral* (handler not firing, badge missing),
  not a class-string assertion.
- You find yourself wanting to edit `app/(dashboard)/layout.tsx` to fix spacing —
  the h-11 → h-14 change must not require it; if it does, STOP.

## Maintenance notes

- Plan 062 (review screen) restyles a *different* top bar (the asset review
  page's own bar) to the same control language; no file overlap.
- If the org-logo branding path (`customLogo`) looks unbalanced at h-14,
  that's acceptable — logos are org-uploaded and win by design (037 decision).
