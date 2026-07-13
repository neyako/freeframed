'use client'

import { useEffect } from 'react'
import { useBrandingStore } from '@/stores/branding-store'
import { useThemeStore, type Theme } from '@/stores/theme-store'

const DEFAULT_FAVICON = '/favicon.ico'

function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function getFaviconLink(): HTMLLinkElement {
  // Next emits links for both app/favicon.ico and app/icon.png; browsers pick
  // the hi-res icon.png, so rewriting just the first link never shows the
  // custom favicon. Collapse to a single managed link.
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
  const [link, ...duplicates] = links
  if (link) {
    for (const duplicate of duplicates) duplicate.remove()
    link.removeAttribute('sizes')
    link.removeAttribute('type')
    return link
  }

  const created = document.createElement('link')
  created.rel = 'icon'
  document.head.appendChild(created)
  return created
}

function selectLogo(theme: Theme, darkLogo: string | null, lightLogo: string | null): string | null {
  return resolveTheme(theme) === 'light'
    ? (lightLogo ?? darkLogo)
    : (darkLogo ?? lightLogo)
}

export function BrandingInitializer() {
  useEffect(() => {
    let appliedCustomFavicon = false
    let lastWrittenTitle: string | null = null

    function syncDocumentBranding() {
      const { orgName, orgLogoDark, orgLogoLight } = useBrandingStore.getState()
      const { theme } = useThemeStore.getState()
      const activeLogo = selectLogo(theme, orgLogoDark, orgLogoLight)

      // Only replace titles we own — pages like the share viewer set their own
      if (document.title === 'FreeFrame' || document.title === lastWrittenTitle) {
        document.title = orgName
        lastWrittenTitle = orgName
      }

      if (activeLogo) {
        getFaviconLink().href = activeLogo
        appliedCustomFavicon = true
        return
      }

      if (appliedCustomFavicon) {
        getFaviconLink().href = DEFAULT_FAVICON
        appliedCustomFavicon = false
      }
    }

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
  }, [])

  return null
}
