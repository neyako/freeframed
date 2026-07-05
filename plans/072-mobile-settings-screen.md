# Plan 072: Mobile Settings screen — horizontal section chips

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Independent of the round-8/9 merge** — round 8 did not touch settings, so this
> executes cleanly on current `main`/HEAD or the merged branch. Builds on plan
> 068's `MobileNav` only in that the bottom nav shows on mobile settings pages.
>
> **Drift check (run first)**:
> `grep -c 'className="w-56 border-r border-border bg-bg-secondary shrink-0"' apps/web/app/(dashboard)/settings/layout.tsx`
> must be `1`. If 0, the settings layout changed — compare against "Current state"
> before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 068 (bottom nav) merged — soft (only affects how it looks with the nav)
- **Category**: mobile / design-conformance
- **Planned at**: written 2026-07-05

## Why this matters

`app-mobile.dc.html` screen 1d (Settings) specifies mobile settings navigation as
a **horizontal, scrollable row of section chips** (Profile / Appearance /
Notifications / Branding / Admin) at the top of the content, not a side rail. The
current settings layout renders a fixed `w-56` sidebar at all widths, which is
cramped on a 460px phone. This plan hides the sidebar on mobile and adds the chip
row; desktop is unchanged.

## Current state

`apps/web/app/(dashboard)/settings/layout.tsx` (full file is short). The nav model:
```tsx
const settingsNavItems: SettingsNavItem[] = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings/appearance', label: 'Appearance', icon: Palette },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/branding', label: 'Branding', icon: Brush, adminOnly: true },
  { href: '/settings/admin', label: 'Admin', icon: Shield, adminOnly: true },
]
```
Layout:
```tsx
return (
  <div className="flex h-full">
    <aside className="w-56 border-r border-border bg-bg-secondary shrink-0">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
        <p className="text-xs text-text-tertiary mt-0.5">{user?.name ?? 'User'}</p>
      </div>
      <nav className="p-2 space-y-0.5">
        {settingsNavItems.map((item) => { /* adminOnly filter; active = pathname match; Link with icon + label */ })}
      </nav>
    </aside>
    <main className="flex-1 overflow-y-auto">{children}</main>
  </div>
)
```
`isActive = pathname === item.href || pathname?.startsWith(item.href + '/')`.
`isSuperAdmin` from `useAuthStore` gates the `adminOnly` items.

### Mobile spec (screen 1d)
- No side rail on mobile. Instead: a horizontal-scroll chip row under the app bar:
  each section as a mono 11px pill, `rounded-md px-3 py-2`; active = `text-primary`
  + `bg-bg-hover` + `border-border`; inactive = `text-tertiary`, transparent
  border; row scrolls with hidden scrollbar; bottom hairline.

### Repo conventions
- Mobile-first responsive; desktop keeps the sidebar (`hidden lg:block`), mobile
  gets the chip row (`lg:hidden`). Tailwind tokens only. Reuse `settingsNavItems`
  and the same `adminOnly` / active logic — do NOT duplicate the model.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**: `apps/web/app/(dashboard)/settings/layout.tsx` only.

**Out of scope**: the individual settings pages (profile/appearance/etc.), the
auth store, `mobile-nav.tsx`. Reuse `settingsNavItems`; don't change routes.

## Git workflow

- Branch: `advisor/072-mobile-settings-screen`
- Commit: `feat(web): mobile Settings section chips (plan 072)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Sidebar desktop-only

Change the `<aside>` to hide on mobile: `className="w-56 border-r border-border bg-bg-secondary shrink-0"`
→ `className="hidden lg:block w-56 border-r border-border bg-bg-secondary shrink-0"`.
Also change the outer wrapper `<div className="flex h-full">` →
`<div className="flex h-full flex-col lg:flex-row">` so the mobile chip row can
stack above the content.

**Verify**: `grep -c "hidden lg:block w-56" apps/web/app/(dashboard)/settings/layout.tsx` → `1`

### Step 2: Mobile chip row

Add a `lg:hidden` horizontal chip nav as the first child of the outer div (above
`<main>`), reusing `settingsNavItems` + the `adminOnly`/active logic:

```tsx
<nav className="lg:hidden flex gap-2 overflow-x-auto border-b border-border px-4 py-3 [scrollbar-width:none]">
  {settingsNavItems.map((item) => {
    if (item.adminOnly && !isSuperAdmin) return null
    const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'shrink-0 inline-flex items-center rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.05em] transition-colors',
          isActive
            ? 'text-text-primary bg-bg-hover border border-border'
            : 'text-text-tertiary border border-transparent hover:text-text-secondary',
        )}
      >
        {item.label}
      </Link>
    )
  })}
</nav>
```
`cn`, `Link`, `usePathname`, `settingsNavItems`, `isSuperAdmin` are all already in
the file.

**Verify**: `grep -c "lg:hidden flex gap-2 overflow-x-auto border-b" apps/web/app/(dashboard)/settings/layout.tsx` → `1`

### Step 3: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

No new test required. If a settings-layout test asserts the sidebar is always
visible, update it for the new `hidden lg:block` behavior. Otherwise the gate
covers it.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] `grep -c "hidden lg:block w-56" apps/web/app/(dashboard)/settings/layout.tsx` → `1`
- [ ] `grep -c "lg:hidden flex gap-2 overflow-x-auto border-b" apps/web/app/(dashboard)/settings/layout.tsx` → `1`
- [ ] Desktop (`lg`+) unchanged — sidebar shows, chip row hidden
- [ ] Only `settings/layout.tsx` modified (`git status`)

## STOP conditions

- The `<aside>` class string doesn't match (drift) — re-read and adapt.
- `settingsNavItems` / `isSuperAdmin` / `pathname` are named differently — use the
  real names; if the model was refactored away, STOP and report.

## Maintenance notes

- The chip row and the desktop sidebar share `settingsNavItems` — add new sections
  there once and both pick them up.
- The mobile Settings spec also shows a Storage block under the Profile section;
  that lives in the profile page content, not this layout — a follow-up can add it
  if wanted.
