'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, Bell, Upload, Settings, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { useAuthStore } from '@/stores/auth-store'
import { useUploadStore } from '@/stores/upload-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore } from '@/stores/theme-store'
import { Avatar } from '@/components/shared/avatar'
import { NotificationDrawer } from './notification-drawer'

interface HeaderProps {
  onSearchOpen: () => void
}

const LABEL_MAP: Record<string, string> = {
  projects: 'Projects',
  notifications: 'Notifications',
  settings: 'Settings',
  new: 'New',
  upload: 'Upload',
}

/** Looks like a UUID (8-4-4-4-12 hex) */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * Route path segments that are structural only and should not appear in the breadcrumb.
 * e.g. /projects/{id}/assets/{assetId} — "assets" is just a route prefix, not a meaningful label.
 */
const SKIP_SEGMENTS = new Set(['assets', 'collections'])

function buildBreadcrumbs(pathname: string, dynamicLabels: Record<string, string>): { label: string; href: string }[] {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: { label: string; href: string }[] = []

  let path = ''
  for (const segment of segments) {
    path += `/${segment}`
    // Skip structural route segments
    if (SKIP_SEGMENTS.has(segment)) continue
    // Skip UUID segments that don't have a label registered
    if (isUuid(segment) && !dynamicLabels[segment]) continue
    const label =
      dynamicLabels[segment] ??
      LABEL_MAP[segment] ??
      segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
    crumbs.push({ label, href: path })
  }

  return crumbs
}

export function Header({ onSearchOpen }: HeaderProps) {
  const pathname = usePathname()
  // Library page renders its own contextual app bar on mobile (spec 1b)
  const isProjectLibrary = /^\/projects\/[^/]+$/.test(pathname ?? '')
  const { labels, extraCrumbs } = useBreadcrumbStore()
  const { user, logout } = useAuthStore()
  const { files: uploadFiles, togglePanel, panelOpen, setPanelOpen } = useUploadStore()
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore()
  const { theme, setTheme } = useThemeStore()
  const [notifOpen, setNotifOpen] = React.useState(false)
  // Controlled so the account menu can drive the shared scrim below; Radix
  // still owns open/close, we only mirror its state.
  const [accountOpen, setAccountOpen] = React.useState(false)
  // One shared scrim for every header popover, so switching between them keeps
  // the dim steady instead of per-panel scrims cross-fading (which flickered
  // the background).
  const anyPopupOpen = notifOpen || panelOpen || accountOpen
  const [resolvedTheme, setResolvedTheme] = React.useState<'dark' | 'light'>(
    theme === 'light' ? 'light' : 'dark',
  )

  React.useEffect(() => {
    if (theme !== 'system') {
      setResolvedTheme(theme)
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => setResolvedTheme(media.matches ? 'dark' : 'light')
    syncTheme()
    media.addEventListener('change', syncTheme)
    return () => media.removeEventListener('change', syncTheme)
  }, [theme])

  const isLight = resolvedTheme === 'light'
  const customLogo = isLight
    ? (orgLogoLight ?? orgLogoDark)
    : (orgLogoDark ?? orgLogoLight)

  const activeUploads = uploadFiles.filter(
    (f) => f.status === 'uploading' || f.status === 'pending' || f.status === 'processing',
  ).length

  React.useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const urlCrumbs = buildBreadcrumbs(pathname, labels)
  const breadcrumbs = [...urlCrumbs, ...extraCrumbs.map((c) => ({ label: c.label, href: c.href ?? '' }))]

  return (
    <>
      <header className={cn(
        'sticky top-0 z-20 h-14 items-center justify-between border-b border-border bg-bg-primary px-4 sm:px-6',
        isProjectLibrary ? 'hidden lg:flex' : 'flex',
      )}>
        {/* Left: logo + breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0" onClick={() => setNotifOpen(false)}>
            {customLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={customLogo}
                alt={orgName}
                className="h-7 w-7 shrink-0 object-contain rounded"
              />
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-hidden />
                <span className="font-mono text-[15px] font-bold tracking-[-0.01em] text-text-primary">
                  freeframed
                </span>
              </>
            )}
          </Link>

          <nav className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] min-w-0">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                <React.Fragment key={`${crumb.href}-${index}`}>
                  {index > 0 && (
                    <span className="text-text-tertiary/60 font-mono text-[10px]">/</span>
                  )}
                  {isLast ? (
                    <span className="inline-flex items-center gap-1.5 text-text-primary min-w-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                      <span className="truncate max-w-[180px]">{crumb.label}</span>
                    </span>
                  ) : crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="text-text-tertiary hover:text-text-primary transition-colors truncate max-w-[180px]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-text-tertiary truncate max-w-[180px]">{crumb.label}</span>
                  )}
                </React.Fragment>
              )
            })}
          </nav>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Notifications bell */}
          <button
            data-popup-trigger
            onClick={() => { setPanelOpen(false); setAccountOpen(false); setNotifOpen((v) => !v) }}
            className={cn(
              'relative flex h-[34px] w-[34px] items-center justify-center rounded border transition-colors',
              notifOpen
                ? 'border-border text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
            )}
            title="Notifications"
          >
            <Bell className="h-4 w-4" strokeWidth={notifOpen ? 2 : 1.5} />
            <span className="t-badge" data-open={unreadCount > 0}>
              <span className="t-badge-dot">
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-dot text-[9px] font-bold text-white">
                  {unreadCount}
                </span>
              </span>
            </span>
          </button>

          {/* Uploads button */}
          <button
            data-popup-trigger
            onClick={() => { setNotifOpen(false); setAccountOpen(false); togglePanel() }}
            className={cn(
              'relative hidden lg:flex h-[34px] w-[34px] items-center justify-center rounded border transition-colors',
              panelOpen
                ? 'border-border text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
            )}
            title="Uploads"
          >
            <Upload className="h-4 w-4" strokeWidth={panelOpen ? 2 : 1.5} />
            <span className="t-badge" data-open={activeUploads > 0}>
              <span className="t-badge-dot">
                <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-text-primary px-0.5 font-dot text-[9px] font-bold text-bg-primary">
                  {activeUploads}
                </span>
              </span>
            </span>
          </button>

          {/* Search trigger */}
          <button
            onClick={onSearchOpen}
            className="hidden lg:flex h-[34px] items-center gap-2 rounded border border-border bg-bg-tertiary px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary hover:border-border-strong hover:text-text-secondary transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex items-center rounded-[2px] border border-border-strong bg-transparent px-[5px] py-px font-mono text-[10px] tracking-[0.06em] text-text-tertiary">⌘K</kbd>
          </button>

          <button
            type="button"
            aria-label="Toggle color theme"
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            className="hidden lg:flex h-[34px] items-center gap-2 rounded border border-border bg-bg-tertiary px-2 sm:px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
          >
            <span className="relative h-3.5 w-[26px] rounded-full border border-border-strong bg-bg-primary" aria-hidden>
              <span
                className={cn(
                  'absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-text-secondary transition-transform duration-200 ease-spring',
                  isLight && 'translate-x-3 bg-accent',
                )}
              />
            </span>
            <span className="hidden sm:inline">{isLight ? 'Light' : 'Dark'}</span>
          </button>

          {/* User dropdown */}
          <DropdownMenu.Root
            open={accountOpen}
            // Non-modal: a modal menu puts `pointer-events: none` on the body,
            // so clicking the bell while this was open got swallowed as a
            // dismiss and needed a second click. That split the swap across two
            // ticks, letting the shared scrim's condition dip false and replay
            // its fade — the dim "double-darkening". Non-modal lets one click
            // dismiss this and open the next popup in a single batched update.
            modal={false}
            onOpenChange={(open) => {
              // All three header popups share one corner and one scrim, so they
              // must be mutually exclusive or they stack on top of each other.
              if (open) { setNotifOpen(false); setPanelOpen(false) }
              setAccountOpen(open)
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                title={user?.name ?? 'Account'}
              >
                <Avatar
                  src={user?.avatar_url}
                  name={user?.name}
                  size="sm"
                  accent
                />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="end"
                onInteractOutside={(e) => {
                  // Radix dismisses on `pointerdown`, but the bell/uploads
                  // buttons only swap popups on `click`. Dismissing here would
                  // leave every popup closed for the gap between the two, so
                  // the shared scrim would start fading out and then reverse —
                  // a visible dip in the dim. Let the trigger's own click
                  // handler close this menu instead, so both state updates land
                  // in one batched render and the scrim never moves.
                  const target = (e.detail as { originalEvent?: Event } | undefined)
                    ?.originalEvent?.target
                  if (target instanceof Element && target.closest('[data-popup-trigger]')) {
                    e.preventDefault()
                  }
                }}
                // Lands the menu on the same corner as the notification drawer
                // and uploads panel (`fixed right-2 top-16`): the 28px trigger
                // ends 42px down the 56px header, so 42+22 = top-16, and -16
                // pushes the right edge out from the header's px-6 to right-2.
                sideOffset={22}
                alignOffset={-16}
                className="z-50 min-w-[180px] rounded border border-border bg-bg-elevated shadow-xl p-1
                  data-[state=open]:animate-in data-[state=closed]:animate-out
                  data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
                  data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
              >
                <DropdownMenu.Item asChild>
                  <Link
                    href="/settings/profile"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none"
                  >
                    <User className="h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <Link
                    href="/settings/admin"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={logout}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-accent hover:bg-accent-muted focus:outline-none"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {/* Always mounted; only its opacity changes. Mounting/unmounting it around
          a keyframe animation meant a JS timer had to stay in lockstep with a
          CSS animation, and any drift tore the element out mid-fade. A plain
          opacity transition has no presence to synchronise, so it cannot flash
          however fast the popups are opened, closed, or swapped. */}
      <div
        aria-hidden
        onClick={() => { setNotifOpen(false); setPanelOpen(false); setAccountOpen(false) }}
        className={cn(
          'fixed inset-x-0 bottom-0 top-14 z-40 bg-black/40 transition-opacity duration-150',
          anyPopupOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />

      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  )
}
