import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setTokens, getAccessToken, clearTokens } from '../auth'

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

  it('clearTokens does not reload the login page', async () => {
    // Given
    const locationMock = {
      href: 'http://localhost/login',
      pathname: '/login',
    }
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
    })

    // When
    clearTokens()
    await Promise.resolve()

    // Then
    expect(window.location.href).toBe('http://localhost/login')
  })

  it('refresh keeps the session through a network error or 5xx; a 401 ends it', async () => {
    const { refreshAccessToken } = await import('../auth')
    Object.defineProperty(window, 'location', {
      value: { href: '', pathname: '/projects/p1', search: '?folder=f1' },
      writable: true,
    })
    const logoutCalls = () =>
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/auth/logout')).length

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await refreshAccessToken()).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502 } as Response)
    expect(await refreshAccessToken()).toBeNull()
    expect(logoutCalls()).toBe(0)

    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    expect(await refreshAccessToken()).toBeNull()
    expect(logoutCalls()).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(window.location.href).toBe('/login?from=%2Fprojects%2Fp1%3Ffolder%3Df1')
  })
})
