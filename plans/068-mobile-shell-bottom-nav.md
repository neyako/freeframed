# Plan 068: Mobile shell foundation — bottom tab nav + responsive dashboard shell

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. If a STOP condition occurs,
> stop and report — do not improvise. A reviewer maintains `plans/README.md`;
> do not edit it.
>
> **Drift check (run first)**:
> `git diff --stat a7d1e10..HEAD -- "apps/web/app/(dashboard)/layout.tsx" apps/web/components/layout/header.tsx`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (adds a component + responsive classes; no data/logic changes)
- **Depends on**: soft — round-8 branch `advisor/059-app-chrome-conformance` restyled
  the header. If merged, re-verify the header excerpt in the drift check.
- **Category**: mobile / design-conformance (foundation)
- **Planned at**: commit `a7d1e10`, 2026-07-04
- **Enables**: plans 069–072 (per-screen mobile: Projects, Library, Review, Settings)
  build on this bottom nav + shell. Do those AFTER this lands.

## Why this matters

`app-mobile.dc.html` specifies four mobile screens (Projects, Library, Review,
Settings) that all share a **bottom tab bar** — Projects / Search / Uploads /
Profile — which the app doesn't have yet. This plan adds that shared bottom nav
and mounts it in the dashboard shell (mobile only; hidden on desktop and on the
full-screen asset-review page). It's the foundation the per-screen mobile plans
depend on, so it lands first.

## Current state

### `apps/web/app/(dashboard)/layout.tsx` (full file)
```tsx
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = React.useState(false);
  const { fetchUser } = useAuthStore();
  const { fetchHistory } = useUploadStore();
  const isAssetViewer = /\/projects\/[^/]+\/assets\/[^/]+/.test(pathname);
  ...
  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <main className="flex flex-1 flex-col overflow-hidden">
        {!isAssetViewer && <Header onSearchOpen={() => setCommandOpen(true)} />}
        <div className="relative flex-1 overflow-y-auto">{children}</div>
      </main>
      <UploadsPanel />
      <UploadSSEBridge />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
```

### Upload panel open mechanism
`useUploadStore()` exposes `togglePanel` and `panelOpen` (used by the header's
uploads button). The mobile nav's Uploads tab calls `togglePanel()`.

### Spec — bottom nav (from `app-mobile.dc.html`, identical on every screen)
```
nav: flex; align-items:center; justify-content:space-around;
     padding:10px 8px 14px; border-top:1px solid var(--border-primary);
     background:color-mix(in srgb,var(--bg-primary) 92%,transparent)
tab: flex-direction:column; align-items:center; gap:5px; padding:4px 14px;
     icon 21px; label font-mono 9px uppercase letter-spacing 0.08em
     active  → color var(--accent)
     inactive→ color var(--text-tertiary)
tabs (in order): Projects · Search · Uploads · Profile
```
The Review screen in the spec has **no** bottom nav (full-screen review).

### Repo conventions
- Tailwind tokens only (`text-accent`, `text-text-tertiary`, `border-border`,
  `bg-bg-primary`, `font-mono`). `bg-bg-primary/90` is valid (alpha tokens from
  plan 057). Icons from `lucide-react`.
- Client components start with `'use client'`. Match the existing layout files'
  import + style conventions.
- Responsive: desktop styles are default; mobile is the base and desktop hides
  the nav with `lg:hidden`.

## Commands you will need

| Purpose   | Command (in `apps/web/`) | Expected |
|-----------|--------------------------|----------|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0   |
| Tests     | `pnpm test`              | all pass |
| Build     | `pnpm build`             | exit 0   |

## Scope

**In scope**:
- NEW `apps/web/components/layout/mobile-nav.tsx`
- `apps/web/app/(dashboard)/layout.tsx` (mount the nav)
- `apps/web/components/layout/header.tsx` (hide the mobile-duplicated action
  cluster on small screens — Step 3, minimal)

**Out of scope** (do NOT touch):
- The per-screen content (Projects/Library/Review/Settings pages) — plans 069–072.
- `command-palette.tsx`, `uploads-panel.tsx` internals — reuse, don't edit.
- Desktop layout behavior — must be visually unchanged at `lg` and up.

## Git workflow

- Branch: `advisor/068-mobile-shell-bottom-nav`
- Commit: `feat(web): mobile bottom tab nav + responsive dashboard shell (plan 068)`
- Do NOT push or merge — the maintainer merges.

## Steps

### Step 1: Create `mobile-nav.tsx`

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderOpen, Search, Upload, User } from 'lucide-react'
import { useUploadStore } from '@/stores/upload-store'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  onSearchOpen: () => void
}

export function MobileNav({ onSearchOpen }: MobileNavProps) {
  const pathname = usePathname()
  const { togglePanel } = useUploadStore()

  const tab =
    'flex flex-col items-center gap-1.5 px-3.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition-colors'
  const active = 'text-accent'
  const inactive = 'text-text-tertiary hover:text-text-secondary'

  const projectsActive = pathname.startsWith('/projects')
  const profileActive = pathname.startsWith('/settings')

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border bg-bg-primary/90 px-2 pt-2.5 pb-3.5 lg:hidden">
      <Link href="/projects" className={cn(tab, projectsActive ? active : inactive)}>
        <FolderOpen className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Projects
      </Link>
      <button type="button" onClick={onSearchOpen} className={cn(tab, inactive)}>
        <Search className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Search
      </button>
      <button type="button" onClick={togglePanel} className={cn(tab, inactive)}>
        <Upload className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Uploads
      </button>
      <Link href="/settings/profile" className={cn(tab, profileActive ? active : inactive)}>
        <User className="h-[21px] w-[21px]" strokeWidth={1.8} />
        Profile
      </Link>
    </nav>
  )
}
```

**Verify**: `pnpm exec tsc --noEmit` → 0 (the new file typechecks). If
`togglePanel` is not exported by the upload store, `grep -n "togglePanel" apps/web/stores/upload-store.ts`
to confirm the exact name and use it; if it doesn't exist, STOP and report.

### Step 2: Mount the nav in the dashboard shell

In `apps/web/app/(dashboard)/layout.tsx`:
- Import `MobileNav`.
- Render it inside `<main>`, **after** the content `<div>`, hidden on the asset
  viewer (same condition as the header):
```tsx
        <div className="relative flex-1 overflow-y-auto">{children}</div>
        {!isAssetViewer && <MobileNav onSearchOpen={() => setCommandOpen(true)} />}
      </main>
```
Because the nav is a flow child (`shrink-0`) below the `flex-1 overflow-y-auto`
content, no extra bottom padding is needed — content scrolls above it.

**Verify**: `grep -c "MobileNav" "apps/web/app/(dashboard)/layout.tsx"` → `2`
(import + usage)

### Step 3: Header — hide the mobile-duplicated actions

On mobile the bottom nav covers Search + Uploads, so hide those two header
controls below `sm` to avoid duplication. In `apps/web/components/layout/header.tsx`,
add `hidden sm:flex` (or `hidden sm:inline-flex`, matching each element's display)
to the **notifications bell**, **uploads button**, and **search trigger** wrappers
so they only show at `sm` and up. Keep the brand wordmark, theme toggle, and
avatar visible at all sizes. Do NOT change any handler or the desktop appearance.

**Verify**: header still renders the wordmark + avatar at all widths; the bell,
uploads, and search gain a `hidden sm:` prefix. `pnpm build` → exit 0.

### Step 4: Gate

**Verify** in `apps/web/`: `pnpm exec tsc --noEmit` → 0; `pnpm test` → all pass;
`pnpm build` → exit 0.

## Test plan

Add `apps/web/components/layout/__tests__/mobile-nav.test.tsx` following an
existing component test's style (render with a router/store mock as needed):
assert the four tab labels render (Projects, Search, Uploads, Profile) and that
clicking Search calls the `onSearchOpen` prop. If mocking `usePathname` /
`useUploadStore` is heavy, keep the test to rendering + the `onSearchOpen` click
(don't over-build mocks). If a header test asserts the bell/uploads/search are
always visible, update it for the new `hidden sm:` behavior.

## Done criteria

- [ ] `pnpm exec tsc --noEmit` exits 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] NEW `apps/web/components/layout/mobile-nav.tsx` exists and exports `MobileNav`
- [ ] `grep -c "MobileNav" "apps/web/app/(dashboard)/layout.tsx"` → `2`
- [ ] `grep -c "lg:hidden" apps/web/components/layout/mobile-nav.tsx` → `1`
- [ ] Desktop (`lg`+) shows no bottom nav; the review page shows no bottom nav
- [ ] Only in-scope files modified (`git status`)

## STOP conditions

- `togglePanel` isn't the upload store's panel-open action (name differs) — grep
  and use the real one; if none exists, STOP.
- Mounting the nav shifts or clips desktop content (it must be `lg:hidden`) — STOP
  and report.
- The header's action elements can't take a `hidden sm:` class without breaking
  layout (e.g. they're in a shared flex that collapses) — STOP rather than
  restructuring the header (that's 059's territory).

## Maintenance notes

- Per-screen mobile plans (069 Projects, 070 Library, 071 Review, 072 Settings)
  adapt each screen's content/app-bar to the spec on top of this shell. They must
  reuse this `MobileNav`, not fork it.
- The Review screen intentionally has no bottom nav (full-screen); the
  `isAssetViewer` guard already handles that.
- If a fifth destination is ever needed, prefer a "More" tab over crowding four.
