'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, Upload, Settings, LogOut, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { useAuthStore } from '@/stores/auth-store'
import { useUploadStore } from '@/stores/upload-store'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore } from '@/stores/theme-store'
import { Avatar } from '@/components/shared/avatar'
import { buttonVariants } from '@/components/ui/button'
import { menuContentClass, menuItemClass, menuItemDangerClass, menuSeparatorClass } from '@/components/ui/surface'

interface HeaderProps {
  onSearchOpen: () => void
}

const LABEL_MAP: Record<string, string> = {
  projects: 'Projects',
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
const SKIP_SEGMENTS = new Set(['assets'])

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
  const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore()
  const { theme, setTheme } = useThemeStore()
  // Controlled so the account menu can drive the shared scrim below; Radix
  // still owns open/close, we only mirror its state.
  const [accountOpen, setAccountOpen] = React.useState(false)
  // One shared scrim for every header popover, so switching between them keeps
  // the dim steady instead of per-panel scrims cross-fading (which flickered
  // the background).
  const anyPopupOpen = panelOpen || accountOpen
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

  const urlCrumbs = buildBreadcrumbs(pathname, labels)
  const breadcrumbs = [...urlCrumbs, ...extraCrumbs.map((c) => ({ label: c.label, href: c.href ?? '' }))]

  const iconButton = cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'relative w-[30px] px-0')

  return (
    <>
      <header className={cn(
        'sticky top-0 z-20 h-12 items-center justify-between gap-3 border-b border-border bg-bg-primary px-4',
        isProjectLibrary ? 'hidden lg:flex' : 'flex',
      )}>
        {/* Left: logo + breadcrumbs */}
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <Link href="/" className="flex shrink-0 items-center">
            {customLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={customLogo}
                alt={orgName}
                className="h-6 w-6 shrink-0 rounded-sm object-contain"
              />
            ) : (
              <span className="font-semibold text-text-primary">freeframed</span>
            )}
          </Link>

          <nav className="flex min-w-0 items-center gap-2">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                <React.Fragment key={`${crumb.href}-${index}`}>
                  <span className="text-text-tertiary">/</span>
                  {isLast ? (
                    <span className="max-w-[200px] truncate text-text-primary">{crumb.label}</span>
                  ) : crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="max-w-[200px] truncate text-text-secondary transition-colors duration-100 hover:text-text-primary"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="max-w-[200px] truncate text-text-secondary">{crumb.label}</span>
                  )}
                </React.Fragment>
              )
            })}
          </nav>
        </div>

        {/* Right side actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onSearchOpen}
            className="hidden h-[30px] w-56 items-center gap-2 rounded-md border border-border-strong bg-bg-secondary px-2.5 text-[12.5px] text-text-tertiary transition-colors duration-100 hover:text-text-secondary lg:flex"
          >
            <Search className="h-[15px] w-[15px]" />
            Search
            <kbd className="ml-auto rounded-sm border border-border-strong px-1 font-mono text-[10px] text-text-secondary">⌘K</kbd>
          </button>

          <button
            data-popup-trigger
            onClick={() => { setAccountOpen(false); togglePanel() }}
            className={cn(iconButton, 'hidden lg:inline-flex', panelOpen && 'bg-bg-hover text-text-primary')}
            title="Uploads"
            aria-label={activeUploads > 0 ? `Uploads, ${activeUploads} active` : 'Uploads'}
          >
            <Upload />
            {activeUploads > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-text-primary px-0.5 font-mono text-[9px] text-bg-primary">
                {activeUploads}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label="Toggle color theme"
            title={isLight ? 'Switch to dark' : 'Switch to light'}
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            className={cn(iconButton, 'hidden lg:inline-flex')}
          >
            {isLight ? <Moon /> : <Sun />}
          </button>

          {/* User dropdown */}
          <DropdownMenu.Root
            open={accountOpen}
            // Non-modal: a modal menu puts `pointer-events: none` on the body,
            // so clicking uploads while this was open got swallowed as a
            // dismiss and needed a second click.
            modal={false}
            onOpenChange={(open) => {
              // Both header popups share one corner and one scrim, so they
              // must be mutually exclusive or they stack on top of each other.
              if (open) setPanelOpen(false)
              setAccountOpen(open)
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-full"
                title={user?.name ?? 'Account'}
                aria-label="Account"
              >
                <Avatar src={user?.avatar_url} name={user?.name} size="sm" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="end"
                onInteractOutside={(e) => {
                  // Radix dismisses on `pointerdown`, but the uploads button
                  // only swaps popups on `click`. Let the trigger's own click
                  // handler close this menu so both state updates land in one
                  // render and the shared scrim never dips.
                  const target = (e.detail as { originalEvent?: Event } | undefined)
                    ?.originalEvent?.target
                  if (target instanceof Element && target.closest('[data-popup-trigger]')) {
                    e.preventDefault()
                  }
                }}
                // Same corner as the uploads panel (`fixed right-2 top-14`):
                // the 28px trigger ends 38px down the 48px header, 38+18 = 56;
                // -8 pushes the right edge from the header's px-4 to right-2.
                sideOffset={18}
                alignOffset={-8}
                className={menuContentClass}
              >
                <DropdownMenu.Item asChild className={menuItemClass}>
                  <Link href="/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className={menuSeparatorClass} />
                <DropdownMenu.Item onSelect={logout} className={menuItemDangerClass}>
                  <LogOut />
                  Log out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {/* Always mounted; only its opacity changes, so it cannot flash however
          fast the popups are opened, closed, or swapped. */}
      <div
        aria-hidden
        onClick={() => { setPanelOpen(false); setAccountOpen(false) }}
        className={cn(
          'fixed inset-x-0 bottom-0 top-12 z-40 bg-black/40 transition-opacity duration-150',
          anyPopupOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
    </>
  )
}
