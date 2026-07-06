import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setTokens, getAccessToken, getRefreshToken, clearTokens } from '../auth'

describe('Token management', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('setTokens clears legacy localStorage tokens', () => {
    localStorage.setItem('ff_access_token', 'old-access')
    localStorage.setItem('ff_refresh_token', 'old-refresh')

    setTokens('access-123', 'refresh-456')
    expect(localStorage.getItem('ff_access_token')).toBeNull()
    expect(localStorage.getItem('ff_refresh_token')).toBeNull()
  })

  it('getAccessToken returns null and clears legacy token', () => {
    localStorage.setItem('ff_access_token', 'my-access-token')
    expect(getAccessToken()).toBeNull()
    expect(localStorage.getItem('ff_access_token')).toBeNull()
  })

  it('getAccessToken returns null when no token stored', () => {
    expect(getAccessToken()).toBeNull()
  })

  it('getRefreshToken returns null and clears legacy token', () => {
    localStorage.setItem('ff_refresh_token', 'my-refresh-token')
    expect(getRefreshToken()).toBeNull()
    expect(localStorage.getItem('ff_refresh_token')).toBeNull()
  })

  it('getRefreshToken returns null when no token stored', () => {
    expect(getRefreshToken()).toBeNull()
  })

  it('clearTokens removes both tokens from localStorage', () => {
    localStorage.setItem('ff_access_token', 'access-123')
    localStorage.setItem('ff_refresh_token', 'refresh-456')

    // Mock window.location.href setter to avoid navigation errors
    const locationMock = { href: '' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })

    clearTokens()

    expect(localStorage.getItem('ff_access_token')).toBeNull()
    expect(localStorage.getItem('ff_refresh_token')).toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    )
  })

  it('clearTokens redirects to /login', async () => {
    const locationMock = { href: '' }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })

    clearTokens()
    await Promise.resolve()

    expect(window.location.href).toBe('/login')
  })
})
