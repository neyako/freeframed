'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore, type Theme } from '@/stores/theme-store'

const DEFAULT_FAVICON = '/favicon.ico'

function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

// Next's <link rel="icon"> nodes are React-managed: removing them (or their
// attributes) detaches nodes React still owns, and the next route transition
// crashes in commitDeletion with "Cannot read properties of null (removeChild)".
// Only ever mutate href — browsers may prefer the hi-res icon.png link, so
// point every icon link at the custom logo instead of collapsing them.
function getFaviconLinks(): HTMLLinkElement[] {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
  if (links.length > 0) return links

  const created = document.createElement('link')
  created.rel = 'icon'
  document.head.appendChild(created)
  return [created]
}

export function setFavicon(href: string | null): void {
  for (const link of getFaviconLinks()) {
    if (href !== null) {
      if (link.dataset.ffOriginalHref === undefined) {
        link.dataset.ffOriginalHref = link.getAttribute('href') ?? DEFAULT_FAVICON
      }
      link.href = href
    } else if (link.dataset.ffOriginalHref !== undefined) {
      link.href = link.dataset.ffOriginalHref
      delete link.dataset.ffOriginalHref
    }
  }
}

function selectLogo(theme: Theme, darkLogo: string | null, lightLogo: string | null): string | null {
  return resolveTheme(theme) === 'light'
    ? (lightLogo ?? darkLogo)
    : (darkLogo ?? lightLogo)
}

export function BrandingInitializer() {
  const pathname = usePathname()
  const appliedCustomFavicon = useRef(false)
  const lastWrittenTitle = useRef<string | null>(null)

  const syncDocumentBranding = useCallback(() => {
    const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore.getState()
    const { theme } = useThemeStore.getState()
    const activeLogo = selectLogo(theme, orgLogoDark, orgLogoLight)

    // Only replace titles we own — pages like the share viewer set their own
    if (document.title === 'FreeFrame' || document.title === lastWrittenTitle.current) {
      document.title = orgName
      lastWrittenTitle.current = orgName
    }

    if (activeLogo) {
      setFavicon(activeLogo)
      appliedCustomFavicon.current = true
      return
    }

    if (appliedCustomFavicon.current) {
      setFavicon(null)
      appliedCustomFavicon.current = false
    }
  }, [])

  useEffect(() => {
    const unsubscribeBranding = useBrandingStore.subscribe(syncDocumentBranding)
    const unsubscribeTheme = useThemeStore.subscribe(syncDocumentBranding)
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    syncDocumentBranding()
    void useBrandingStore.getState().hydrateFromServer()

    media.addEventListener('change', syncDocumentBranding)
    return () => {
      unsubscribeBranding()
      unsubscribeTheme()
      media.removeEventListener('change', syncDocumentBranding)
    }
  }, [syncDocumentBranding])

  // Next re-renders its metadata <link rel="icon"> back to /icon.png on every
  // client-side navigation, clobbering the custom favicon. Re-assert after each
  // route change (runs post-commit, so it wins over React's head reconciliation).
  useEffect(() => {
    syncDocumentBranding()
  }, [pathname, syncDocumentBranding])

  return null
}
