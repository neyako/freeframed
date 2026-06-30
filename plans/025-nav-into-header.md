# Plan 025: Move global navigation from the left rail into the top header

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4d0c20f..HEAD -- "apps/web/app/(dashboard)/layout.tsx" apps/web/components/layout/header.tsx apps/web/components/layout/sidebar.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Category**: tech-debt / UX
- **Depends on**: none (interacts with plan 021 — see Maintenance notes)
- **Planned at**: commit `4d0c20f`, 2026-06-30

## Why this matters

The app has a permanent left nav rail (52px collapsed) that holds only a logo,
one nav link (Projects), a Notifications button, an Uploads button, and the user
menu. It's a "delicate zone" that eats horizontal space on every page (worst on
mobile and on the immersive viewer) for very few controls. Consolidating those
controls into the existing top header — beside the search bar — removes the rail
entirely and gives the content full width.

This is an app-shell change. It's mechanical (the controls already exist in
`sidebar.tsx`; they move to `header.tsx`) but touches the layout every page
renders through, so follow the steps in order and keep the desktop header
working before worrying about polish.

## Current state

Three files:
- `apps/web/components/layout/sidebar.tsx` — the rail. Contains the logo
  (branding-aware), the `Projects` nav link, a Notifications button that opens
  `<NotificationDrawer>`, an Uploads button that calls `togglePanel()`, and a
  user `DropdownMenu` (Profile / Settings / Log out). **This is the source of the
  controls to move.** (Read the whole file; it's ~275 lines and self-contained.)
- `apps/web/components/layout/header.tsx` — the top bar. Today: breadcrumbs
  (left), search button + a right-panel toggle (right). Takes `onSearchOpen`.
- `apps/web/app/(dashboard)/layout.tsx` — renders `<Sidebar>` + `<main>` (with a
  left margin equal to the rail width) + `<Header>` + global `<UploadsPanel>` +
  `<CommandPalette>`.

The shell (`apps/web/app/(dashboard)/layout.tsx:19-67`):

```tsx
const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
// …
const isAssetViewer = /\/projects\/[^/]+\/assets\/[^/]+/.test(pathname);
// …
<div className="flex h-screen overflow-hidden bg-bg-primary">
  <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />
  <main className={cn(
    "flex flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-spring",
    sidebarCollapsed ? "ml-[52px]" : "ml-[220px]",
  )}>
    {!isAssetViewer && <Header onSearchOpen={() => setCommandOpen(true)} />}
    <div className="relative flex-1 overflow-y-auto">{children}</div>
  </main>
  <UploadsPanel />
  <UploadSSEBridge />
  <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
</div>
```

The header today (`apps/web/components/layout/header.tsx:55-124`) already reads
`useViewStore` and `useBreadcrumbStore` and renders the search button + panel
toggle on the right.

The controls to relocate, with their existing wiring (all from `sidebar.tsx`):
- **Logo** → branding store (`useBrandingStore`, `useThemeStore`), links to `/projects`. (`sidebar.tsx:44-101`)
- **Notifications** → `useNotificationStore().unreadCount` + `fetchNotifications()`; a button toggling local `notifOpen` state that drives `<NotificationDrawer open onClose />`. (`sidebar.tsx:51,55,135-159,271-272`)
- **Uploads** → `useUploadStore()` `togglePanel`, `panelOpen`, and `files` (for the active-count badge). (`sidebar.tsx:43,52,162-186`)
- **User menu** → `useAuthStore().user, logout` + `<Avatar>` + Radix `DropdownMenu` with Profile / Settings / Log out. (`sidebar.tsx:192-254`)

Conventions: design tokens `text-text-*`/`bg-bg-*`/`border-border`;
`@radix-ui/react-dropdown-menu` already a dependency; `Avatar` from
`@/components/shared/avatar`; icons from `lucide-react`. The header sits at
`h-11`; keep controls compact (icon buttons `h-7 w-7`).

## Commands you will need

| Purpose   | Command                              | Expected on success   |
|-----------|--------------------------------------|-----------------------|
| Install   | `pnpm install`                       | exit 0                |
| Typecheck | `cd apps/web && npx tsc --noEmit`    | exit 0, no errors     |
| Lint      | `cd apps/web && pnpm lint`           | exit 0                |
| Tests     | `cd apps/web && pnpm test`           | all pass              |
| Build     | `cd apps/web && pnpm build`          | exit 0 (final gate)   |

## Scope

**In scope**:
- `apps/web/components/layout/header.tsx` (edit — becomes the global nav bar)
- `apps/web/app/(dashboard)/layout.tsx` (edit — drop the rail + margin)
- `apps/web/components/layout/sidebar.tsx` (delete — fully superseded; only after
  confirming nothing else imports it, step 4)

**Out of scope** (do NOT touch):
- `apps/web/components/layout/notification-drawer.tsx`,
  `uploads-panel.tsx`, `command-palette.tsx` — reuse as-is via their existing
  props/stores; do not modify them.
- The asset-viewer top bar and the project-page panels.
- Any store file — reuse existing selectors; do not change store shapes.
- The breadcrumb logic in `header.tsx` (`buildBreadcrumbs`, `LABEL_MAP`, etc.) —
  keep it; the logo just sits to its left.

## Git workflow

- Branch: `advisor/025-nav-into-header`
- Conventional commits, ideally one per step (e.g.
  `feat(web): move nav controls into header`, then `refactor(web): drop nav rail`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the nav controls to the header

Edit `apps/web/components/layout/header.tsx`. Keep the breadcrumbs and the
search/panel-toggle. Add: a logo on the far left (links to `/projects`), and —
in the right-side actions cluster, **beside the search button** — the
Notifications bell, the Uploads button, and the user dropdown. Port the wiring
verbatim from `sidebar.tsx` (same stores, same `<NotificationDrawer>` usage, same
Radix `DropdownMenu`, same `<Avatar>`).

Concrete structure (adapt classes to the `h-11` header; keep buttons `h-7 w-7`):

```tsx
'use client'
import * as React from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, ChevronRight, PanelRightClose, PanelRightOpen, Bell, Upload, Settings, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useViewStore } from '@/stores/view-store'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { useAuthStore } from '@/stores/auth-store'
import { useUploadStore } from '@/stores/upload-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore } from '@/stores/theme-store'
import { Avatar } from '@/components/shared/avatar'
import { NotificationDrawer } from './notification-drawer'

export function Header({ onSearchOpen }: HeaderProps) {
  // existing: pathname, rightPanelOpen/toggleRightPanel, breadcrumbs…
  const { user, logout } = useAuthStore()
  const { togglePanel, panelOpen, files: uploadFiles } = useUploadStore()
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore()
  const { theme } = useThemeStore()
  const [notifOpen, setNotifOpen] = React.useState(false)
  const activeUploads = uploadFiles.filter(
    (f) => f.status === 'uploading' || f.status === 'pending' || f.status === 'processing',
  ).length
  React.useEffect(() => { fetchNotifications() }, [fetchNotifications])

  return (
    <header className="sticky top-0 z-20 flex h-11 items-center justify-between border-b border-border bg-bg-primary/90 backdrop-blur-sm px-4">
      {/* Left: logo (→ /projects) + breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/projects" className="flex items-center gap-2 shrink-0">
          {/* logo: theme-aware custom logo or default /logo-icon.png — copy from sidebar.tsx:73-101 */}
        </Link>
        <nav className="flex items-center gap-1 text-[13px] min-w-0">{/* existing breadcrumbs */}</nav>
      </div>

      {/* Right: notifications, uploads, search, panel toggle, user */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Notifications bell — copy button markup from sidebar.tsx:135-159, set notifOpen */}
        {/* Uploads button — copy from sidebar.tsx:162-186, call togglePanel() */}
        {/* existing Search button */}
        {/* existing panel toggle (keep its pathname !== '/projects' guard) */}
        {/* User DropdownMenu — copy from sidebar.tsx:192-254 (Avatar trigger + Profile/Settings/Log out) */}
      </div>

      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </header>
  )
}
```

Keep badges (unread count on the bell, active-upload count on Uploads) exactly as
the rail rendered them.

**Verify**: `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 2: Remove the rail from the shell

In `apps/web/app/(dashboard)/layout.tsx`:
- Delete the `<Sidebar …/>` render and the `sidebarCollapsed`/`setSidebarCollapsed`
  state and its import.
- Remove the left margin from `<main>` (it should be full-width now):
  ```tsx
  <main className="flex flex-1 flex-col overflow-hidden">
  ```
- Keep `isAssetViewer` and the `{!isAssetViewer && <Header …/>}` line (the
  immersive viewer still hides the header; it has its own top bar with a back
  button — global nav lives in the header elsewhere). Keep `<UploadsPanel>`,
  `<UploadSSEBridge>`, `<CommandPalette>`.

**Verify**:
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `grep -n "Sidebar" "apps/web/app/(dashboard)/layout.tsx"` → no matches.

### Step 3: Verify the header renders and nothing else imports the rail

**Verify**:
- `grep -rn "components/layout/sidebar" apps/web` → only the (soon-removed)
  layout reference should have existed; expect **no** matches now.
- `cd apps/web && pnpm lint` → exit 0.

### Step 4: Delete the superseded sidebar file

Only if step 3's grep confirms `sidebar.tsx` is no longer imported anywhere:
delete `apps/web/components/layout/sidebar.tsx`.

**Verify**:
- `grep -rn "from './sidebar'\|layout/sidebar" apps/web` → no matches.
- `cd apps/web && npx tsc --noEmit` → exit 0.

### Step 5: Full gates

**Verify**:
- `cd apps/web && pnpm lint` → exit 0.
- `cd apps/web && pnpm test` → all pass.
- `cd apps/web && pnpm build` → exit 0 (catches any shell/layout regression the
  unit tests miss).

## Test plan

- No new unit tests are required (this is a relocation of existing wired
  controls). The gates are typecheck + lint + the existing suite + a successful
  `pnpm build`.
- Manual verification (note in PR), desktop and mobile:
  - No left rail anywhere; content is full width.
  - Header shows logo (→ Projects), breadcrumbs, and on the right: notifications
    (with unread badge + drawer), uploads (with active badge + panel), search
    (⌘K), panel toggle (on detail pages), user menu (Profile/Settings/Log out).
  - The asset viewer still hides the header and uses its own top bar.

## Done criteria

ALL must hold:

- [ ] `cd apps/web && npx tsc --noEmit` exits 0
- [ ] `cd apps/web && pnpm lint` exits 0
- [ ] `cd apps/web && pnpm test` exits 0
- [ ] `cd apps/web && pnpm build` exits 0
- [ ] `grep -rn "layout/sidebar" apps/web` → no matches; `sidebar.tsx` deleted
- [ ] Header contains notifications, uploads, search, and user menu; layout has no
      rail margin
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The "Current state" excerpts don't match the live code (drift).
- Anything outside `apps/web/app/(dashboard)/**` imports `sidebar.tsx` (some
  other surface depends on the rail) — do not delete it; report and leave it
  unused.
- Moving the user `DropdownMenu` into the `h-11` header causes Radix portal/zindex
  or overflow issues you can't resolve with the existing tokens — report rather
  than redesigning the dropdown.
- The header becomes too crowded on mobile to be usable — STOP and report; a
  mobile "overflow menu" may be a follow-up decision for the maintainer rather
  than something to improvise here.

## Maintenance notes

- **Interaction with plan 021** (editor mobile): 021 stops reserving the rail
  margin on the asset-viewer route. If 025 lands first, the rail and its margin
  are gone globally, so 021's layout step becomes a no-op — verify and note it.
  If 021 landed first, reconcile its `layout.tsx` margin logic into step 2.
- A reviewer should scrutinize: keyboard access to the user menu, the
  notifications drawer still opening/closing, upload badge counts, and that the
  immersive asset viewer is unaffected.
- Deferred: a responsive "hamburger"/overflow menu for very narrow screens, and
  any visual redesign beyond relocation. Keep this plan a move, not a redesign.
