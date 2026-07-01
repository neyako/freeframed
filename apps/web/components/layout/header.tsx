'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, ChevronRight, Bell, Upload, Settings, LogOut, User } from 'lucide-react'
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
  const { labels, extraCrumbs } = useBreadcrumbStore()
  const { user, logout } = useAuthStore()
  const { files: uploadFiles, togglePanel, panelOpen } = useUploadStore()
  const { unreadCount, fetchNotifications } = useNotificationStore()
  const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore()
  const { theme } = useThemeStore()
  const [notifOpen, setNotifOpen] = React.useState(false)

  const customLogo = theme === 'light'
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
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between border-b border-border bg-bg-primary/90 backdrop-blur-sm px-4">
        {/* Left: logo + breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/projects" className="flex items-center gap-2 shrink-0" onClick={() => setNotifOpen(false)}>
            {customLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={customLogo}
                alt={orgName}
                className="h-7 w-7 shrink-0 object-contain rounded"
              />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-icon.png"
                  alt={orgName}
                  className="h-7 w-7 shrink-0 object-contain logo-dark"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-icon-dark.png"
                  alt={orgName}
                  className="h-7 w-7 shrink-0 object-contain logo-light"
                />
              </>
            )}
          </Link>

          <nav className="flex items-center gap-1 text-[13px] min-w-0">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                <React.Fragment key={`${crumb.href}-${index}`}>
                  {index > 0 && (
                    <ChevronRight className="h-3 w-3 text-text-tertiary" />
                  )}
                  {isLast ? (
                    <span className="font-medium text-text-primary">{crumb.label}</span>
                  ) : crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="text-text-tertiary hover:text-text-secondary transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-text-tertiary">{crumb.label}</span>
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
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-0.5 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Uploads button */}
          <button
            onClick={() => { setNotifOpen(false); togglePanel() }}
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              panelOpen
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
            )}
            title="Uploads"
          >
            <Upload className="h-4 w-4" strokeWidth={panelOpen ? 2 : 1.5} />
            {activeUploads > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white">
                {activeUploads}
              </span>
            )}
          </button>

          {/* Search trigger */}
          <button
            onClick={onSearchOpen}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg-secondary/60 px-2.5 py-1 text-xs text-text-tertiary hover:border-border-focus hover:text-text-secondary transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-bg-tertiary/50 px-1 py-0.5 font-mono text-[10px] text-text-tertiary">
              <span>⌘</span>K
            </kbd>
          </button>

          {/* User dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                title={user?.name ?? 'Account'}
              >
                <Avatar
                  src={user?.avatar_url}
                  name={user?.name}
                  size="sm"
                />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="end"
                sideOffset={8}
                className="z-50 min-w-[180px] rounded-lg border border-border bg-bg-elevated p-1 shadow-xl animate-slide-up"
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
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-status-error hover:bg-status-error/10 focus:outline-none"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <NotificationDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  )
}
