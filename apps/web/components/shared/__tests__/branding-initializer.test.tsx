import { afterEach, describe, expect, it } from 'vitest'

import { setFavicon } from '../branding-initializer'

function addIconLink(href: string, sizes?: string): HTMLLinkElement {
  const link = document.createElement('link')
  link.rel = 'icon'
  link.setAttribute('href', href)
  if (sizes) link.setAttribute('sizes', sizes)
  document.head.appendChild(link)
  return link
}

describe('setFavicon', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove())
  })

  it('rewrites hrefs without removing Next-managed icon links', () => {
    // Removing React-owned head nodes crashes the next route transition
    // (removeChild on null) — the fix must only ever mutate attributes.
    const ico = addIconLink('/favicon.ico')
    const png = addIconLink('/icon.png', '32x32')

    setFavicon('data:image/png;base64,custom')

    const links = document.head.querySelectorAll('link[rel~="icon"]')
    expect(links).toHaveLength(2)
    expect(document.head.contains(ico)).toBe(true)
    expect(document.head.contains(png)).toBe(true)
    expect(ico.getAttribute('href')).toBe('data:image/png;base64,custom')
    expect(png.getAttribute('href')).toBe('data:image/png;base64,custom')
    expect(png.getAttribute('sizes')).toBe('32x32')
  })

  it('restores original hrefs on reset', () => {
    const ico = addIconLink('/favicon.ico')
    const png = addIconLink('/icon.png', '32x32')

    setFavicon('data:image/png;base64,custom')
    setFavicon(null)

    expect(ico.getAttribute('href')).toBe('/favicon.ico')
    expect(png.getAttribute('href')).toBe('/icon.png')
    expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(2)
  })

  it('creates its own link when none exist', () => {
    setFavicon('data:image/png;base64,custom')

    const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('data:image/png;base64,custom')
  })
})
